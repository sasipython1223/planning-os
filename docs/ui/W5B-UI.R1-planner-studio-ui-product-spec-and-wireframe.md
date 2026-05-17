# W5B-UI.R1 — Planner-Studio UI Product Specification & Wireframe

## 1. Purpose

This milestone defines the target professional UI for Planner-Studio / Planning OS before any further implementation work.

W5B-UI.R1 is a documentation/specification milestone only. It establishes the product, workflow, layout, visual, and architecture boundaries for the deliberate UI redesign track.

The purpose is to move away from risky WIP UI recovery and toward a controlled product-led redesign.

## 2. Background and Recovery Decision

Previous UI recovery work attempted to bring the richer WIP UI from:

```text
backup/wip-before-ai-workflow-2026-05-13
```

onto latest:

```text
main
```

The recovery audit found large divergence in `apps/web/src`, including major risk zones around:

- `apps/web/src/App.tsx`
- `apps/web/src/components/TaskTable.tsx`
- `apps/web/src/ui/store/uiStore.ts`
- `apps/web/src/components/gantt/*`

The accepted decision is:

- Use `main` as the technical baseline.
- Use WIP only as a visual reference / idea bank.
- Do not restore WIP directly.
- Do not continue blind WIP recovery slices.
- Define the target UI first, then implement through later narrow milestones.

Relevant evidence:

- PR #26 — Phase 1 recovery audit completed.
- PR #28 — limited TopBar / Toolbar shell chrome restore merged.
- PR #30 — App shell composition recovery rejected by human visual QA and closed unmerged.
- PR #32 — Visual/Product Parity Gap Audit docs-only merged.
- Issue #25 — closed as superseded.
- Issue #29 — closed as superseded.
- PR #24 — accidental server restart PR closed unmerged.

## 3. Product Principles

Planner-Studio should feel like a professional planning and scheduling product rather than a prototype dashboard.

The target direction is:

- Professional scheduling discipline comparable to Primavera P6.
- Readable planning workflow comparable to MS Project.
- Modern, approachable workspace patterns comparable to Smartsheet / modern SaaS.
- Planner-Studio-specific diagnostics and AI advisory surfaces.
- Clear separation between import, preview, workspace, diagnostics, and advisory review.

The UI should prioritise:

1. Clear import entry points.
2. Confidence before loading imported data.
3. Professional WBS/activity hierarchy.
4. Visible and trustworthy Gantt output.
5. Clear diagnostics without overwhelming the main workspace.
6. Explicit source-of-truth boundaries.

## 4. Architecture Boundaries

The UI redesign must preserve the core architecture:

- React UI is display + command dispatch only.
- Web Worker is the authoritative scheduling state/orchestration layer.
- Translator / adapter layer handles schedule data conversion.
- Rust/WASM CPM engine performs deterministic scheduling calculations.
- React must not contain scheduling logic.
- Worker remains source of truth.
- AI features are advisory/read-only unless explicitly approved.
- AI003 remains blocked.
- No gate/tolerance/authority/persistence/UAT/production changes are included in this milestone.

React may own view-only UI state such as:

- selected row IDs
- expanded/collapsed panels
- visible columns
- active tab
- drawer open/closed state
- zoom/timescale profile
- split panel dimensions
- local sort/filter display preferences where they do not mutate the authoritative schedule

React must not own or calculate:

- CPM logic
- dependency resolution
- float calculation
- start/finish calculation
- calendar calculation
- import authority
- persistence authority
- gate/tolerance decisions
- schedule mutation rules

## 5. Target User Workflow

The redesigned workflow should support the following primary path:

1. User opens Planner-Studio.
2. User sees clear import options for XER and MSP.
3. User imports a programme file.
4. UI shows import progress, validation state, warnings, and file metadata.
5. User previews the imported programme before loading it into the workspace.
6. User loads the programme into the scheduling workspace.
7. Workspace displays WBS/activity table and Gantt chart in a professional split view.
8. User inspects activities, dependencies, resources, diagnostics, logs, and histogram.
9. UI dispatches commands to the Worker for authoritative state transitions.
10. Worker remains source of truth for schedule data and orchestration state.

## 6. Primary App Shell Wireframe

Baseline target shell:

```text
+--------------------------------------------------------------------------------+
| Planner-Studio / Planning OS                    Project: [Name]  Status: [OK]  |
+--------------------------------------------------------------------------------+
| File | Import | View | Schedule | Diagnostics | AI Review | Settings            |
+--------------------------------------------------------------------------------+
| [Import XER] [Import MSP] [Preview] [Load to Workspace] [Validate] [Export]     |
+--------------------------------------------------------------------------------+
| Import / Project Status Strip                                                   |
| File: sample.xer | Activities: 3,421 | Warnings: 12 | Calendar: Project Default |
+-------------------------------+------------------------------------------------+
| WBS / Activity Table          | Gantt / Timescale                              |
|-------------------------------|------------------------------------------------|
| WBS bands                     | Year / Quarter / Month                         |
| Activity ID                   | Gridlines                                      |
| Activity Name                 | Summary bars                                   |
| Start / Finish                | Activity bars                                  |
| Duration / TF / FF            | Milestones                                     |
| Predecessors / Successors     | Dependency links                               |
| Critical / Near Critical      | Baseline / Actual / Forecast views             |
+-------------------------------+------------------------------------------------+
| Optional Inspector Panel: Activity Details / Dependencies / Resources / Risks   |
+--------------------------------------------------------------------------------+
| Bottom Drawer: Import Diagnostics | Logs | Histogram | Health Checks | AI Notes |
+--------------------------------------------------------------------------------+
```

Target shell zones:

| Zone | Purpose | Authority |
|---|---|---|
| Top application bar | Product identity, project identity, status | UI display only |
| Menu/toolbar | User commands and view controls | Dispatch only |
| Import/status strip | Current import and schedule status | Worker-derived state |
| WBS/activity table | Hierarchical schedule table | Worker-derived data, UI view state |
| Gantt/timescale | Visual schedule projection | Worker-derived dates, UI geometry |
| Inspector panel | Details, dependencies, resources | Worker-derived details, command dispatch |
| Bottom drawer | Diagnostics/logs/histogram/AI notes | Worker/diagnostic/advisory output |

## 7. Import Workflow

Import must be visibly important and easy to understand.

### Import states

| State | UI expectation |
|---|---|
| Empty state | Prominent Import XER / Import MSP entry points |
| File selected | File name, type, size, and pending validation shown |
| Importing | Progress / busy state shown; destructive commands disabled |
| Import succeeded | Summary shown: activities, WBS count, calendars, warnings |
| Import succeeded with warnings | Warning count and preview action shown |
| Import failed | Clear error message, log link, retry option |
| Preview ready | User can inspect programme before loading |
| Loaded | Workspace becomes primary view |

### Import UX requirements

- XER and MSP entry points must be clearly visible.
- Imported file status must be visible before workspace load.
- Warnings must be discoverable without blocking all use unless critical.
- Preview must make it clear that data is not yet fully loaded into workspace authority.
- Load action must dispatch to the Worker, not mutate React schedule state directly.

## 8. Programme Preview State

The preview state bridges import and full workspace.

It should show:

- project name / file name
- import source type: XER or MSP
- activity count
- WBS count
- relationship count
- calendar summary
- unsupported feature count
- warnings/errors
- sample WBS tree preview
- sample activity rows
- action: Load to Workspace

Preview is not the authoritative working schedule. It is an inspection state driven by parsed/imported data and Worker-approved transitions.

## 9. Main Workspace State

The main workspace is the professional planning area.

It should include:

- left WBS/activity table
- right Gantt/timescale chart
- optional right inspector panel
- bottom diagnostics drawer
- status strip showing current programme state

The workspace must support visual inspection first. Editing and mutation controls must be introduced only where command dispatch and Worker ownership are explicit.

## 10. TaskTable / WBS View

The TaskTable should look and behave like a professional scheduling table.

Target expectations:

- WBS summary rows are visually distinct.
- Activity rows remain neutral and readable.
- WBS banding is clear and continuous.
- Activity ID is visible and not polluted by WBS indentation.
- WBS tree hierarchy is readable.
- Expand/collapse controls are predictable.
- Critical and near-critical activities are visually identifiable.
- Float/date columns are clear.
- Predecessor/successor columns are readable.
- Summary rows should not look like normal activity rows.

Suggested key columns:

- WBS / tree indicator
- Activity ID
- Activity Name
- Start
- Finish
- Duration
- Total Float
- Free Float
- Predecessors
- Successors
- Calendar
- Critical / Near Critical indicator

React must not calculate schedule values for this table. Dates, float, criticality, and dependency effects must come from Worker/engine-derived state.

## 11. Gantt / Timescale View

The Gantt view must clearly show schedule bars after a programme is loaded.

Target expectations:

- Activity bars visible and aligned with table rows.
- Summary bars visible and distinct from activity bars.
- Milestones visible with separate milestone styling.
- Critical and near-critical bars distinguishable.
- Timescale profile is easy to switch.
- Gridlines align with date ticks.
- Dependency links are available but visually secondary.
- Horizontal scroll sync works with the timescale.
- Vertical alignment works with the TaskTable.

Supported timescale profiles should include:

- Year / Month
- Year / Quarter
- Quarter / Month
- Month Only
- Week / Day

Gantt geometry may be UI projection, but scheduling dates and dependency outcomes must come from Worker-authoritative state.

## 12. Right Inspector Panels

The right inspector should be optional and context-sensitive.

Candidate tabs:

- Activity Details
- Dependencies
- Resources
- Constraints
- Calendars
- Risks / Notes

Inspector rules:

- Selection may be local UI state.
- Displayed data should be Worker-derived.
- Mutations, if later allowed, must dispatch commands.
- No direct React schedule mutation.

## 13. Bottom Diagnostics Drawer

The bottom drawer should organise technical and diagnostic information without overwhelming the planning workspace.

Candidate tabs:

- Import Diagnostics
- Logs
- Histogram
- Schedule Health
- Unsupported Features
- AI Notes

Rules:

- Diagnostics should be visible and accessible.
- Diagnostics should not dominate the default workspace.
- AI notes are advisory only.
- AI003 remains blocked unless separately approved.

## 14. Visual Style Direction

The product should look professional, dense enough for scheduling work, but not visually chaotic.

Target style:

- restrained professional colour palette
- strong WBS hierarchy treatment
- clean table borders and row rhythm
- clear status badges
- compact toolbar controls
- readable font sizing
- high information density where appropriate
- visual separation between command zones, workspace, and diagnostics

WBS visual language:

- summary rows should have horizontal emphasis
- WBS levels may use coloured left bands
- activity rows should remain mostly neutral
- branch ownership should be understandable at a glance

Gantt visual language:

- bars must be visible and not washed out
- critical path should be identifiable but not overpowering
- dependency links should not dominate bars
- gridlines should support reading, not create clutter

## 15. State Ownership Rules

### Worker-owned authoritative state

- imported programme state
- loaded schedule state
- task/activity data
- WBS hierarchy
- dependencies
- calendars
- calculated dates
- float values
- criticality
- diagnostics produced by scheduling/import processes

### React-owned view state

- selected rows
- active panel/tab
- visible columns
- drawer open/closed
- split sizes
- zoom level
- timescale profile
- local UI filters where non-authoritative
- hover/focus state

### Command-dispatch-only interactions

The UI may expose buttons or controls for commands, but these must dispatch through the approved Worker pathway.

Examples:

- load imported programme
- validate schedule
- request schedule calculation
- request diagnostics
- select activity for details
- request dependency inspection

React must not directly perform the authoritative result of these commands.

## 16. Explicit Non-Goals

W5B-UI.R1 does not include:

- code implementation
- Copilot implementation
- component refactoring
- App shell code changes
- TaskTable code changes
- Gantt code changes
- Worker changes
- protocol changes
- Rust/WASM changes
- CPM engine changes
- scheduling calculation changes
- authority/gate/tolerance changes
- persistence changes
- UAT or production enablement
- AI003 enablement
- direct WIP code restoration

## 17. Acceptance Criteria

R1 is acceptable when:

- This product specification exists in `docs/ui/`.
- It defines the target user workflow from import to workspace inspection.
- It includes a clear primary app shell wireframe.
- It defines import, preview, workspace, table, Gantt, panel, and diagnostics expectations.
- It explicitly defines state ownership rules.
- It clearly forbids React scheduling authority.
- It confirms Worker remains source of truth.
- It confirms R1 is documentation-only.
- It includes a follow-on milestone sequence.
- Gemini dry-run review has been completed and reviewed.
- Human approval is recorded before implementation-sensitive work.

## 18. Follow-on Milestones

Recommended redesign track:

1. W5B-UI.R1 — Product UI specification and wireframe.
2. W5B-UI.R2 — App shell architecture plan.
3. W5B-UI.R3 — Core app shell implementation.
4. W5B-UI.R4 — XER/MSP import workflow UX.
5. W5B-UI.R5 — TaskTable/WBS professional view.
6. W5B-UI.R6 — Gantt/timescale visual layer.

R2 should translate this product specification into a file-scoped app shell architecture plan.

R3 and later may introduce implementation, but only after separate approval and with narrow Copilot instructions including:

- allowed files
- forbidden files
- stop conditions
- validation commands
- evidence document requirements

## 19. R1 Safety Confirmation

- Documentation-only: yes.
- Code changes: no.
- Worker changes: no.
- Protocol changes: no.
- Rust/WASM changes: no.
- Scheduling logic changes: no.
- Gate/tolerance/authority changes: no.
- Persistence/UAT/production changes: no.
- AI003 changes: no.
- Copilot implementation: no.
