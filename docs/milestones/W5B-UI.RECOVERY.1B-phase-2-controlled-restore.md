# 1. Executive Summary

Phase 2 controlled restore was executed on `recovery/W5B-UI.RECOVERY.1` as a hunk-level UI-shell reconciliation.

Recovered shell chrome presentation from WIP was applied only to existing shell components:
- `TopBar.tsx`
- `Toolbar.tsx`
- shell CSS in `apps/web/src/index.css`

All B2.12A.15–18 must-preserve markers remain present and validated. No Worker/protocol/Rust/WASM/scheduling/authority/gate/persistence/UAT/production changes were made.

# 2. Scope Confirmation

In-scope:
- Controlled UI-shell chrome restoration only.
- Hunk-level visual reconciliation.

Out-of-scope (preserved on main):
- Worker logic and raw-minute migration paths.
- Protocol contracts.
- Rust/WASM boundaries.
- TaskTable float migration behavior.
- AI003 enablement.

# 3. Recovery Branch and Source Branches

- Recovery branch: `recovery/W5B-UI.RECOVERY.1` (from latest `origin/main`)
- Source WIP reference: `origin/backup/wip-before-ai-workflow-2026-05-13`
- Base preserved: `origin/main`

# 4. Files Restored from WIP

Hunk-level presentation restoration influenced by WIP shell chrome:

- `apps/web/src/ui/components/shell/TopBar.tsx`
  - moved from inline style block to shell-chrome class composition (`topbar`, `topbar-title`, `topbar-status`).
- `apps/web/src/ui/components/shell/Toolbar.tsx`
  - retained existing behavior but reconciled visual structure to shell toolbar classes (`shell-toolbar*`).
- `apps/web/src/index.css`
  - added shell chrome style rules for top bar and toolbar classes.

No wholesale file replacement was performed.

# 5. Files Preserved from Main

Explicitly preserved (no behavior changes):

- `apps/web/src/components/TaskTable.tsx`
  - `getDisplayTotalFloat(...)`
  - `toWorkerTaskUpdate(...)`
  - `totalFloatWorkdays` display preference
  - display/workday update payload sanitization
- `apps/web/src/components/TaskTable.test.ts`
- `packages/worker/src/floatMinutes.ts`
  - `getTotalFloatMinutesForComparison(...)`
  - `maxAbsTotalFloatVarianceMinutes(...)`
- `packages/worker/src/constraintDiagnostics.ts`
- `packages/worker/src/worker.ts`
- `packages/worker/tests/floatMinutes.test.ts`
- `docs/milestones/W5B-B2.12A.18-legacy-float-field-deprecation-plan.md`

# 6. Conflict-Resolution Notes

- WIP `App.tsx` contains broad protocol-era and feature-surface drift (large menu/feature integrations, extra tabs, additional protocol types/services), which is incompatible with narrow controlled restore.
- WIP `components/gantt/*` deltas are large and include non-trivial behavioral risk (new model files and deep rendering logic changes), so no Gantt semantic deltas were merged.
- WIP `TaskTable.tsx` is heavily divergent; to preserve B2.12A.17 guarantees, TaskTable code/tests were left unchanged.

Resolution: apply only shell chrome visual hunks to existing shell components.

# 7. B2.12A.15–18 Preservation Checklist

- [x] `getDisplayTotalFloat(...)` preserved
- [x] `toWorkerTaskUpdate(...)` preserved
- [x] `totalFloatWorkdays` display preference preserved
- [x] display/workday payload stripping preserved
- [x] `getTotalFloatMinutesForComparison(...)` preserved
- [x] `maxAbsTotalFloatVarianceMinutes(...)` preserved
- [x] B2.12A.18 legacy float deprecation doc preserved
- [x] AI003 remains blocked (no enablement changes)

# 8. UI Recovery Summary

Recovered shell chrome improvements include:
- top bar class-based styling and stronger chrome visual treatment
- toolbar class-based button/filter styling with active-state affordances
- no changes to command wiring or scheduling behavior

# 9. Validation Commands and Results

Executed:

```bash
git status --short
git diff --stat
corepack pnpm -C apps/web exec vitest run
corepack pnpm -C packages/worker exec vitest run
corepack pnpm -C apps/web exec tsc -b
corepack pnpm -C packages/worker exec tsc --noEmit
grep -R "getDisplayTotalFloat\|toWorkerTaskUpdate\|totalFloatWorkdays" -n apps/web/src/components/TaskTable.tsx apps/web/src/components/TaskTable.test.ts
grep -R "getTotalFloatMinutesForComparison\|maxAbsTotalFloatVarianceMinutes" -n packages/worker/src packages/worker/tests
```

Results:
- `apps/web` vitest: pass (71/71).
- `packages/worker` vitest: pass (393/393).
- `apps/web` typecheck (`tsc -b`): fails with pre-existing unrelated TS6133 unused-variable errors in existing files.
- `packages/worker` typecheck (`tsc --noEmit`): fails with pre-existing environment/type-resolution issues (`Element`, `Document`, `DOMParser`, `cpm-wasm`).
- marker grep checks: pass; required markers remain present.

# 10. Localhost Visual Confirmation Notes

- Local dev server started successfully (`vite` on `http://127.0.0.1:4173/`).
- Automated screenshot capture via Playwright MCP was attempted but blocked by browser-profile lock error (`Browser is already in use for /root/.cache/ms-playwright/mcp-chrome`).
- Manual localhost visual confirmation is still required.

# 11. Stop Conditions Encountered / Not Encountered

Not encountered for implemented scope:
- no Worker/protocol/Rust/WASM/scheduling/gate/authority/persistence/UAT/production changes required for shell-chrome restoration.

Encountered at excluded scope (handled by non-application):
- broad WIP App/Gantt/TaskTable deltas imply incompatible protocol-era assumptions and non-visual behavior risk; therefore those broad deltas were not applied.

# 12. Safety Confirmation

- AI003 remains blocked.
- No authority/gate/tolerance weakening.
- No persistence/UAT/production enablement.
- No Worker/protocol/Rust/WASM contract or scheduling-logic changes.

# 13. Recommended Next Milestone

Proceed with a tightly scoped follow-up recovery slice for any additional visual-only shell parity gaps that can be cleanly isolated from protocol/worker feature drift, with explicit per-file acceptance criteria before each merge.
