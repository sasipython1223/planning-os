# 1. Executive Summary

This recovery slice restored a richer App/workspace shell composition on top of latest `main` without touching TaskTable internals, Gantt internals, Worker logic, protocol contracts, or Rust/WASM code.

The controlled restore selectively brought back WIP shell-composition ideas from `backup/wip-before-ai-workflow-2026-05-13`:

- a higher-level workspace overview/header
- a more structured command bar for workspace actions
- a compact right-side action rail inside the main workspace

The existing Recovery 1B shell chrome (`TopBar`, `Toolbar`, shell CSS) remains intact.

# 2. Scope Confirmation

In scope work completed:

- `apps/web/src/App.tsx` presentation/layout composition only
- minimal shell CSS additions in `apps/web/src/index.css`
- focused shell helper test in `apps/web/src/App.test.ts`
- this recovery evidence document

Out of scope and not changed:

- TaskTable internals
- Gantt/timescale internals
- Worker scheduling logic
- protocol contracts
- Rust/WASM
- authority/gate/tolerance behavior
- persistence/UAT/production/AI003 enablement

# 3. Source Branches and Recovery Branch

- Technical baseline: `main`
- Visual recovery source: `backup/wip-before-ai-workflow-2026-05-13`
- Local recovery branch used: `recovery/W5B-UI.RECOVERY.2-app-shell-composition`

# 4. App Shell Differences Reviewed

Required review commands were executed against `origin/main` and `origin/backup/wip-before-ai-workflow-2026-05-13`:

- `git diff --stat ... -- apps/web/src/App.tsx apps/web/src/ui apps/web/src/App.css apps/web/src/index.css`
- `git diff ... -- apps/web/src/App.tsx`
- `git diff ... -- apps/web/src/ui/store/uiStore.ts`
- `git diff ... -- apps/web/src/ui/components/WorkspaceSplitter.tsx`
- `git diff ... -- apps/web/src/index.css`

Findings used for the controlled restore:

- WIP `App.tsx` contains a much richer shell composition, but also large incompatible feature/protocol-era divergence.
- WIP `uiStore.ts` and `WorkspaceSplitter.tsx` did not need to be restored for this slice.
- WIP `index.css` includes reusable shell composition styling patterns, especially for command-bar buttons and the action rail.

Only shell-composition ideas that remained UI-only and compatible with latest `main` were applied.

# 5. Files Changed

- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `apps/web/src/App.test.ts`
- `docs/milestones/W5B-UI.RECOVERY.2-app-shell-composition-recovery.md`

# 6. Files Explicitly Not Changed

- `apps/web/src/components/TaskTable.tsx`
- `apps/web/src/components/TaskTable.test.ts`
- `apps/web/src/components/gantt/*`
- `apps/web/src/ui/store/uiStore.ts`
- `apps/web/src/ui/components/WorkspaceSplitter.tsx`
- `packages/worker/src/*`
- `packages/worker/tests/*`
- `packages/protocol/*`
- Rust / WASM sources

# 7. App Shell Composition Restored

Restored composition improvements:

- Added a workspace overview panel above the split table/Gantt area.
- Added a structured command bar that groups task creation, baseline, undo/redo, import, and histogram-resource controls.
- Added a compact workspace action rail inside the main split workspace, visually closer to the WIP shell.
- Wrapped the main workspace in richer shell-level styling so the table/Gantt split now sits inside a clearer composed workspace surface.

Skipped on purpose:

- WIP menu-bar feature surfaces
- WIP float-path panels
- WIP protocol-era imports and advanced controls
- any TaskTable or Gantt internal behavior changes

# 8. B2.12A.15–18 Preservation Checklist

- [x] `getDisplayTotalFloat(...)` preserved
- [x] `toWorkerTaskUpdate(...)` preserved
- [x] `totalFloatWorkdays` display preference preserved
- [x] display/workday field stripping before Worker update preserved
- [x] `apps/web/src/components/TaskTable.test.ts` preserved
- [x] `getTotalFloatMinutesForComparison(...)` preserved
- [x] `maxAbsTotalFloatVarianceMinutes(...)` preserved
- [x] raw-minute comparator/evidence path files untouched
- [x] deprecation-plan document untouched

# 9. Recovery 1B Preservation Checklist

- [x] `apps/web/src/ui/components/shell/TopBar.tsx` preserved
- [x] `apps/web/src/ui/components/shell/Toolbar.tsx` preserved
- [x] Recovery 1B shell chrome CSS in `apps/web/src/index.css` preserved
- [x] App shell recovery was layered on top of existing shell chrome rather than replacing it

# 10. Validation Commands and Results

Commands run:

```bash
git status --short
git diff --stat
pnpm -C apps/web exec vitest run
pnpm -C packages/worker exec vitest run
pnpm -C apps/web exec tsc -b
pnpm -C packages/worker exec tsc --noEmit
grep -R "getDisplayTotalFloat\|toWorkerTaskUpdate\|totalFloatWorkdays" -n apps/web/src/components/TaskTable.tsx apps/web/src/components/TaskTable.test.ts
grep -R "getTotalFloatMinutesForComparison\|maxAbsTotalFloatVarianceMinutes" -n packages/worker/src packages/worker/tests
```

Results:

- `pnpm -C apps/web exec vitest run` ✅ passed (`6` files, `74` tests)
- `pnpm -C packages/worker exec vitest run` ✅ passed (`10` files, `393` tests)
- `pnpm -C apps/web exec tsc -b` ⚠️ failed with pre-existing unused-variable errors already present on untouched `main`
- `pnpm -C packages/worker exec tsc --noEmit` ⚠️ failed with pre-existing worker typecheck issues in untouched worker files
- preservation marker grep checks ✅ matched required markers

Environment note:

- local validation required temporary `pnpm approve-builds --all` approval for `@swc/core` and `esbuild`
- the generated `pnpm-workspace.yaml` approval edit was reverted and is **not** part of this change set

# 11. Known Pre-existing Issues

Observed on untouched/latest-main baseline before this change:

- web typecheck already failed on unused variables in:
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/HistogramPane.tsx`
  - `apps/web/src/components/TaskDetailsPanel.test.ts`

Observed after this change, still unrelated to this recovery slice:

- worker typecheck fails in untouched files:
  - `packages/worker/src/import/parsers/mspParser.ts`
  - `packages/worker/src/wasm/loadCpmWasm.ts`

These failures were documented rather than fixed because they are outside the approved shell-composition scope.

# 12. Localhost Visual Confirmation Notes

Local visual verification was performed with:

```bash
pnpm -C apps/web dev
```

Notes:

- local page served at `http://127.0.0.1:4173`
- headless Chromium screenshot captured to `/tmp/planning-os-app-shell.png`
- DOM dump confirmed the recovered shell landmarks render:
  - `Recovered workspace shell`
  - `Schedule workspace`
  - workspace summary cards
  - command bar
  - `Workspace actions` rail

This looks materially closer to the richer WIP shell than current `main`, while still using latest-main behavior and safeguards.

# 13. Stop Conditions Encountered / Not Encountered

Not encountered:

- TaskTable internals required for shell recovery
- Gantt/timescale internals required for shell recovery
- Worker changes required
- protocol/type changes required
- Rust/WASM changes required
- scheduling logic changes required
- authority/gate/tolerance changes required
- persistence/UAT/production changes required
- preservation marker conflicts

Encountered and handled:

- WIP `App.tsx` contains incompatible broader feature/protocol assumptions, so only shell-level composition motifs were selectively reapplied.

# 14. Safety Confirmation

- Worker remains source of truth
- React scheduling logic was not introduced
- TaskTable and Gantt internals were not modified
- Worker/protocol/Rust/WASM were not modified
- Recovery 1B shell chrome remains in place
- B2.12A.15–18 preservation markers remain present
- AI003 remains blocked / not enabled by this slice

# 15. Recommended Next Recovery Slice

Recommended next slice:

- continue controlled visual recovery inside the workspace body only if needed
- evaluate whether any additional WIP visual refinements can be restored without touching TaskTable/Gantt internals
- if a future visual target requires TaskTable or Gantt internals, stop and open a separate explicitly approved recovery slice for those components
