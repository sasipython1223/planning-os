# W5B-UI.R2 — App Shell Architecture Plan

## 1. Purpose

W5B-UI.R2 translates the W5B-UI.R1 product specification into an app shell architecture plan.

This milestone prepares implementation boundaries for a future W5B-UI.R3 app shell implementation, but it does not implement R3.

R2 is documentation/architecture-planning only.

## 2. Background

W5B-UI.R1 established the product target for the deliberate Planner-Studio / Planning OS UI redesign.

R1 deliverable:

```text
docs/ui/W5B-UI.R1-planner-studio-ui-product-spec-and-wireframe.md
```

R1 confirmed:

- `main` remains the technical baseline.
- `backup/wip-before-ai-workflow-2026-05-13` is visual reference / idea bank only.
- WIP UI code must not be restored directly.
- React UI is display + command dispatch only.
- Worker remains authoritative.
- UI redesign proceeds through controlled milestones.

R2 converts that product baseline into architecture guidance for the app shell layer.

## 3. Architecture Principles

The app shell must preserve the core Planner-Studio architecture:

- React UI is display + command dispatch only.
- Web Worker is the authoritative scheduling state/orchestration layer.
- Translator / adapter layer handles schedule data conversion.
- Rust/WASM CPM engine performs deterministic scheduling calculations.
- React must not contain scheduling logic.
- Worker remains source of truth.
- AI features are advisory/read-only unless separately approved.
- AI003 remains blocked.
- No gate/tolerance/authority/persistence/UAT/production changes are included in R2.

## 4. R2 Scope

R2 defines architecture boundaries only.

R2 covers:

- proposed app shell components
- future file/folder structure for R3
- view-state ownership model
- Worker command-dispatch boundaries
- import/status strip shell architecture
- workspace split layout shell architecture
- table/Gantt integration boundaries
- inspector/drawer architecture
- R3 allowed and forbidden files
- R3 stop conditions
- R3 validation and evidence requirements

R2 does not create or modify source files.

## 5. App Shell Layers

The future shell should be organised into clear layers:

| Layer | Purpose | Authority |
|---|---|---|
| App shell | Overall product frame and layout zones | UI-only |
| Command surface | Menus, toolbar, visible user actions | Dispatch only |
| Status surface | Project/import/schedule state summary | Worker-derived state |
| Workspace shell | Empty, preview, loaded workspace routing | UI view state + Worker state projection |
| Schedule surfaces | Existing TaskTable and Gantt surfaces | Existing components, Worker-derived schedule data |
| Inspector surfaces | Details/resources/dependencies placeholders | Worker-derived data later |
| Diagnostics surfaces | Logs/diagnostics/histogram placeholders | Worker/diagnostics output later |

## 6. Proposed Future File/Folder Structure

R3 may introduce a shell-oriented structure similar to the following:

```text
apps/web/src/ui/shell/
  AppShell.tsx
  TopBar.tsx
  MenuBar.tsx
  CommandToolbar.tsx
  ProjectStatusStrip.tsx

apps/web/src/ui/workspace/
  WorkspaceLayout.tsx
  WorkspaceSplitter.tsx
  ScheduleWorkspace.tsx
  EmptyWorkspace.tsx
  ProgrammePreviewPanel.tsx

apps/web/src/ui/panels/
  InspectorPanel.tsx
  BottomDiagnosticsDrawer.tsx

apps/web/src/ui/state/
  uiViewState.ts
```

This structure is a planning target, not a requirement to create all files at once.

R3 should create the minimum viable shell components needed to improve structure without touching TaskTable/Gantt internals.

## 7. Proposed Component Responsibilities

### 7.1 `AppShell.tsx`

Purpose:

- Own the high-level visual frame.
- Compose top bar, menu bar, command toolbar, status strip, workspace, inspector, and diagnostics drawer.
- Receive Worker-derived application state from existing app-level wiring.
- Pass view-only props to child shell components.

Must not:

- calculate schedule values
- own authoritative task data
- mutate schedule data directly
- bypass Worker command pathways

### 7.2 `TopBar.tsx`

Purpose:

- Display product identity.
- Display project identity if available.
- Display high-level status badges.

Allowed data:

- project name
- file/import state summary
- worker status summary
- advisory status badges

Must not:

- calculate project status
- infer schedule health independently

### 7.3 `MenuBar.tsx`

Purpose:

- Provide stable top-level product menu groups.

Candidate groups:

- File
- Import
- View
- Schedule
- Diagnostics
- AI Review
- Settings

Must not:

- execute scheduling logic directly
- introduce unavailable commands as active actions

### 7.4 `CommandToolbar.tsx`

Purpose:

- Surface primary user actions.

Candidate commands:

- Import XER
- Import MSP
- Preview
- Load to Workspace
- Validate
- Export
- Timescale selector
- Show/hide diagnostics

Command rules:

- Disabled state must be explicit when command is unavailable.
- Commands must dispatch through approved app/Worker pathways.
- Toolbar must not perform authoritative mutations directly.

### 7.5 `ProjectStatusStrip.tsx`

Purpose:

- Summarise current file/project/import/schedule status.

Candidate fields:

- file name
- source type
- activity count
- warning count
- calendar summary
- active view state

Must display Worker/import-derived data only.

### 7.6 `WorkspaceLayout.tsx`

Purpose:

- Own workspace zone arrangement.
- Compose left table area, right Gantt area, optional inspector, and bottom drawer.
- Coordinate visual layout only.

Must not:

- calculate schedule data
- transform imported schedule semantics
- own authoritative task hierarchy

### 7.7 `WorkspaceSplitter.tsx`

Purpose:

- Provide resizable visual split between table and Gantt zones.
- Own split-size UI state only.

Allowed state:

- panel widths
- collapsed/expanded visual state

Forbidden state:

- schedule data
- task dates
- dependency outcomes

### 7.8 `ScheduleWorkspace.tsx`

Purpose:

- Compose existing TaskTable and Gantt surfaces into the loaded schedule workspace.
- Pass through existing props from current app state.
- Avoid altering table/Gantt internals in R3.

Must not:

- refactor TaskTable internals
- refactor Gantt internals
- fix Gantt bar rendering as part of R3 unless separately approved
- change schedule semantics

### 7.9 `EmptyWorkspace.tsx`

Purpose:

- Display no-programme-loaded state.
- Provide clear import call-to-action surfaces.

Allowed behaviour:

- trigger existing import command pathways
- show non-authoritative UI guidance

### 7.10 `ProgrammePreviewPanel.tsx`

Purpose:

- Display imported programme summary before loading to workspace.

Candidate content:

- project name
- file name
- source type
- activity count
- WBS count
- relationship count
- calendars summary
- warnings/errors count
- Load to Workspace command

Must not:

- become authoritative schedule state
- mutate schedule data directly

### 7.11 `InspectorPanel.tsx`

Purpose:

- Provide right-side placeholder surface for future activity details, dependencies, resources, constraints, calendars, risks/notes.

R3 should only create shell/placeholder architecture if included.

Detailed inspector features belong to later milestones.

### 7.12 `BottomDiagnosticsDrawer.tsx`

Purpose:

- Provide organised bottom drawer shell for diagnostics/logs/histogram/health/unsupported features/AI notes.

R3 should only create structural placeholder if included.

Detailed diagnostics UX belongs to later milestones.

## 8. Existing Components to Reuse

R3 should reuse existing components where possible, especially:

- existing top bar / toolbar components from prior shell chrome work
- existing TaskTable component
- existing Gantt/timescale components
- existing Worker connection and state flow
- existing UI store patterns, if already present and UI-only

R3 should not rewrite mature or sensitive surfaces unless the R3 issue explicitly approves it.

## 9. Components Not to Touch Until Later Milestones

The following should remain out of R3 unless separately approved:

| Area | Future milestone | Reason |
|---|---|---|
| XER/MSP import internals | R4 | Import UX requires its own workflow acceptance |
| TaskTable professional WBS redesign | R5 | High visual and interaction complexity |
| Gantt bar/timescale visual redesign | R6 | Gantt rendering requires focused visual QA |
| Dependency rendering | R6 or later | Risk of visual/schedule coupling |
| Worker scheduling logic | Not part of UI redesign | Worker remains authority |
| Protocol contracts | Separate milestone only | Cross-package impact |
| Rust/WASM engine | Separate milestone only | Deterministic engine boundary |
| Persistence/UAT/production | Separate approval only | Release/authority risk |
| AI003 | Separate approval only | Explicitly blocked |

## 10. View-State Ownership Model

### React-local view state

R3 may own:

- active shell tab
- active menu group
- selected display mode
- drawer open/closed
- inspector open/closed
- panel split sizes
- timescale profile selection, if already UI-only
- empty/preview/loaded visual routing, where derived from Worker/import state

### Worker-derived state

R3 must treat the following as Worker/import-derived:

- imported programme availability
- loaded programme state
- project name
- file/source metadata
- activity count
- WBS count
- relationship count
- calendars summary
- warnings/errors
- schedule task data
- schedule dates
- float values
- criticality
- diagnostics

### Forbidden React-owned authority

R3 must not introduce React ownership of:

- task canonical data
- schedule calculation result
- dependency resolution
- calendar resolution
- start/finish calculation
- float calculation
- critical path/near-critical calculation
- import acceptance authority
- persistence authority
- gate/tolerance decisions

## 11. Worker Command-Dispatch Boundaries

The app shell may expose commands, but execution must use existing approved pathways.

Candidate command categories:

| Command | R3 status |
|---|---|
| Import XER | Surface existing command only / no UX internals |
| Import MSP | Surface existing command only / no UX internals |
| Preview programme | Shell routing only if existing state exists |
| Load to Workspace | Dispatch only, no direct mutation |
| Validate | Dispatch only, if existing command exists |
| Export | Placeholder or disabled if not implemented |
| Toggle diagnostics | UI-only |
| Toggle inspector | UI-only |
| Change timescale profile | UI-only, if current model supports it |

R3 must not invent new Worker protocol messages unless separately approved.

## 12. Import / Status Strip Architecture

The status strip should be a display surface only.

It may show:

- file name
- source type: XER/MSP/manual/sample
- import state
- loaded state
- activity count
- warning/error count
- calendar summary

It must not:

- parse files
- validate imports directly
- decide import authority
- mutate schedule state

## 13. Workspace Split Layout Architecture

The workspace should support three high-level display states:

| State | Description |
|---|---|
| Empty | No programme loaded; import actions visible |
| Preview | Imported programme available for inspection |
| Loaded | WBS/activity table and Gantt workspace visible |

Routing between these states should be derived from existing Worker/import state where available.

R3 should avoid introducing new authoritative state machines unless separately approved.

## 14. Table / Gantt Shell Integration Boundaries

R3 may:

- place existing TaskTable in the left workspace region
- place existing Gantt/timescale surface in the right workspace region
- improve container layout around them
- preserve existing scroll/sync behaviours where already implemented

R3 must not:

- rewrite TaskTable internals
- rewrite Gantt internals
- alter task data shape
- alter schedule calculations
- alter dependency calculations
- add React-side date/float calculations

If visible bars are still missing, R3 should document the issue and leave it for R6 unless separately approved.

## 15. Inspector and Diagnostics Drawer Architecture

R3 may introduce placeholders or shell containers for:

- inspector panel
- diagnostics drawer
- logs tab
- histogram tab
- health checks tab
- AI notes tab

Detailed implementation should remain later-scope unless existing data surfaces can be safely reused without source-of-truth changes.

AI notes must remain advisory/read-only.

AI003 remains blocked.

## 16. R3 Allowed Files — Proposed

A future R3 implementation issue may allow a limited set such as:

```text
apps/web/src/App.tsx
apps/web/src/index.css
apps/web/src/ui/shell/**
apps/web/src/ui/workspace/**
apps/web/src/ui/panels/**
apps/web/src/ui/state/**
docs/milestones/W5B-UI.R3-core-app-shell-implementation.md
```

This list is not approved by R2 itself. It must be confirmed in the future R3 issue.

## 17. R3 Forbidden Files — Proposed

A future R3 implementation should forbid changes to:

```text
packages/worker/**
packages/protocol/**
packages/**/src/**/*.rs
crates/**
apps/web/src/components/TaskTable.tsx
apps/web/src/components/gantt/**
apps/web/src/components/data/**
apps/web/src/**/*.test.ts
apps/web/src/**/*.test.tsx
package.json
pnpm-lock.yaml
.github/**
```

Exceptions must be explicitly justified and separately approved.

If R3 needs TaskTable or Gantt internal changes, R3 should stop and produce an evidence note instead of proceeding.

## 18. R3 Stop Conditions

Future R3 implementation must stop if:

- shell work requires TaskTable internals
- shell work requires Gantt internals
- shell work requires Worker changes
- shell work requires protocol changes
- shell work requires Rust/WASM changes
- shell work requires scheduling logic
- shell work requires gate/tolerance/authority changes
- shell work requires persistence/UAT/production changes
- shell work requires AI003 enablement
- imported programme state is unclear and would require inventing React authority
- existing app wiring is too entangled for safe shell-only extraction
- visual shell cannot be improved without changing schedule data flow

## 19. R3 Validation Commands — Proposed

Future R3 should run and report:

```bash
git status --short
git diff --stat
git diff --name-only
pnpm -C apps/web exec vitest run
```

If feasible:

```bash
pnpm -C apps/web exec tsc -b
```

If typecheck or tests fail due to pre-existing unrelated issues, the evidence document must identify them clearly.

## 20. R3 Evidence Requirements — Proposed

Future R3 PR should include an evidence document:

```text
docs/milestones/W5B-UI.R3-core-app-shell-implementation.md
```

Required sections:

1. Executive Summary
2. Scope Confirmation
3. Files Changed
4. Files Explicitly Not Changed
5. Component Boundaries Implemented
6. Worker/Authority Preservation
7. UI State Ownership
8. Validation Commands and Results
9. Localhost Visual Confirmation Notes
10. Stop Conditions Encountered / Not Encountered
11. Safety Confirmation
12. Recommended Next Milestone

## 21. R2 Acceptance Criteria

R2 is acceptable when:

- This architecture plan exists in `docs/ui/`.
- It defines app shell component boundaries.
- It defines future file/folder structure options.
- It defines view-state ownership.
- It defines Worker command-dispatch boundaries.
- It defines table/Gantt integration boundaries.
- It defines inspector/drawer boundaries.
- It defines R3 allowed and forbidden areas.
- It defines R3 stop conditions.
- It defines R3 validation and evidence requirements.
- It remains documentation-only.
- Gemini dry-run review has been completed.
- ChatGPT review has been recorded.
- Human approval has been recorded.

## 22. R2 Safety Confirmation

- Documentation-only: yes.
- Source-code changes: no.
- React component changes: no.
- Worker changes: no.
- Protocol changes: no.
- Rust/WASM changes: no.
- Scheduling logic changes: no.
- Gate/tolerance/authority changes: no.
- Persistence/UAT/production changes: no.
- AI003 changes: no.
- Copilot implementation: no.

## 23. Follow-On Milestones

After R2, the proposed track remains:

1. W5B-UI.R3 — Core app shell implementation.
2. W5B-UI.R4 — XER/MSP import workflow UX.
3. W5B-UI.R5 — TaskTable/WBS professional view.
4. W5B-UI.R6 — Gantt/timescale visual layer.

R3 requires a separate issue, Gemini dry-run review if implementation-sensitive, ChatGPT review, and human approval before Copilot assignment.
