# 1. Executive Summary

Implemented a UI display-only migration for total float rendering in the web task table.  
`TaskTable` now prefers display/workday float (`totalFloatWorkdays`) when present, with legacy `totalFloat` fallback preserved.  
Added read-only safeguards and tests proving display/workday float fields are not forwarded into Worker update payloads.

# 2. Scope Confirmation

In scope and completed:
- UI display consumer migration in `apps/web/src/components/TaskTable.tsx`
- UI tests for display preference, fallback, and read-only payload behavior
- Milestone evidence document

Out of scope and unchanged:
- Worker scheduling logic
- comparator/evidence logic
- protocol contracts/types
- Rust/WASM
- CI/build scripts and production/UAT/gates

# 3. Field Authority Model

- Authoritative scheduling outside UI display remains raw-minute/legacy schedule result fields from Worker output.
- UI display fields (`totalFloatWorkdays`, and future display/workday fields) are user-facing only.
- `TaskTable` now reads `totalFloatWorkdays` for display when available.
- UI update payloads are explicitly sanitized so display/workday float fields are never written back to Worker state.

# 4. Files Changed

- `apps/web/src/components/TaskTable.tsx`
- `apps/web/src/components/TaskTable.test.ts`
- `docs/milestones/W5B-B2.12A.17-ui-display-workday-migration.md`

# 5. UI Consumers Migrated

- Migrated: Task table total-float display cell (`TaskTable`, TF column)
  - now prefers `totalFloatWorkdays`
  - falls back to legacy `totalFloat`
- Reviewed and unchanged:
  - `TaskDetailsPanel` does not currently render total/free float values
  - Gantt display surfaces do not currently render total/free float values

# 6. Field Usage Before / After

- Before (`TaskTable` TF display):
  - `schedule?.totalFloat ?? "—"`
- After (`TaskTable` TF display):
  - `getDisplayTotalFloat(schedule)`
  - preference order:
    1. `totalFloatWorkdays` when finite number
    2. legacy `totalFloat`
    3. `"—"` when no schedule

Worker update path in `TaskTable`:
- Before: direct inline objects passed to `onUpdateTask(...)`
- After: all updates pass through `toWorkerTaskUpdate(...)`, which strips:
  - `totalFloat`, `totalFloatMinutes`, `totalFloatWorkdays`
  - `freeFloat`, `freeFloatMinutes`, `freeFloatWorkdays`

# 7. Read-Only UI Safeguards

- Added `toWorkerTaskUpdate(...)` in `TaskTable` and routed all `onUpdateTask(...)` calls through it.
- `toWorkerTaskUpdate(...)` removes display/workday float fields from outgoing UI update payloads.
- This enforces that display-only fields remain non-authoritative and read-only in UI mutation paths.

# 8. Tests Added or Updated

Added:
- `apps/web/src/components/TaskTable.test.ts`
  - prefers `totalFloatWorkdays` for display when available
  - falls back to legacy `totalFloat` when display field absent
  - falls back to legacy `totalFloat` when display field is non-finite
  - returns `"—"` when schedule is missing
  - strips display/workday float fields from update payloads

Existing behavior stability:
- Existing web tests remain passing, including TaskDetails and geometry test suites.

# 9. Validation Commands and Results

Pre-change baseline:
- `git --no-pager status --short` ✅ clean
- `git --no-pager diff --stat` ✅ empty
- `corepack pnpm -C apps/web exec vitest run` ✅ passed (4 files, 66 tests)
- `corepack pnpm -C apps/web exec tsc -b` ❌ failed with pre-existing unused-variable/test-helper errors outside this milestone scope
- `corepack pnpm -C apps/web exec eslint .` ❌ failed with pre-existing lint errors outside this milestone scope

Post-change:
- `corepack pnpm -C apps/web exec vitest run src/components/TaskTable.test.ts src/components/TaskDetailsPanel.test.ts` ✅ passed (2 files, 46 tests)
- `corepack pnpm -C apps/web exec vitest run` ✅ passed (5 files, 71 tests)
- `corepack pnpm -C apps/web exec tsc -b` ❌ same pre-existing failures (`App.tsx`, `HistogramPane.tsx`, `TaskDetailsPanel.test.ts`) and no new failures introduced by this milestone

# 10. Code Review Checklist

- [x] No display/workday fields are written back to Worker state.
- [x] No UI component mutates authoritative scheduling fields.
- [x] No display/workday fields are used as scheduling inputs.
- [x] React contains no scheduling logic.
- [x] Worker remains source of truth.
- [x] AI003 remains blocked.

# 11. Forbidden Files Confirmation

Confirmed no changes to forbidden areas:
- `packages/worker/**`
- `packages/protocol/src/**`
- `packages/cpm-wasm/**`
- `packages/cpm-kernel/**`
- `crates/**`
- `.github/**`
- `package.json`, `pnpm-lock.yaml`, CI config files

# 12. Safety Confirmation

- Migration is display-only and limited to UI rendering and UI tests.
- Legacy compatibility fallback is preserved.
- Authoritative scheduling logic and non-UI consumers are untouched.
- No protocol, Worker, comparator, Rust, or WASM behavior changed.

# 13. Recommended Next Milestone

Proceed to the next planned consumer slice: migrate any remaining UI-adjacent display surfaces (if introduced later) to explicit display/workday fields using the same read-only guard pattern, then continue with deprecation planning for legacy float display paths once all consumers are migrated.
