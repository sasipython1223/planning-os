# W5B-UI.R5B.2 — P6-style WBS Vertical Ownership Bands

Refs #61

## Scope Implemented

- Kept the existing **Activity ID** column visible and unchanged.
- Kept the existing **Activity Name** column visible and separate.
- Replaced the earlier thin summary marker treatment with a dedicated left-side ownership gutter inside the Activity Name cell.
- Rendered one dominant ownership band per row using existing `task.depth` and `task.isSummary` metadata only.
- Preserved TaskTable virtualization, collapse/expand behavior, and existing Gantt rendering paths.

## Visual Model

- Each row gets a single ownership band in a fixed gutter before the task name.
- Parent WBS rows use a taller rounded container band with a stronger left edge.
- Child WBS rows and activities shift inward as `depth` increases, so descendant rows read as nested inside the active WBS region.
- Activity rows use a slimmer branch band, keeping text contrast strong and avoiding overlays on top of Activity ID or Activity Name text.

## Why This Avoids Barcode-style Striping

- The gutter renders a single dominant band per row instead of parallel ancestor stripes.
- Nesting is communicated by band offset, width, border weight, and row typography rather than by stacking many coloured rails.
- Colours stay muted and secondary to the text, so the treatment reads as ownership structure instead of decoration.

## Guardrails Confirmed

- No Worker/protocol/import/Rust/WASM/kernel changes.
- No Gantt or timescale redesign.
- No virtualization rewrite.
- No scheduling logic added in React.
- No forbidden files were touched.

## Validation

```bash
pnpm -C apps/web exec vitest run
pnpm -C apps/web exec tsc -b
```

## Manual Localhost QA Checklist

1. Import XER.
2. Load to Workspace.
3. Confirm Activity ID column remains visible.
4. Confirm Activity Name column remains visible and readable.
5. Confirm parent WBS rows read as containers for descendants.
6. Confirm child WBS rows feel nested inside parent WBS regions.
7. Confirm activity rows feel inside the active WBS branch.
8. Confirm the left-side treatment does not look like barcode stripes.
9. Confirm collapse / expand still works.
10. Confirm Gantt still renders.
11. Confirm no `undefined`, `NaN`, or raw object values are visible.
12. Confirm 3,000+ row schedules remain usable.
