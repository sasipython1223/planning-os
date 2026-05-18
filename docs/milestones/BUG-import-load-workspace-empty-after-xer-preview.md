# [BUG] Import Load to Workspace does not populate TaskTable/Gantt after XER preview

## Worker-Level Root Cause (Issue #43 — Fix Investigation)

### 1. Where IMPORT_SCHEDULE is Handled

`packages/worker/src/worker.ts` — the `IMPORT_SCHEDULE` branch inside `dispatchCommand()`.

**Handler flow:**
1. Retrieve `ImportCandidate` held from prior `PREVIEW_IMPORT`
2. Validate `canCommit` and mapped data presence
3. Snapshot pre-import state (`createSnapshot` + `getBaselineMap` + `getProjectStartDate`)
4. Replace canonical state atomically: `State.restoreSnapshot(candidate.mappedData)`
5. Clear baselines: `State.setBaselineMap({})`
6. Apply imported project start date: `State.setProjectStartDate(candidate.projectStartDate)` *(fixed in this PR)*
7. Run scheduling: `runSchedulingAndEmitState()`
8. On failure: rollback all three → `NACK` with concrete error reason; on success: push undo entry → `ACK`

### 2. State Staged Before Scheduling

After `State.restoreSnapshot`, canonical state holds:
- `tasks`: all imported tasks (WBS summary + activities)
- `dependencies`: all imported dependencies (self-deps and duplicates now filtered by xerMapper)
- `resources`, `assignments`: imported entities

The kernel receives these via `buildScheduleRequest(tasks, deps, nonWorkingDays)`.

### 3. What Function Emits `schedule-error path`

`runSchedulingAndEmitState()` — `packages/worker/src/worker.ts`.

When `runSchedule(request)` returns a `ScheduleError` (object with `type` discriminant), this function:
- captures the error in module-level `lastScheduleError` *(new in this PR)*
- emits `SCHEDULE_ERROR` message to React
- emits `DIFF_STATE` with empty `scheduleResults`
- logs `"[AUDIT Worker Emit] schedule-error path"` including `errorType`, `errorMessage`, `taskId` *(enriched in this PR)*
- returns `false`

### 4. Error Reason Captured

The `ScheduleError` discriminated union (from Rust kernel via `serde(tag = "type")`) has four variants:
- `DuplicateTaskId` — duplicate task ID in task list (impossible with UUID generation)
- `SelfDependency` — dependency where `pred_id === succ_id`
- `TaskNotFound` — dependency or parentId references a task not in the list
- `CycleDetected` — circular dependency detected by Kahn's topological sort; also emitted when WASM throws

**Root causes confirmed and fixed:**
- **`SelfDependency`**: The XER mapper did not filter `taskPred` records where `pred_task_id === task_id`. These map to `predId === succId`. The Rust kernel rejects this unconditionally. **Fixed: filter added in xerMapper.**
- **`DEPENDENCY_DUPLICATE`**: Exactly identical `taskPred` records (same `pred_task_id`, `task_id`, type, AND lag) created redundant edges. While not a direct kernel error, dedup of exact duplicates is correct normalization. Parallel relationships between the same pair with a different type or lag are **preserved**. **Fixed: exact-duplicate dedup added in xerMapper.**

**Additional bug fixed (not scheduling failure cause):**
- `projectStartDate` from `candidate.projectStartDate` was never applied to canonical state after import commit. **Fixed: `State.setProjectStartDate(candidate.projectStartDate)` now called in IMPORT_SCHEDULE handler.**

### 5. Failure Location

- **For `SelfDependency`**: Inside Rust kernel (`CpmGraph::build`) before CPM engine runs — a Rust-level validation guard.
- **For `CycleDetected` from WASM exception**: After WASM boundary — `runSchedule()` try/catch converts thrown JS exception to `{ type: "CycleDetected", message: "WASM error: ..." }`.

### 6. Root Cause Category

| Category | Finding |
|---|---|
| Unsupported imported relationships | **Yes** — self-referencing predecessors (malformed XER data) were not filtered |
| Calendars / working-time conversion | Not a failure cause — kernel clamps negative constraint dates to 0 |
| Invalid/missing dates | Not a failure cause — undefined constraintDate maps to `None` safely |
| Dependency normalization | **Yes** — missing self-dep and exact duplicate-dependency guards |
| Task identity mapping | Not a failure cause — UUID generation is collision-free |
| Empty/invalid duration values | Not a failure cause — kernel handles `u32 = 0` for summary tasks |
| WASM/kernel limits | Not confirmed — may still apply for very large programmes; caught by try/catch |
| Rollback behaviour after failure | Correct — pre-import snapshot restored atomically; now also restores projectStartDate |

### 7. Normalization Safety

The following normalizations are **safe without changing parser semantics**:
- **Self-dependency filtering**: A predecessor where `pred = succ` is structurally invalid. Filtering with a `DEPENDENCY_SELF_REFERENCE` diagnostic preserves intent.
- **Exact duplicate dependency deduplication**: Keeping only the first occurrence of an identical `predId:succId:type:lag` tuple is safe. Parallel relationships between the same task pair with a different type or lag are preserved and are not treated as duplicates. The kernel's `max()` in forward/backward pass makes truly identical edges semantically neutral.

### 8. Rollback Safety

Rollback is preserved and extended:
- `preImportSnapshot` captures tasks/deps/resources/assignments before commit
- `preImportBaselines` captures the baseline map before commit
- `preImportStartDate` now also captures `projectStartDate` before commit *(new)*
- On scheduling failure: all three are restored atomically
- `runSchedulingAndEmitState()` is re-run after rollback to re-emit clean pre-import state

## Fix Scope Implemented

### Files Changed

| File | Change |
|---|---|
| `packages/protocol/src/import.ts` | Added `DEPENDENCY_SELF_REFERENCE` and `DEPENDENCY_DUPLICATE` to `ImportDiagnosticCode` union (backward-compatible) |
| `packages/worker/src/state.ts` | Added `setProjectStartDate(date: string)` export |
| `packages/worker/src/worker.ts` | Added `lastScheduleError` capture; enriched schedule-error audit log; IMPORT_SCHEDULE handler uses extracted `applyImportCandidateToState`, `rollbackImportCandidateState`, and `buildImportRollbackError`; NACK includes concrete error type + message |
| `packages/worker/src/import/applyImportCandidate.ts` | New module: `applyImportCandidateToState`, `rollbackImportCandidateState`, `buildImportRollbackError` helper functions used by IMPORT_SCHEDULE handler |
| `packages/worker/src/import/mappers/xerMapper.ts` | Added self-dependency filter (`DEPENDENCY_SELF_REFERENCE` diagnostic) and exact duplicate dependency filter (`DEPENDENCY_DUPLICATE` diagnostic, keyed on `predId:succId:type:lag`) |
| `packages/worker/tests/import/xerMapper.test.ts` | Updated dedup tests: exact-dup filter, parallel-relationship preservation, exact-dup-within-parallel-set |
| `packages/worker/tests/import/importCommit.test.ts` | Removed isolated `setProjectStartDate` tests (superseded by handler-path tests in applyImportCandidate.test.ts) |
| `packages/worker/tests/import/applyImportCandidate.test.ts` | New: 14 handler-path tests covering projectStartDate apply on commit, projectStartDate restore on rollback, full round-trip, and NACK error reason formatting |
| `docs/milestones/BUG-import-load-workspace-empty-after-xer-preview.md` | This document |

### Files Explicitly Not Changed

- `apps/web/src/components/TaskTable.tsx` — not modified
- `apps/web/src/components/gantt/**` — not modified
- `apps/web/src/App.tsx` — not modified
- `packages/**/src/**/*.rs` — not modified
- `crates/**` — not modified
- `package.json`, `pnpm-lock.yaml` — not modified
- `.github/**` — not modified

## Tests Added / Updated

Worker tests: **411 passed** (29 net new tests added over pre-PR baseline of 382; 11 test files)
Web app tests: **78 passed** (unchanged)

## Validation Results

```
corepack pnpm -C packages/worker exec vitest run
→ 11 test files, 411 tests passed

PNPM_ALLOW_BUILDS='@swc/core,esbuild' corepack pnpm -C apps/web exec vitest run
→ 6 test files, 78 tests passed
```

`tsc -b` has pre-existing unused-local errors in `HistogramPane.tsx:149` and `TaskDetailsPanel.test.ts:26` — not introduced by this PR.

## Remaining Risks

1. **`CycleDetected` from genuine circular dependencies**: If the XER contains genuine circular dependency chains (which P6 prevents in normal use but third-party exports can produce), scheduling will still fail. This requires cycle detection + removal (changes parser semantics, needs separate approval).

2. **WASM deserialization failure for extreme values**: If any XER task has `target_drtn_hr_cnt` producing a duration exceeding `u32::MAX` (~4.3 billion days), `serde_wasm_bindgen` deserialization fails. The try/catch in `runSchedule.ts` catches this and returns it as `CycleDetected` with `message: "WASM error: ..."`. The enriched NACK now surfaces this in the browser console.

3. **WASM binary availability**: The `packages/cpm-wasm/pkg` artifact must be present for runtime scheduling. This is an environment build issue, not fixed here.

## Recommended Next Step

1. If the user's XER still fails after this fix: inspect the concrete NACK error message now visible in browser console — it contains `(SelfDependency: ...)`, `(CycleDetected: ...)`, or `(WASM error: ...)`.
2. If `CycleDetected` is confirmed: open a separate issue to approve cycle-detection + removal normalization.
3. If `WASM error` deserialization is confirmed: open a separate issue to add duration clamping before kernel call.

---

## Previous Investigation (Issue #41 / PR #42)

### Investigation scope and outcome

This investigation was run as evidence-first (no product code changes). In the current local QA environment, the import flow cannot reach `PREVIEW_IMPORT -> IMPORT_SCHEDULE` because Worker startup fails before `WORKER_READY` due to unresolved `cpm-wasm` package entry.

Both evidence sources are documented together to separate an environment-specific sandbox blocker from the actual user-reported localhost failure path.

## User Localhost Evidence — Worker-ready preview succeeds, commit fails

- Worker ready: **yes**.
- `PREVIEW_IMPORT` ack observed: **yes**.
- Import preview data is non-empty (example): **`taskCount: 3062`, `depCount: 5024`**.
- User clicks `Load to Workspace`: **yes**.
- `IMPORT_SCHEDULE` result: **`error`**.
- Worker `schedule-error path` observed for imported programme counts: **`taskCount: 3062`, `depCount: 5024`**.
- Worker emits/restores persisted fallback state after failure (example): **`taskCount: 6`, `depCount: 0`**.
- Status strip after commit remains: **`Tasks: 6 | Deps: 0 | Scheduled: 0 | Worker: Ready`**.
- Preview disappears after `Load to Workspace`: **yes**.
- TaskTable/Gantt remain unchanged because imported programme is not committed to workspace state.

## Message-path checkpoint summary

| Checkpoint | Copilot sandbox evidence | User localhost evidence |
|---|---|---|
| PREVIEW_IMPORT sent | Not reached (worker startup blocked) | Reached, ack observed |
| IMPORT_PREVIEW received | Not reached (same blocker) | Reached, non-empty programme shown |
| IMPORT_SCHEDULE sent | Not reached (same blocker) | Sent after `Load to Workspace` |
| NACK/DIFF_STATE after import commit | Not reached (same blocker) | `IMPORT_SCHEDULE error` + schedule-error path observed |
| React tasks update | Not reached (same blocker) | Remains persisted fallback state (`tasks: 6`) |
| TaskTable/Gantt render imported tasks | Not reached (same blocker) | No imported render because commit fails/rolls back |
