# W5B-UI.R5B — WBS Banding / Visual Grouping

## 1. Executive Summary

R5B implements a narrow UI-only refinement to TaskTable. It adds depth-based WBS
banding to the task/name column so that large imported programmes are easier to
scan and review. The change builds on the R5A baseline (hierarchy indentation,
parent-before-child display ordering, summary/activity row distinction).

The final model extends the R5A inline-marker approach with depth-indexed
multi-hue coloring (no absolute-positioned overlays, no parallel barcode stripes):

- An inline 4 px coloured pill (the WBS ownership marker) appears on WBS summary
  rows inside the content flow, before the task name — text is never obscured.
- Marker colour changes by depth (steel blue → forest green → burnt amber → plum)
  so each WBS nesting level has a visually distinct hue.
- Row background tint is depth-indexed — summary rows and their activity descendants
  share the same hue zone, so all rows within a WBS branch feel inside one container.
- Activity rows inherit `getWbsBandColor(depth - 1)` as their row background,
  connecting them visually to their owning WBS summary.

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

- Added `WBS_BAND_COLORS` constant: four depth-indexed background tints for WBS
  rows, one per WBS nesting level (distinct hues: blue, green, amber, plum).
- Added `WBS_MARKER_COLORS` constant: four depth-indexed solid hues for the left
  accent strip (steel blue, forest green, burnt amber, plum).
- Added `WBS_LEFT_BAND_WIDTH = 6` constant: width in px of the single left accent
  strip. Sits inside cell's 8 px left padding; never overlays text.
- Added `getWbsBandColor(depth)` exported helper: returns band background tint.
- Added `getWbsMarkerColor(depth)` exported helper: returns marker colour.
- Added `getWbsDepthMarkerColors(depth)` exported helper: returns colour array
  for levels 0..depth.
- Added `getWbsAncestorBandColors(depth, isSummary)` exported helper: full
  ancestry colour array — still exported and tested for completeness.
- Added `getWbsActiveBandColor(depth, isSummary)` exported helper: returns the
  **single** active WBS ownership colour (or null for top-level activities). This
  drives the strip render — one element per row, no barcode.
- Applied single left accent strip in TaskTable row rendering:
  - The task/name `<td>` is `position: relative`.
  - `getWbsActiveBandColor` is called for every row.
  - One `position: absolute, left: 0, width: 6px, top: 0, bottom: 0` strip per row.
  - Summary rows: opacity 0.85. Activity rows: opacity 0.55.
  - Strip sits inside the cell's 8 px left padding — text is never overlaid.
- Activity row background: `getWbsBandColor(depth - 1)` — same zone tint as the
  owning WBS summary, providing visual containment without overlaying text.
- Added R5B test suites covering all depth levels, clamping, and invalid/null/NaN
  fallbacks for all exported helpers including `getWbsActiveBandColor`.

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

### Single Left Accent Strip + Row Tint

Every row with a WBS parent renders a single 6 px coloured strip at the left
edge of the task/name cell. The strip and row tint share the same depth-indexed
hue — a row visually belongs to the WBS zone of that colour.

**Per-row visual** (strip at left edge, tint fills row background):

| Row | Strip colour | Row tint | Opacity |
|-----|-------------|----------|---------|
| Phase 1 (WBS depth 0) | Steel blue | Faint blue | 0.85 / full |
| Activity under Phase 1 (depth 1) | Steel blue | Faint blue | 0.55 |
| Milestones (WBS depth 1) | Forest green | Faint green | 0.85 / full |
| Activity under Milestones (depth 2) | Forest green | Faint green | 0.55 |
| Offsite Utility (WBS depth 2) | Burnt amber | Faint amber | 0.85 / full |
| Activity under Offsite Utility (depth 3) | Burnt amber | Faint amber | 0.55 |
| Top-level activity (depth 0) | (none) | White | — |

**Effect**: rows inside the same WBS container share the same colour zone.
Parent summaries open a colour region; child activities feel inside that region.
No barcode parallel stripes; one clear ownership signal per row.

---

## 7. Validation

### Automated

```bash
apps/web/node_modules/.bin/vitest run
```

- Vitest: **115 tests pass** across 9 files (29 in TaskTable.test.ts).
- `tsc -b`: pre-existing unused-local errors in `HistogramPane.tsx` and
  `TaskDetailsPanel.test.ts` remain (unrelated to R5B). No new type errors
  introduced.

### Manual Localhost Checklist

1. Import XER.
2. Load to Workspace.
3. Confirm IMPORT_SCHEDULE ack.
4. Confirm TaskTable rows render.
5. Confirm each WBS summary row shows a coloured left accent strip.
6. Confirm all rows under a WBS summary share the same strip colour and tint.
7. Confirm activity rows show a muted version of the parent WBS colour.
8. Confirm task-name text has strong, readable contrast (no faded text).
9. Confirm only ONE coloured strip per row (no barcode parallel stripes).
10. Confirm nested WBS levels use distinct hues (blue / green / amber / plum).
11. Confirm collapse / expand behaviour is unchanged.
12. Confirm Gantt still renders.
13. Confirm no `undefined`, `NaN`, or raw object values visible.
14. Confirm 3 000+ row schedule remains usable (no performance regression).

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
- [x] Multiple ChatGPT PR reviews completed.
- [ ] Human localhost visual QA (simplified single-strip model).
- [ ] Merge decision.

