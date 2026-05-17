# W5B-UI.R3 — Core App Shell Implementation

## 1. Executive Summary

Implemented a shell-focused UI composition pass for Planner-Studio by adding an explicit app shell frame, menu bar, command toolbar, project/import status strip, workspace routing (empty/preview/loaded), inspector placeholder, and diagnostics drawer placeholder wrapper while preserving existing TaskTable and Gantt surfaces as black boxes.

## 2. Scope Confirmation

This implementation is limited to shell structure and composition only:

- App shell frame and top-level shell composition added.
- Menu/toolbar/status strip shell surfaces added.
- Workspace container routing added for empty/preview/loaded shell states.
- Inspector placeholder and diagnostics drawer placeholder structure added.
- Existing TaskTable/Gantt/worker wiring retained.

No scheduling authority, protocol, worker, Rust/WASM, or persistence changes were introduced.

## 3. Files Changed

- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `apps/web/src/ui/shell/AppShell.tsx`
- `apps/web/src/ui/shell/MenuBar.tsx`
- `apps/web/src/ui/shell/CommandToolbar.tsx`
- `apps/web/src/ui/shell/ProjectStatusStrip.tsx`
- `apps/web/src/ui/workspace/WorkspaceLayout.tsx`
- `apps/web/src/ui/workspace/EmptyWorkspace.tsx`
- `apps/web/src/ui/workspace/ProgrammePreviewPanel.tsx`
- `apps/web/src/ui/workspace/ScheduleWorkspace.tsx`
- `apps/web/src/ui/panels/InspectorPanel.tsx`
- `apps/web/src/ui/panels/BottomDiagnosticsDrawer.tsx`
- `apps/web/src/ui/state/uiViewState.ts`
- `apps/web/src/ui/state/uiViewState.test.ts`
- `docs/milestones/W5B-UI.R3-core-app-shell-implementation.md`

## 4. Files Explicitly Not Changed

- `packages/worker/**`
- `packages/protocol/**`
- `packages/**/src/**/*.rs`
- `crates/**`
- `apps/web/src/components/TaskTable.tsx`
- `apps/web/src/components/gantt/**`
- `apps/web/src/components/data/**`
- `package.json`
- `pnpm-lock.yaml`
- `.github/**`

## 5. Component Boundaries Implemented

- `ui/shell/*` owns shell frame/menu/command/status composition.
- `ui/workspace/*` owns workspace layout and view routing shells.
- `ui/panels/*` owns inspector and diagnostics drawer placeholder shells.
- `ui/state/uiViewState.ts` owns UI-only routing derivation (`empty | preview | loaded`).
- Existing schedule surfaces (`TaskTable`, `GanttPane`) are embedded unchanged in loaded workspace mode.

## 6. Worker/Authority Preservation

Worker remains source of truth. Commands still dispatch through existing worker pathways (`postMessage` actions already present in `App.tsx`). No new worker protocol messages were introduced.

## 7. UI State Ownership

React-local UI state added/used only for shell presentation concerns:

- workspace shell routing (`deriveWorkspaceShellView` from existing app state)
- inspector visibility
- diagnostics drawer visibility (existing store pathway)

No duplicated authoritative schedule model was introduced.

## 8. `App.tsx` / `ui/state/**` Safety Notes

`App.tsx` updates are limited to shell composition and view routing. `ui/state/**` contains only UI-view-state derivation logic and tests. No scheduling calculations, date/float/criticality derivations, dependency resolution, calendar resolution, import authority, persistence authority, or protocol evolution were added.

## 9. Validation Commands and Results

Commands run:

```bash
git status --short
git diff --stat
git diff --name-only
pnpm -C apps/web exec vitest run
pnpm -C apps/web exec tsc -b
```

Results:

- `vitest run`: **pass** (6 files, 74 tests).
- `tsc -b`: **fails due to pre-existing unrelated issues**:
  - `apps/web/src/components/HistogramPane.tsx:149` unused local `mouseY`
  - `apps/web/src/components/TaskDetailsPanel.test.ts:26` unused local `_constraintNeedsDate`

## 10. Localhost Visual Confirmation Notes

Verified locally with Vite at `http://127.0.0.1:4173`.

Observed shell improvements:

- clear shell frame with menu, command toolbar, and status strip
- explicit empty/preview/loaded workspace shell routing
- loaded workspace keeps existing TaskTable + Gantt placement
- inspector placeholder panel appears as right-side container
- diagnostics drawer has explicit collapsed/open shell presentation

Screenshot captured: `/tmp/w5b-ui-r3-shell.png`.

## 11. Stop Conditions Encountered / Not Encountered

No stop conditions were encountered. Shell changes were achievable without modifying TaskTable internals, Gantt internals, worker/protocol/Rust boundaries, or scheduling authority.

## 12. Safety Confirmation

- Worker authority preserved: yes
- React scheduling authority added: no
- New protocol messages added: no
- TaskTable internals modified: no
- Gantt internals modified: no
- Persistence/UAT/production behavior changed: no
- AI003 enabled: no

## 13. Recommended Next Milestone

Proceed to **W5B-UI.R4 — XER/MSP import workflow UX** with shell scaffolding now in place.
