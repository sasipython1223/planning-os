# UI: Imported activities committed but not rendered (Issue #45)

## 1. Reproduction steps

1. Start `apps/web` against a worker bundle that includes the PR #44 import-commit fix.
2. With an empty workspace, click **Import** and choose a Primavera **XER** with a non-trivial WBS / activity count (the human-validated reproduction used 3,062 activities / 5,024 dependencies).
3. Wait for `IMPORT_PREVIEW` and click **Load to Workspace**.
4. Observe the status strip and the workspace body.

Result before this fix:
- Status strip: `Tasks: 3062 | Deps: 5024 | Scheduled: 3062 | Worker: Ready`.
- `Activities: 3062/3062 | Dependencies: 5024`.
- TaskTable body blank.
- Gantt body blank.
- Gantt timescale renders the literal text `undefined NaN`.

## 2. Worker success evidence (from Issue #45)

```
[AUDIT Kernel Math] (3062) [...]
[AUDIT Worker Emit] success path {taskCount: 3062, depCount: 5024, criticalCount: 299}
[AUDIT] IMPORT_SCHEDULE ack
```

```
Tasks: 3062 | Deps: 5024 | Scheduled: 3062 | Worker: Ready
Activities: 3062/3062 | Dependencies: 5024
```

The worker payload is correct. Worker authority is preserved by this fix —
React still consumes `DIFF_STATE` from the Web Worker `postMessage` channel
and only projects it.

## 3. React state / task count evidence

`App.tsx` writes the entire `DIFF_STATE` payload into React state on every
emit (`setTasks`, `setDependencies`, `setScheduleResults`, …). The status
strip is derived from that state via:

```ts
activityCount={tasks.length}
visibleActivityCount={visibleTasks.length}
dependencyCount={dependencies.length}
```

The observed `3062/3062 | 5024` therefore proves `tasks.length === 3062`,
`visibleTasks.length === 3062`, and `Object.keys(scheduleResults).length === 3062`
after commit. The Worker→React projection itself is healthy.

## 4. TaskTable input row count evidence

`<TaskTable tasks={visibleTasks} … />` is passed all 3,062 rows. The empty
body is **not** caused by upstream filtering — `visibleTasks.length` matches
`tasks.length`. The blank body is caused by `useVirtualWindow` returning
`endIndex = -1` when `viewportHeight === 0`:

```ts
if (itemCount === 0 || viewportHeight === 0) {
  return { startIndex: 0, endIndex: -1, offsetY: 0, totalHeight };
}
```

## 5. Gantt input / bar count evidence

`<GanttPane tasks={visibleTasks} scheduleResults={scheduleResults} … />`
also receives all 3,062 rows and 3,062 schedule results. `drawGantt`
short-circuits when the virtual window is empty:

```ts
const { startIndex, endIndex } = computeVirtualWindow(
  tasks.length, ROW_HEIGHT, scrollTop, viewportHeight,
);
if (endIndex < startIndex) return;
```

With `viewport.viewportHeight === 0` the canvas is also sized to 0 in
`GanttCanvas` (`canvas.height = viewportHeight * dpr`), so no bars are
drawn even before the early-return.

## 6. Timescale / date model evidence

`App.tsx` derives the timescale from `computeTimelineGeometry(scheduleResults, projectStartDate)`.
The original `parseUTCMs` parsed `projectStartDate` with:

```ts
const [y, m, d] = isoDate.split("-").map(Number);
return Date.UTC(y, m - 1, d);
```

Primavera XER `plan_start_date` values are typically of the form
`"YYYY-MM-DD HH:MM"` (e.g. `"2026-01-15 00:00"`). Splitting on `-` then
yields `["2026", "01", "15 00:00"]`, and `Number("15 00:00") === NaN`, so
`Date.UTC(2026, 0, NaN) === NaN`. The same shape exists in
`dateProjection.ts → parseUTC`, where the resulting Invalid Date causes:

```
formatDateShort(invalidDate)
  = `${months[NaN]} ${NaN}`
  = "undefined NaN"
```

That is the exact literal text observed in the Gantt timescale header.

The same Invalid-Date path also bubbles into `timelineStart`/`timelineEnd`
and any pixel math derived from them, although bars are gated earlier by
the viewport-height issue above.

## 7. Large-schedule rendering / virtualization evidence

The virtualization window is correct in isolation — given a non-zero
viewport height it would project ~20–30 rows from a 3,062-row source,
which is well within React's row-rendering budget. The 3,062-task scenario
is **not** a virtualization scaling failure; the bug is a missing
measurement on first appearance of the scroll track. The fix retains the
existing virtualization design.

## 8. Root cause

Two independent UI projection / rendering defects, both downstream of a
healthy Worker `DIFF_STATE`:

1. **`viewportHeight` measurement never reaches the scroll track after import.**
   The `ResizeObserver` for the shared vertical scroll track lives in a
   `useEffect(..., [])` in `App.tsx`. On the initial render
   `workspaceShellView === "empty"`, so the scroll track is not mounted and
   `scrollTrackRef.current` is `null`; the effect returns early. When the
   user commits an import and the shell transitions to `"loaded"`, the
   scroll track mounts but the empty-deps effect never re-runs.
   Consequence: `viewportHeight` stays at its initial `0`, the TaskTable's
   virtual window returns `endIndex = -1`, and the Gantt canvas is sized to
   0px — no rows, no bars.

2. **`parseUTC` / `parseUTCMs` reject XER-style date strings.**
   `projectStartDate` arriving from XER is `"YYYY-MM-DD HH:MM"` (or empty
   when the project lacks `plan_start_date`). The strict `YYYY-MM-DD`
   parsers produce `NaN` / Invalid Date, which `formatDateShort` renders as
   the literal text `"undefined NaN"` in the Gantt timescale.

## 9. Fix scope

Narrow, UI-only changes consistent with the issue's guardrails. No worker,
protocol, parser, WASM, kernel, package, lockfile, or CI changes.

1. `apps/web/src/App.tsx` — replace the empty-deps `useEffect` with a
   callback-ref pattern (`handleScrollTrackRef`) that drives a `useState`
   element handle. The measurement effect now depends on the element
   handle, so it runs when the scroll track first attaches to the DOM
   (i.e. on the shell transition to `"loaded"`). `scrollTrackRef.current`
   is still maintained for the existing scroll-handler / drag-autoscroll
   consumers and for the `vScrollRef` prop on `GanttPane`.

2. `apps/web/src/utils/dateProjection.ts` — `parseUTC` accepts the strict
   `YYYY-MM-DD` form **and** the common XER / ISO forms
   `YYYY-MM-DD HH:MM[:SS]` / `YYYY-MM-DDTHH:MM:SSZ`. Empty or unparseable
   input falls back to today's UTC midnight so the timescale always
   renders finite, non-`undefined` labels.

3. `apps/web/src/utils/timelineGeometry.ts` — same hardening for
   `parseUTCMs`, returning a finite epoch ms instead of `NaN`.

4. Tests:
   - `apps/web/src/utils/dateProjection.test.ts` — 6 regression cases.
   - `apps/web/src/utils/timelineGeometry.test.ts` — 4 regression cases.

## 10. Files changed

```
apps/web/src/App.tsx
apps/web/src/utils/dateProjection.ts
apps/web/src/utils/timelineGeometry.ts
apps/web/src/utils/dateProjection.test.ts          (new)
apps/web/src/utils/timelineGeometry.test.ts        (new)
docs/milestones/UI-imported-activities-committed-but-not-rendered.md  (this file)
```

## 11. Validation results

```
pnpm -C apps/web exec vitest run
  → Test Files  8 passed (8)
        Tests  88 passed (88)
```

The previously passing 78 tests still pass; the 10 new regression tests
pin the hardened behaviour for both root causes.

```
pnpm -C apps/web exec tsc -b
  → src/components/HistogramPane.tsx(149,13): error TS6133: 'mouseY' is declared but its value is never read.
    src/components/TaskDetailsPanel.test.ts(26,10): error TS6133: '_constraintNeedsDate' is declared but its value is never read.
```

Both errors pre-date this PR and are unrelated to Issue #45. No new
typecheck errors are introduced by the fix.

## 12. Remaining risks

- The viewport-height fallback uses a `ResizeObserver` keyed on the
  element handle returned by the callback ref. If the scroll track is
  ever unmounted and remounted while the workspace is still in `"loaded"`
  state (e.g. via a future hot-swap of the layout), `viewportHeight` is
  briefly reset to `0` before the observer re-fires. This matches the
  pre-existing single-mount behaviour and is acceptable for the current
  shell.
- The `parseUTC` fallback to today's date is defensive only. The expected
  worker payload after PR #44 is always a non-empty XER date; the
  fallback simply guarantees that an unexpected payload never surfaces as
  `"undefined NaN"`.
- Worker authority is unchanged. React still treats `DIFF_STATE` as the
  single source of truth and never mutates scheduling state.
