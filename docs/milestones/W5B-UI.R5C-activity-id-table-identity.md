# W5B-UI.R5C — Activity ID / Activity Name Table Identity

Refs #57

## Scope Implemented (R5C.1)

- Added XER `task_code` capture in parser TASK field mapping.
- Exposed Activity ID as a **display-only** task field (`Task.activityId`).
- Preserved canonical scheduling identity (`Task.id`) with no replacement.
- Added dedicated **Activity ID** column in `TaskTable`.
- Kept **Activity Name** as a separate visible column.
- Rendered `—` for WBS/summary rows and missing Activity IDs.

## Guardrails Confirmed

- No scheduling logic change.
- No Gantt/timescale/virtualization redesign.
- No WASM/kernel changes.
- No persistence or gate behavior changes.
