# W5B-UI.R5B — WBS Banding / Visual Grouping

## 1. Executive Summary

R5B implements a narrow UI-only refinement to TaskTable. It adds depth-based WBS
banding to the task/name column so that large imported programmes are easier to
scan and review. The change builds on the R5A baseline (hierarchy indentation,
parent-before-child display ordering, summary/activity row distinction).

The final model uses a **single left accent strip** per row (no full-cell overlays,
no parallel barcode stripes) combined with a faint row background tint:

- The accent strip (6 px wide) sits inside the cell's existing 8 px left padding,
  so it never overlays task-name text — full text contrast is preserved.
- Strip colour = the active WBS ownership level's marker colour.
- Row background tint = the same WBS level's faint hue — provides zone context.
- Activity rows inherit the parent WBS tint and parent strip colour at 55% opacity,
  so they visually sit inside the WBS container.

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

- Added `WBS_BAND_COLORS` constant: four depth-indexed background tints for WBS
  summary rows, one per WBS nesting level (distinct hues: blue, green, amber, plum).
- Added `WBS_MARKER_COLORS` constant: four depth-indexed solid hues for the left
  vertical band (steel blue, forest green, burnt amber, plum).
- Added `getWbsBandColor(depth)` exported helper: returns the appropriate band
  background for the given `task.depth` with a safe fallback.
- Added `getWbsMarkerColor(depth)` exported helper: returns the appropriate marker
  colour for the given `task.depth` with a safe fallback.
- Added `getWbsDepthMarkerColors(depth)` exported helper: returns an array of
  colours for levels 0..depth — building block for band arrays.
- Added `getWbsAncestorBandColors(depth, isSummary)` exported helper: returns the
  WBS band colour array for a row based on its depth and whether it is a summary or
  activity row. Summary rows show own level + ancestry (D+1 bars); activity rows show
  parent ancestry only (D bars). This is the key driver for continuous branch bands.
- Applied continuous branch-level vertical bands in TaskTable row rendering:
  - The task/name `<td>` is `position: relative`.
  - `getWbsAncestorBandColors` is called for **every** row (not just summary rows).
  - Bands are `position: absolute`, `top: 0`, `bottom: 0` (full row height), 4 px wide.
  - Summary row bands: opacity 1. Activity row bands: opacity 0.45 (subtle containment cue).
  - Each level i band is at `left: 2 + i * 6` px, giving 6 px pitch (4 px bar + 2 px gap).
  - The existing `paddingLeft: getTaskIndentPx(task.depth)` in the content div ensures
    text never overlaps the band positions.
- Applied depth-based background (`getWbsBandColor`) to summary `rowBg`.
- Added R5B test suites covering all depth levels, clamping, and invalid/null/NaN
  fallbacks for all exported helpers including `getWbsAncestorBandColors`.

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

Summary row backgrounds use the tint matching their WBS level.
Activity rows remain white (`#ffffff`) or critical-red (`#ffebee`) as before.
Selected rows remain `#bbdefb` regardless of depth.

### Continuous Branch-Level Vertical Bands

Every row — summary and activity — renders absolutely-positioned, full-row-height
vertical colour bars at the left side of the task/name column. This creates
P6-style branch ownership: a WBS level's band colour runs continuously through
all descendant rows until the branch ends.

**Band layout** (each bar is 4 px wide, 2 px gap = 6 px pitch):

| Level i | left px | Colour |
|---------|---------|--------|
| 0       | 2       | `#2471a3` steel blue |
| 1       | 8       | `#1e8449` forest green |
| 2       | 14      | `#ca6f1e` burnt amber |
| 3       | 20      | `#7d3c98` plum |

**Bars per row type** (using `getWbsAncestorBandColors`):

- Summary row at depth D: D+1 bars (own level + all ancestor levels).
- Activity row at depth D: D bars (all parent WBS levels, at 0.45 opacity).
- Top-level activity (depth 0): no bars.

The existing `paddingLeft: 20px × depth` content indentation ensures text never
overlaps the band positions (max 4 bars occupy 24 px; depth-2 content starts at
40 px; depth-1 content at 20 px clears the 14 px band region).

**Effect**: each WBS summary "opens" a coloured column that continues through
every visible row it owns. Child WBS levels add inset bars. Activity rows appear
visually inside their WBS container.

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
