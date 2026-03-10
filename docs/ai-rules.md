# Planning OS Development Rules

## Current Milestone Rule
We are currently implementing Graph Foundation with full-state sync.
Do NOT implement delta sync, reducer patch merging, database, Rust, WASM, Gantt, or cloud features in this milestone.

## Core Architecture
1. React UI is a dumb renderer.
2. Web Worker owns client-side application state.
3. UI communicates with Worker only through typed message protocol.
4. Rust kernel performs scheduling calculations, not the React UI.
5. Avoid unnecessary JSON serialization across thread boundaries.
6. Prefer structured clone-safe objects for Worker messages.
7. Prefer pure functions where practical.
8. Worker contains business logic; UI contains presentation logic only.
9. Keep UI components lightweight and focused.
10. Add or update tests whenever protocol types or Worker message contracts change.

## Scope Control
11. Build only the current slice; do not add future features early.
12. For Week 1, do not add backend, database, Rust, Gantt, auth, cloud sync, or complex UI.
13. Week 1 success criteria:
   - User can type a task name
   - Click add
   - Worker stores task
   - UI renders returned tasks
   - Regression test passes

## Code Quality
14. Keep files under 200 lines when practical; split by responsibility, not arbitrarily.
15. Prefer explicit types over `any`.
16. Keep protocol types centralized in `packages/protocol`.
17. Do not move state ownership from Worker back into React.
18. Do not stringify task collections or diffs unless explicitly required by a measured constraint.

## AI Assistant Rules
19. When generating code, preserve the UI ↔ Worker boundary.
20. Do not introduce hidden architectural shortcuts for convenience.
21. If a change weakens performance or architecture, reject it and propose a compliant alternative.