# W5B-UI.R5B — WBS Banding / Visual Grouping

## 1. Executive Summary

R5B implements a narrow UI-only refinement to TaskTable. It adds depth-based WBS
banding colours to summary rows so that large imported programmes are easier to
scan and review. The change builds on the R5A baseline (hierarchy indentation,
parent-before-child display ordering, summary/activity row distinction).

---

## 2. Parent Register Reference

Parent control source:

- #47 — UI Recovery Register / master control source

R5 parent issue:

- #48 — [UI] W5B-UI.R5 — TaskTable / WBS Professional View

R5A predecessor:

- #50 — R5A implementation PR: TaskTable WBS hierarchy styling

---

## 3. R5B Scope Confirmation

R5B scope implemented:

- Added `WBS_BAND_COLORS` constant: four depth-indexed background colours for WBS
  summary rows (depth 0 = strongest tint, depth 3+ = subtlest tint).
- Added `WBS_MARKER_COLORS` constant: four depth-indexed colours for the left
  vertical marker bar displayed on every summary row.
- Added `getWbsBandColor(depth)` exported helper: pure display projection,
  returns the appropriate band background for the given `task.depth` with a safe
  fallback for missing or invalid values.
- Added `getWbsMarkerColor(depth)` exported helper: pure display projection,
  returns the appropriate marker colour for the given `task.depth` with a safe
  fallback.
- Applied depth-based background in TaskTable row rendering: summary `rowBg` now
  calls `getWbsBandColor(task.depth)` instead of a flat `#eef4fb`.
- Applied depth-based left marker in TaskTable row rendering: the summary marker
  `<span>` now receives `getWbsMarkerColor(task.depth)` as its background.
- Added R5B test suite in `TaskTable.test.ts` covering all four depth levels,
  clamping behaviour, and invalid/missing depth fallbacks.

Out of scope and not implemented:

- No Worker changes.
- No protocol changes.
- No Rust/WASM/kernel changes.
- No parser/import changes.
- No persistence/gate/AI003/production changes.
- No scheduling logic in React.
- No WBS rollup calculations in React.
- No Gantt redesign, timescale redesign, or virtualization rewrite.
- No activity-column overhaul (R5C scope).
- No changes to `getVisibleTasks.ts` (logic unchanged from R5A).

---

## 4. Architecture Guardrails Met

- React remains display + command dispatch only.
- Worker remains source of truth.
- No schedule data calculated in React.
- Banding is driven exclusively by the existing `task.depth` field supplied by
  the Worker.
- Safe fallback applies when `task.depth` is undefined, null, NaN, or negative.
- No hardcoded assumptions tied to a specific XER file.

---

## 5. Files Changed

```
apps/web/src/components/TaskTable.tsx         — new helpers + applied in rendering
apps/web/src/components/TaskTable.test.ts     — R5B test suite added
docs/milestones/W5B-UI.R5B-wbs-banding-visual-grouping.md  — this document
```

Files not changed (as intended):

```
apps/web/src/utils/getVisibleTasks.ts         — no change needed
apps/web/src/utils/getVisibleTasks.test.ts    — no change needed
packages/worker/**                            — forbidden
packages/protocol/**                          — forbidden
```

---

## 6. Visual Behaviour

### WBS Banding Palette

| Depth | Band colour (row bg) | Marker colour | Typical row type       |
|-------|----------------------|---------------|------------------------|
| 0     | `#eef4fb` (blue)     | `#2471a3`     | Project / root WBS     |
| 1     | `#edf7f1` (green)    | `#1e8449`     | First-level WBS        |
| 2     | `#fdf2e9` (amber)    | `#ca6f1e`     | Second-level WBS       |
| 3+    | `#f5eef8` (plum)     | `#7d3c98`     | Deeper WBS / fallback  |

Activity rows remain white (`#ffffff`) or critical-red (`#ffebee`) as before.
Selected rows remain `#bbdefb` regardless of depth.

### Stacked Depth-Indicator Bars

WBS summary rows show **stacked left-side bars** (P6-style), one bar per ancestor
WBS level from 0 up to the current depth. Each bar is 4 px wide, 18 px tall, with
a 2 px gap between bars and a 6 px right margin before the toggle + name content.

- Depth-0 WBS: 1 bar (steel blue)
- Depth-1 WBS: 2 bars (steel blue + forest green)
- Depth-2 WBS: 3 bars (steel blue + forest green + burnt amber)
- Depth-3 WBS: 4 bars (steel blue + forest green + burnt amber + plum)

The accumulating bars create an immediate visual "ladder" that communicates
nesting depth at a glance, making large imported schedules easier to scan.

---

## 7. Validation

### Automated

```bash
pnpm -C apps/web exec vitest run
pnpm -C apps/web exec tsc -b
```

- Vitest: all tests pass including new R5B suite.
- `tsc -b`: pre-existing unused-local errors in `HistogramPane.tsx` and
  `TaskDetailsPanel.test.ts` remain (unrelated to R5B). No new type errors
  introduced.

### Manual Localhost Checklist

1. Import XER.
2. Load to Workspace.
3. Confirm IMPORT_SCHEDULE ack.
4. Confirm Worker success path.
5. Confirm TaskTable rows render.
6. Confirm root-level WBS rows show darkest blue band.
7. Confirm nested WBS rows show progressively lighter blue band.
8. Confirm left marker bar deepens/lightens with WBS depth.
9. Confirm activity rows remain white/critical-red.
10. Confirm collapse / expand behaviour is unchanged.
11. Confirm Gantt still renders.
12. Confirm no `undefined`, `NaN`, or raw object values visible.
13. Confirm 3 000+ row schedule remains usable (no performance regression).

---

## 8. Risks

- None identified beyond cosmetic preference. All changes are pure CSS colour
  selection driven by an existing numeric field.
- No API surface is widened; helpers are pure functions with no side effects.
- Fallback path returns a safe colour for any malformed depth value.

---

## 9. Approval Gates

- [x] R5A completed via PR #50.
- [x] Gemini dry-run review completed.
- [x] ChatGPT refinement completed.
- [x] Human implementation approval recorded (issue #51 comments).
- [x] R5B implementation PR created.
- [ ] ChatGPT PR review.
- [ ] Human localhost visual QA.
- [ ] Merge decision.
