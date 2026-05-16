# 1. Executive Summary

Phase 1 audit completed for **W5B-UI.RECOVERY.1**.

`main` (technical baseline) and `backup/wip-before-ai-workflow-2026-05-13` (visual/UI source) diverge heavily in `apps/web/src` (**98 files changed; 22031 insertions / 1051 deletions**).

Key finding: the WIP branch includes richer UI shell surfaces, but also broad feature/protocol-era differences. A direct restore (file overwrite/cherry-pick-all) is unsafe and would risk regressing B2.12A.15–18.

# 2. Source Branches and Baselines

- Technical baseline (must preserve): `main`
- UI recovery source (visual shell reference): `backup/wip-before-ai-workflow-2026-05-13`
- Current working branch for this audit: `copilot/w5b-ui-recovery-restore-wip-ui-shell`

Proposed Phase 2 branch (per recommendation):
- `recovery/W5B-UI.RECOVERY.1` (branch from latest `main`)

# 3. Current Problem Statement

Observed branch divergence: current `main` includes B2.12A.15–18 technical migration work; backup WIP branch appears to contain the richer Planner-Studio shell.

Recovery objective remains:
- restore/reconcile richer shell presentation from WIP
- while preserving all B2.12A.15–18 behaviors and safeguards on latest `main`
- with controlled, file-level reconciliation only (no destructive branch replacement)

# 4. Diff Summary

Required audit commands were executed.

## 4.1 Repository state

- `git status --short` → clean before doc update
- `git branch --show-current` → `copilot/w5b-ui-recovery-restore-wip-ui-shell`
- `git log --oneline -5` captured in audit run output

## 4.2 Main vs WIP scope (`apps/web/src`)

- `git diff --name-status main..backup/wip-before-ai-workflow-2026-05-13 -- apps/web/src`
- `git diff --stat main..backup/wip-before-ai-workflow-2026-05-13 -- apps/web/src`

Result highlights:
- Massive divergence: **98 files changed**
- Many additions in WIP: AI panels/services/tests, calendar/driving/float-path panels, dashboard/report panels, task context menu, hierarchy/table overlays
- Modified core surfaces include:
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/TaskTable.tsx`
  - `apps/web/src/ui/components/shell/*`
  - `apps/web/src/components/gantt/*`

# 5. UI Files Likely to Restore from WIP

These are **candidate** UI shell/layout restores for Phase 2 (apply selectively onto `main`, not wholesale):

- `apps/web/src/ui/components/shell/TopBar.tsx` (+ related `TopBar.test.tsx` as needed)
- `apps/web/src/ui/components/shell/Toolbar.tsx`
- `apps/web/src/ui/components/drawer/DrawerTabBar.tsx`
- Presentation-only shell composition segments in `apps/web/src/App.tsx` (manual hunk-level merge only)
- Gantt presentation refinements from `apps/web/src/components/gantt/*` where changes are visual/layout and do not alter authority/protocol assumptions

Note: `apps/web/src/App.css` exists in both branches but has no diff in this audit.

# 6. Files That Must Preserve Latest main Changes

Must preserve from latest `main` during any Phase 2 reconciliation:

1. `apps/web/src/components/TaskTable.tsx`
   - `toWorkerTaskUpdate(...)`
   - `getDisplayTotalFloat(...)`
   - `totalFloatWorkdays` display preference and legacy fallback behavior
2. `apps/web/src/components/TaskTable.test.ts`
   - tests covering display preference + payload sanitization
3. Worker raw-minute migration paths:
   - `packages/worker/src/floatMinutes.ts`
   - `packages/worker/src/constraintDiagnostics.ts`
   - `packages/worker/src/worker.ts`
   - `packages/worker/tests/floatMinutes.test.ts`
4. Legacy deprecation docs:
   - `docs/milestones/W5B-B2.12A.18-legacy-float-field-deprecation-plan.md`
5. AI003 blocked status (do not enable/relax)

# 7. Conflict-Prone Files

High-risk files requiring explicit human-reviewed merge strategy:

- `apps/web/src/App.tsx`
  - Very large diff; WIP includes major additional feature wiring and protocol import changes (`@planner/protocol` vs `protocol` in current main)
- `apps/web/src/components/TaskTable.tsx`
  - Main contains B2.12A.17 must-preserve helpers/sanitization markers
  - WIP version differs substantially and does not expose the same marker set in the audit grep output
- `apps/web/src/components/gantt/*`
  - Broad rendering/timescale changes; may be visual, but risk of behavior coupling
- `apps/web/src/ui/store/uiStore.ts`
  - shell behavior toggles/state shape changes can ripple into app orchestration

# 8. Critical-File Expected Diff Notes

## 8.1 `apps/web/src/App.tsx`

Expected in Phase 2:
- Keep `main` as base file.
- Bring over only shell/layout composition needed to match richer UI.
- Do **not** replace protocol/worker orchestration wholesale.
- Reject broad feature imports/services unless explicitly approved for this milestone.

## 8.2 `apps/web/src/components/TaskTable.tsx`

Expected in Phase 2:
- Preserve `toWorkerTaskUpdate(...)` payload sanitization behavior.
- Preserve `getDisplayTotalFloat(...)` + `totalFloatWorkdays` preference.
- If layout enhancements are needed, merge surgically around these helpers and keep main tests green.

## 8.3 `apps/web/src/ui/*` and `apps/web/src/components/gantt/*`

Expected in Phase 2:
- Apply visual/shell deltas first.
- Validate no protocol, authority, scheduling, or worker contract drift is introduced.
- Revert/stop immediately if visual files imply non-UI coupling.

# 9. B2.12A.15–18 Must-Preserve Checklist

- [x] `getDisplayTotalFloat(...)` present on `main` TaskTable and must be retained.
- [x] `toWorkerTaskUpdate(...)` present on `main` TaskTable and must be retained.
- [x] `totalFloatWorkdays` display preference + legacy fallback present in `main` TaskTable/tests.
- [x] Display/workday fields stripped from UI update payloads (covered by `toWorkerTaskUpdate` + tests).
- [x] Worker raw-minute helper path present on `main`:
  - `getTotalFloatMinutesForComparison(...)`
  - `maxAbsTotalFloatVarianceMinutes(...)`
- [x] Legacy float deprecation documentation exists on `main` (B2.12A.18 milestone doc).
- [x] AI003 remains blocked (no enablement changes in this audit).

# 10. Recommended Phase 2 Implementation Sequence

1. Create `recovery/W5B-UI.RECOVERY.1` from latest `main`.
2. Reconfirm Phase 1 diff inventory before editing.
3. Reconcile **shell chrome first** (`ui/components/shell/*`, drawer tab bar) with minimal hunks.
4. Reconcile App shell composition in `App.tsx` with strict hunk selection.
5. Evaluate/merge Gantt presentation deltas only if purely visual.
6. Handle `TaskTable.tsx` last with explicit preservation of B2.12A helpers/tests.
7. Run required validations; if preservation fails, stop and rollback last reconciliation step.
8. Prepare evidence matrix: restored files vs preserved files vs conflict notes.

# 11. Validation Plan for Phase 2

Minimum required validation commands:

```bash
git status --short
git diff --stat
pnpm -C apps/web exec vitest run
pnpm -C packages/worker exec vitest run
```

If feasible:

```bash
pnpm -C apps/web exec tsc -b
pnpm -C packages/worker exec tsc --noEmit
```

Plus targeted checks:
- Verify `TaskTable` tests covering `getDisplayTotalFloat`/`toWorkerTaskUpdate` remain passing.
- Visual localhost confirmation of restored shell before acceptance.

# 12. Explicit Stop Conditions

Stop immediately and escalate for human review if any of the following occurs:

1. Recovery requires modifying Worker/protocol/Rust/WASM to make UI shell compile/run.
2. Recovery requires scheduling logic changes.
3. Recovery requires gate/tolerance/authority behavior changes.
4. Recovery requires persistence/UAT/production enablement changes.
5. Recovery requires resetting/replacing `main` or wholesale copying `apps/web/src` from WIP.
6. Conflict resolution cannot preserve B2.12A.15–18 markers/tests.
7. Diff scope becomes too ambiguous/large for safe hunk-level reconciliation.
8. `backup/wip-before-ai-workflow-2026-05-13` reference becomes unavailable.

# 13. Safety Confirmation

Confirmed for Phase 1:
- Audit/diff only; no UI implementation restore performed.
- No Worker/protocol/Rust/WASM changes.
- No scheduling logic, authority, gate, persistence, UAT, or production behavior changes.
- No destructive git operations (no reset/force-push/branch overwrite).
- Forbidden strategy explicitly rejected: no wholesale replacement from WIP.

# 14. Recommended Next Step

Proceed to **Phase 2 (controlled restore)** only after review/approval of this audit.

Execution should start on `recovery/W5B-UI.RECOVERY.1` from latest `main`, following the sequence and stop conditions above.
