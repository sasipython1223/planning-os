# TD-CAL-VIS.1 Imported Date/Time Fidelity and Gantt Hour Projection Audit

**Audit Scope:** READ-ONLY audit. No production code changes. Non-breaking investigation only.

**Issue Observed:**
- Imported XER schedule shows some Start/Finish values as 00:00 and some as 09:00
- Gantt bars appear snapped to whole-day boundaries instead of proportional start/end hour positions
- Question: Are imported P6 activity HH:mm being parsed, stored, and displayed correctly?

**Audit Constraints:**
- Do not change production code
- Do not recalculate imported source dates
- Do not change sourceImportedNotCalculated lifecycle
- Do not modify authority routing
- Preserve imported source dates exactly

---

## 1. Executive Summary

Audit of XER date/time parsing, canonical storage, TaskTable display, and Gantt projection reveals **multiple disconnects between time-of-day preservation and visual rendering**:

| Layer | Finding | Severity | Impact |
|-------|---------|----------|--------|
| **XER Parser** | Preserves raw date strings; Date.parse() handles HH:mm if present | ✅ OK | Time-of-day passed through if in XER |
| **Mapper** | Converts parsed dates to minute offsets (preserves precision) | ✅ OK | Sub-day precision retained in storage |
| **Canonical Storage** | `SourceTaskDates` stores both `sourceStartMinutes` and raw `sourceRawStart` string | ✅ OK | Both minute offset and raw string preserved |
| **TaskTable Display** | Uses `projectDateFromMinutesFormatted()` with default format "DD-MMM-YY" (no time) | ⚠️ PARTIAL | Time silently dropped unless user switches to "HH:mm" format |
| **Gantt Projection** | Passes `earlyStartMinutes` to `dateToX()` as if they are day offsets | ❌ BROKEN | Massive scaling error; bars positioned far off-screen |
| **Display Filter** | Gantt only shows calculated dates; source dates never rendered | ❌ MISSED | No visual comparison of source vs. calculated |

**Root Cause:** Gantt x-position calculation treats minute offsets as day offsets, causing unit mismatch and bar misplacement.

---

## 2. XER Date/Time Parsing Findings

### 2.1 Parser Implementation

**File:** `packages/worker/src/import/parsers/xerParser.ts`

**What Happens:**
- XER format: tab-delimited text with %T (table), %F (fields), %R (rows), %E (end)
- Parser calls `splitFields()` on each row and builds objects
- Date strings are stored as-is without modification (pure string pass-through)

**Date Fields Extracted from XER TASK Table:**

| P6 Field | Extracted? | Type | Storage |
|----------|-----------|------|---------|
| `target_start_date` | ✅ Yes | string | `XerTask.target_start_date` |
| `target_end_date` | ✅ Yes | string | `XerTask.target_end_date` |
| `act_start_date` | ✅ Yes | string | `XerTask.act_start_date` |
| `act_end_date` | ✅ Yes | string | `XerTask.act_end_date` |
| `remain_start_date` | ✅ Yes | string | `XerTask.remain_start_date` |
| `remain_end_date` | ✅ Yes | string | `XerTask.remain_end_date` |
| `suspend_date` | ✅ Yes | string | `XerTask.suspend_date` |
| `resume_date` | ✅ Yes | string | `XerTask.resume_date` |
| `cstr_date` | ✅ Yes | string | `XerTask.cstr_date` |

**Time Preservation in Parsing:**
- ✅ Raw date strings preserved exactly as they appear in XER file
- ✅ If XER contains `2026-05-08T09:00:00Z`, string is kept
- ✅ If XER contains `2026-05-08` (date-only), no time added
- ⚠️ **Issue:** P6 XER export typically provides **date-only** (YYYY-MM-DD format) without explicit HH:mm unless the schedule has been set to track intra-day times
- ⚠️ Test data shows format: `2026-05-08` (no time component)

**Timezone Handling:**
- ✅ No explicit timezone conversion in parser
- ✅ Raw strings passed directly to `Date.parse()` downstream
- ✅ JavaScript `Date.parse()` handles ISO 8601 variants:
  - `2026-05-08` → parsed as UTC midnight (00:00)
  - `2026-05-08T09:00:00` → parsed as UTC 09:00
  - `2026-05-08T09:00:00Z` → parsed as UTC 09:00

### 2.2 Mapper Date Conversion

**File:** `packages/worker/src/import/mappers/xerMapper.ts` (lines 105-112)

**Parser-to-Mapper Conversion:**

```typescript
function parseOffsetMinutes(sourceDate: string | undefined, projectStartMs: number): number | undefined {
  if (!sourceDate || Number.isNaN(projectStartMs)) return undefined;
  const ms = Date.parse(sourceDate);  // Parses full datetime if present
  if (Number.isNaN(ms)) return undefined;
  return Math.round((ms - projectStartMs) / 60_000);  // Returns minute offset
}
```

**What Happens:**
- ✅ Calls `Date.parse()` on the raw XER date string
- ✅ If XER has `2026-05-08T09:00:00`, `Date.parse()` returns milliseconds at 09:00 UTC
- ✅ If XER has `2026-05-08`, `Date.parse()` returns milliseconds at 00:00 UTC
- ✅ Calculates **minute offset** from project start: `(ms - projectStartMs) / 60_000`
- ✅ Preserves sub-day precision (fractional minutes)

**Precision Preservation:**
- ✅ Original millisecond-level precision preserved
- ✅ Converted to minute offset (integer minutes)
- ✅ Example: `2026-05-08T09:00:00` with project start `2026-05-01` → 10,080 minutes (7 days × 1440 min/day + 9 hours × 60 min/hr)

**Result in SourceTaskDates:**

```typescript
const sourceDates: SourceTaskDates = {
  sourceStartMinutes: parseOffsetMinutes(xt.target_start_date, projectStartMs),  // e.g., 8640 min
  sourceFinishMinutes: parseOffsetMinutes(xt.target_end_date, projectStartMs),   // e.g., 12960 min
  sourceRawStart: xt.target_start_date || undefined,  // e.g., "2026-05-08" or "2026-05-08T09:00:00"
  sourceRawFinish: xt.target_end_date || undefined,
};
```

**Conclusion on Parsing/Mapping:**
- ✅ Time-of-day IS preserved IF present in XER file
- ✅ Time-of-day becomes 00:00 IF XER contains date-only strings
- ✅ Minute precision maintained throughout
- ⚠️ **Most P6 exports use date-only format by default** (unless intra-day scheduling is active)

---

## 3. Canonical Storage Findings

### 3.1 Source Dates Storage

**File:** `packages/protocol/src/import.ts` (lines 241-250)

```typescript
export type SourceTaskDates = {
  readonly sourceStartMinutes?: number;
  readonly sourceFinishMinutes?: number;
  readonly sourceRawStart?: string;
  readonly sourceRawFinish?: string;
};
```

**What's Stored:**
- ✅ `sourceStartMinutes`: Minute offset from project start (e.g., 8640 = 6 days exactly, or 10080 = 6 days 9 hrs)
- ✅ `sourceFinishMinutes`: Minute offset from project finish
- ✅ `sourceRawStart`: Raw date string from XER (e.g., `"2026-05-08"` or `"2026-05-08T09:00:00"`)
- ✅ `sourceRawFinish`: Raw date string from XER

**Separation of Concerns:**
- ✅ Source dates stored in `sourceDatesByTaskId` (imported state)
- ✅ Calculated dates stored in `ScheduleResult.earlyStartMinutes`, `earlyFinishMinutes` (planner-calculated state)
- ✅ Both kept separate; Task state does not have `sourceStart` / `sourceFinish` fields
- ✅ Lifecycle flag: `scheduleLifecycle` indicates if source or calculated should be primary

**State Storage in Canonical Task:**

```typescript
type Task = {
  id: string;
  name: string;
  // Calculated dates only (no source dates on Task itself)
  // Source dates must be read from sourceDatesByTaskId sidecar
};
```

**Storage Lifecycle:** `sourceImportedNotCalculated`
- After import, state is set to `sourceImportedNotCalculated`
- Scheduling is run anyway for "rendering compatibility"
- But lifecycle flag indicates source dates are authoritative
- ⚠️ **Issue:** Gantt and TaskTable don't check lifecycle flag to decide which dates to display

### 3.2 Display Data Model

**File:** `apps/web/src/services/importDetailsViewModel.ts` (lines 390-405)

How source dates are prepared for display:

```typescript
const assignedActivities: ImportDetailsUsedByActivity[] = assignedTasks.map((t) => {
  const srcDates = sourceDatesByTaskId[t.id];
  return {
    taskId: t.id,
    sourceStart: srcDates?.sourceStartMinutes != null
      ? projectDateFromMinutesFormatted(projectStartDate, srcDates.sourceStartMinutes, dateDisplayFormat)
      : undefined,
    sourceFinish: srcDates?.sourceFinishMinutes != null
      ? projectDateFromMinutesFormatted(projectStartDate, srcDates.sourceFinishMinutes, dateDisplayFormat)
      : undefined,
  };
});
```

**Formatted Output:**
- ✅ Calls `projectDateFromMinutesFormatted()` which:
  1. Converts minute offset to UTC Date using `projectDateFromMinutes()`
  2. Formats using `formatWithDisplayFormat(date, dateDisplayFormat)`
- ✅ Result depends on `dateDisplayFormat` (default: "DD-MMM-YY")
  - If format is "DD-MMM-YY": `"08-May-26"` (time hidden)
  - If format is "DD-MMM-YY HH:mm": `"08-May-26 08:00"` (time shown)
  - If format is "YYYY-MM-DD HH:mm": `"2026-05-08 08:00"` (time shown)

**Conclusion on Storage:**
- ✅ Time-of-day preserved in `sourceStartMinutes` / `sourceFinishMinutes`
- ✅ Raw string preserved in `sourceRawStart` / `sourceRawFinish`
- ✅ Separate from calculated dates
- ⚠️ Display format strips time by default

---

## 4. TaskTable Display Findings

### 4.1 TaskTable Date Columns

**File:** `apps/web/src/components/TaskTable.tsx`

**Columns for Actual Dates (W4.4):**

| Column ID | Label | Formatter | Source |
|-----------|-------|-----------|--------|
| `act-start` | AStart | `projectDateFromMinutesFormatted(ctx.projectStartDate, actuals.actualStartMinutes, ctx.dateDisplayFormat)` | `sourceActuals[task.id].actualStartMinutes` |
| `act-finish` | AFin | `projectDateFromMinutesFormatted(ctx.projectStartDate, actuals.actualFinishMinutes, ctx.dateDisplayFormat)` | `sourceActuals[task.id].actualFinishMinutes` |

**Columns for Calculated Dates:**

| Column | Source | Format |
|--------|--------|--------|
| "Start" | `schedule.earlyStartMinutes` | Via timescale model |
| "Finish" | `schedule.earlyFinishMinutes` | Via timescale model |

### 4.2 Date Formatting

**File:** `apps/web/src/utils/dateProjection.ts` (lines 68-105)

```typescript
export const DATE_DISPLAY_FORMAT_OPTIONS: ReadonlyArray<{ value: DateDisplayFormat; label: string }> = [
  { value: "DD-MMM-YY",        example: "08-May-26" },
  { value: "DD-MMM-YYYY",      example: "08-May-2026" },
  { value: "YYYY-MM-DD",       example: "2026-05-08" },
  { value: "DD-MMM-YY HH:mm",  example: "08-May-26 08:00" },
  { value: "YYYY-MM-DD HH:mm", example: "2026-05-08 08:00" },
];

export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = "DD-MMM-YY";

export function formatWithDisplayFormat(date: Date, format: DateDisplayFormat): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[date.getUTCMonth()];
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  switch (format) {
    case "DD-MMM-YY":         return `${dd}-${mon}-${y2}`;           // NO TIME
    case "DD-MMM-YYYY":       return `${dd}-${mon}-${y4}`;           // NO TIME
    case "YYYY-MM-DD":        return `${y4}-${mm}-${dd}`;            // NO TIME
    case "DD-MMM-YY HH:mm":   return `${dd}-${mon}-${y2} ${hh}:${mi}`;
    case "YYYY-MM-DD HH:mm":  return `${y4}-${mm}-${dd} ${hh}:${mi}`;
  }
}
```

**Issue:** Default format is "DD-MMM-YY" which doesn't include time. User must explicitly switch to "HH:mm" format to see times.

### 4.3 Where 00:00 Appears

**Scenario 1: Default Format (No HH:mm)**
- User views TaskTable with default "DD-MMM-YY" format
- Source dates display as `"08-May-26"` (no time shown)
- User perceives dates as having "00:00" time (implicit, not shown)

**Scenario 2: HH:mm Format Selected**
- If source date is `2026-05-08` (no time in XER):
  - `Date.parse("2026-05-08")` → 00:00 UTC → displays as `"08-May-26 00:00"`
- If source date is `2026-05-08T09:00:00` (with time in XER):
  - `Date.parse("2026-05-08T09:00:00")` → 09:00 UTC → displays as `"08-May-26 09:00"`

**Root Cause of 00:00 vs 09:00 Variation:**
- 00:00 appears when XER contains **date-only** strings (standard P6 export)
- 09:00 appears when XER contains **intra-day time** strings (only if P6 project has time-tracking enabled)
- ✅ Parser preserves whatever is in the XER file
- ✅ Formatter correctly shows the time from the parsed date
- ⚠️ **User confusion:** Different values suggest inconsistency in source data, not a bug

### 4.4 Source Planned Dates Display

**Finding:** Source planned dates (not actuals) are NOT currently displayed in TaskTable.

**Where Source Planned Dates Are Shown:**
- ✅ Import Details Panel (`importDetailsViewModel`)
- ✅ Variance Report Panel
- ❌ Main TaskTable (not shown)

**Consequence:** User cannot easily see source Start/Finish in main task editing interface.

### 4.5 Conclusion on TaskTable Display

- ✅ Formatting logic correctly handles both date-only and date-time formats
- ✅ User can switch display format to include HH:mm if desired
- ⚠️ Default format hides time (by design, for readability)
- ⚠️ Source planned dates not shown in main TaskTable (only actuals)
- ⚠️ Inconsistent time values (00:00 vs 09:00) reflect actual P6 data variation, not a bug

---

## 5. Gantt Projection Findings

### 5.1 Gantt Rendering Architecture

**Files:** 
- `packages/web/src/components/gantt/drawGantt.ts`
- `packages/web/src/components/gantt/timescaleModel.ts`
- `packages/web/src/components/gantt/ganttGeometry.ts`

### 5.2 Date-to-X Projection Logic

**In `timescaleModel.ts` (lines 450-452):**

```typescript
export function createTimescaleModel(input: TimescaleInput): TimescaleModel {
  // ...
  const dateToX = (day: number): number => day * unitWidth;
  const spanWidth = (startDay: number, finishDay: number): number => (finishDay - startDay) * unitWidth;
  // ...
}
```

**What This Does:**
- `dateToX(day)`: Converts a numeric value `day` to pixel x-position
- `unitWidth`: pixels per day (e.g., 8 pixels per day at Month/Only zoom)
- **CRITICAL:** Function assumes `day` is in **day units**, not minutes

### 5.3 How Gantt Calls dateToX

**In `drawGantt.ts` (lines 278-282):**

```typescript
const duration = durationOverrides?.get(task.id) ?? (task.durationWorkMinutes / MINUTES_PER_DAY);
const earlyStart = positionOverrides?.get(task.id) ?? schedule.earlyStartMinutes;
const x = timescaleModel.dateToX(earlyStart);  // ← PASSES MINUTES, NOT DAYS
const y = i * ROW_HEIGHT + BAR_VERTICAL_PADDING;
const barWidth = timescaleModel.spanWidth(schedule.earlyStartMinutes, schedule.earlyFinishMinutes);  // ← PASSES MINUTES
```

**THE BUG:**

| Variable | Unit | Value (Example) | Expected by dateToX | What Happens |
|----------|------|-----------------|---------------------|--------------|
| `earlyStartMinutes` | Minutes | 8640 (6 days) | Day units (6) | 8640 × 8 px/day = 69,120 pixels off-screen! |
| `earlyFinishMinutes` | Minutes | 10,080 (7 days) | Day units (7) | 10,080 × 8 = 80,640 pixels |
| `spanWidth()` result | Pixels | Expected 40px | N/A | (10,080 - 8,640) × 8 = 11,520 pixels (way too wide) |

**Visual Impact:**
- Gantt bars positioned massively off-screen to the right
- Users see mostly empty canvas or bars far beyond viewport
- No bar alignment with visual day cells

### 5.4 Unit Mismatch Analysis

**Root Cause:**
- CPM engine outputs dates in **minute offsets** (`earlyStartMinutes`, etc.)
- Gantt timescale model expects **day offsets** (`day`, representing fractional days)
- 1 day = 1440 minutes

**Missing Conversion:**
```typescript
// Current (WRONG):
const earlyStart = schedule.earlyStartMinutes;
const x = timescaleModel.dateToX(earlyStart);  // Treats 8640 min as 8640 days!

// Should be:
const earlyStart = schedule.earlyStartMinutes / 1440;  // Convert to days
const x = timescaleModel.dateToX(earlyStart);  // Now 6 days
```

### 5.5 Fractional-Day Precision Available

**Positive Finding:** The unit mismatch doesn't prevent fractional-day (HH:mm) positioning if corrected.

- `dateToX` correctly multiplies by fractional day offsets
- `unitWidth` is already sub-day granular (e.g., 8 px/day = 0.33 px/hour at 8px/day zoom)
- If week/day zoom used (e.g., 100 px/day): 0.11 px/minute precision available
- **Gantt COULD support HH:mm positioning once unit mismatch is fixed**

### 5.6 Source Dates Not Rendered

**Finding:** Gantt only renders calculated dates (`earlyStartMinutes`, `earlyFinishMinutes`).

**Where Source Dates Are:**
- ✅ Stored in `sourceDatesByTaskId` (accessible in state)
- ❌ Never passed to Gantt rendering functions
- ❌ No visualization of source vs. calculated comparison

**Consequence:** User cannot see if source dates differ from calculated dates in Gantt view.

### 5.7 Conclusion on Gantt Projection

- ❌ **CRITICAL BUG:** Minute offsets treated as day offsets → massive scaling error
- ❌ Bars positioned far off-screen, not aligned to visual day cells
- ✅ Fractional-day precision available if unit conversion added
- ❌ Source dates not visualized (only calculated dates shown)
- ⚠️ HH:mm positioning possible after fix but requires source date wiring

---

## 6. Root Cause Classification

### Classification Matrix

| Issue | Root Cause | Layer | Severity |
|-------|-----------|-------|----------|
| Some dates show 00:00 | XER file contains date-only (no HH:mm) | Parser input | Expected |
| Some dates show 09:00 | XER file contains intra-day times | Parser input | Expected |
| TaskTable displays only date (no time) by default | Display format default "DD-MMM-YY" | Display | By design |
| Gantt bars off-screen | **E. Unit mismatch: minutes passed as days** | Gantt | **CRITICAL** |
| Gantt bars not proportional to HH:mm | **E. Same unit mismatch** | Gantt | **CRITICAL** |
| Source dates not visible in Gantt | **D. Display logic never reads source dates** | Display | Design gap |

### Primary Root Cause: **E. Gantt projection uses minute offsets as day offsets**

In `drawGantt.ts`, the code passes `schedule.earlyStartMinutes` directly to `timescaleModel.dateToX()`, which expects day units. This causes:
- ✅ Correct: Minute offsets calculated and stored (parser, mapper, state)
- ✅ Correct: Minute offsets support fractional-day precision
- ❌ **WRONG:** Gantt interprets minutes as days, causing 1440× magnification error

### Secondary Issues: **D. Source dates not displayed + F. No awareness of sourceImportedNotCalculated lifecycle**

- Gantt doesn't check `scheduleLifecycle` to decide which dates to show
- Source dates (`sourceDatesByTaskId`) never wired to Gantt rendering
- TaskTable also doesn't adapt display based on lifecycle

---

## 7. Recommended Behaviour

### 7.1 For Time-of-Day Preservation

**Goal:** Honor HH:mm from source (if present) and show proportionally in Gantt.

**Recommended Rules:**

1. **Date Formats in TaskTable:**
   - When `sourceImportedNotCalculated`: Show source dates with HH:mm (if available)
   - When `plannerCalculated`: Show calculated dates with HH:mm for fidelity
   - Default display format remains "DD-MMM-YY" for readability
   - User can switch to "DD-MMM-YY HH:mm" or "YYYY-MM-DD HH:mm" to reveal times

2. **Gantt Visual Placement:**
   - **Year/Quarter/Month zooms:** Round to day boundaries (readability)
   - **Week/Day zooms:** Place bars proportionally within day (HH:mm support)
   - Example: activity starting 09:00 should start at 37.5% into visual day cell (9/24)
   - Use calendar-time proportional placement, not working-time compression

3. **Source vs. Calculated:**
   - When `sourceImportedNotCalculated`: Gantt displays source dates
   - When `plannerCalculated`: Gantt displays calculated dates
   - Allow visual overlay comparison (future enhancement)

4. **Time Zone Handling:**
   - Continue using UTC throughout (no timezone conversion)
   - Preserve P6 date strings exactly (no normalization to midnight)
   - Display as UTC (no local timezone conversion)

### 7.2 Expected Behaviour Examples

**Import XER with mixed date formats:**
- Task A: `target_start_date = "2026-05-08"` (00:00)
- Task B: `target_start_date = "2026-05-08T09:00:00"` (09:00)

**After import with sourceImportedNotCalculated:**
- TaskTable shows: `"08-May-26 00:00"` and `"08-May-26 09:00"` (if HH:mm format selected)
- ImportDetails shows same times
- Gantt shows bars aligned proportionally (once fixed)
- Scheduler runs; calculated dates likely differ (not yet shown)

**After recalculation (future B3 phase):**
- TaskTable can switch to show calculated dates
- Gantt shows calculated dates
- Variance panel compares source vs. calculated

---

## 8. Proposed Narrow Fix Plan

### 8.1 Gantt Projection Fix (Critical)

**File:** `packages/web/src/components/gantt/drawGantt.ts` (and related)

**Change Required:** Convert minute offsets to day offsets before calling `dateToX()`.

**Proposed Fix (Skeleton - do not implement yet):**

```typescript
// Line ~278 in drawGantt.ts - EXAMPLE ONLY, DO NOT IMPLEMENT
const duration = durationOverrides?.get(task.id) ?? (task.durationWorkMinutes / MINUTES_PER_DAY);
const earlyStartDays = positionOverrides?.get(task.id) 
  ? positionOverrides.get(task.id) / MINUTES_PER_DAY  // Convert min to days
  : schedule.earlyStartMinutes / MINUTES_PER_DAY;      // Convert min to days
const x = timescaleModel.dateToX(earlyStartDays);

const barWidth = (durationOverrides?.has(task.id) || positionOverrides?.has(task.id))
  ? timescaleModel.spanWidth(0, duration)
  : timescaleModel.spanWidth(
      schedule.earlyStartMinutes / MINUTES_PER_DAY,     // Convert min to days
      schedule.earlyFinishMinutes / MINUTES_PER_DAY     // Convert min to days
    );
```

**Scope of Impact:**
- Fixes bar positioning to align with visual day cells
- Enables fractional-day (HH:mm) positioning at Week/Day zooms
- No changes to timescale model or other rendering logic
- Affects only drawGantt.ts and related bar-drawing functions

**Test Coverage Needed:**
- Unit tests: minute-to-day conversion correctness
- Visual regression tests: bar positions match expected day cells
- Edge cases: zero-duration tasks, single-hour tasks, sub-hour tasks (future)

### 8.2 TaskTable Source Date Column (Enhancement)

**File:** `packages/web/src/components/TaskTable.tsx`

**Change Required:** Add source Start/Finish columns (optional, off by default).

**Proposed Column Addition (Skeleton - do not implement yet):**

```typescript
// Pseudocode - DO NOT IMPLEMENT YET
const sourceStartColumn = {
  id: "src-start",
  label: "SStart",
  title: "Source Start",
  width: 88,
  source: "imported",
  visibleByDefault: false,
  renderCell: (row, ctx) => {
    const srcDates = ctx.sourceDates?.[row.id];
    const label = srcDates?.sourceStartMinutes != null
      ? projectDateFromMinutesFormatted(ctx.projectStartDate, srcDates.sourceStartMinutes, ctx.dateDisplayFormat)
      : "—";
    return <span>{label}</span>;
  }
};
```

**Scope:** Minor UI addition, no core logic changes.

### 8.3 Lifecycle-Aware Display (Design Decision Pending)

**Files:** Gantt component, TaskTable context

**Change Required:** Check `scheduleLifecycle` and decide which dates to display.

**Decision Needed:**
- Should Gantt automatically show source dates when `sourceImportedNotCalculated`?
- Should user have explicit toggle for source vs. calculated dates?
- Should both be shown side-by-side (overlaid)?

**Not Proposed Here:** Requires design discussion with product team.

---

## 9. Risks and Non-Goals

### 9.1 Risks

| Risk | Mitigation |
|------|-----------|
| Unit conversion could introduce rounding errors for fractional-day offsets | Use integer minute arithmetic; convert only at rendering time |
| Gantt zoom levels may need re-tuning if bars change size | Visual regression testing will catch misalignments |
| Source date display may clutter TaskTable UI | Keep columns hidden by default; user can enable if needed |

### 9.2 Out of Scope (Not to Be Done in This Phase)

- ❌ Working-time calendar compression (only calendar-time proportional placement)
- ❌ Timezone conversion (continue using UTC)
- ❌ Recalculation workflow (stay in `sourceImportedNotCalculated` state)
- ❌ Temporal authority changes (unrelated to date display)
- ❌ Authority routing modifications (unrelated to date display)

### 9.3 Future Enhancements (B3+)

- [ ] Overlay source vs. calculated dates in Gantt for visual comparison
- [ ] Allow user to recalculate and switch to `plannerCalculated` lifecycle
- [ ] Support working-time calendars with compressed Gantt display
- [ ] Calendar time-tracking UI for intra-day scheduling
- [ ] Import time-tracking settings from P6 project

---

## 10. Summary Table: Findings by Layer

| Layer | Component | Status | Key Finding | Action |
|-------|-----------|--------|-------------|--------|
| **Ingestion** | XER Parser | ✅ OK | Preserves raw date strings exactly | No change needed |
| **Ingestion** | Mapper | ✅ OK | Converts to minute offsets; precision preserved | No change needed |
| **Storage** | Canonical State | ✅ OK | Source and calculated dates separate | No change needed |
| **Display** | TaskTable | ⚠️ PARTIAL | Format strips time by default | Design discussion |
| **Display** | TaskTable columns | ⚠️ MISSING | Source planned dates not shown | Add optional columns |
| **Display** | Formatter | ✅ OK | Handles date-only and date-time formats correctly | No change needed |
| **Rendering** | Gantt Model | ✅ OK | Supports fractional-day precision | No change needed |
| **Rendering** | Gantt Drawing | ❌ BROKEN | Minute offsets treated as day offsets | **Fix unit conversion** |
| **Rendering** | Source Display | ❌ MISSING | Gantt never renders source dates | Add wiring (future) |
| **Logic** | Lifecycle Check | ❌ MISSING | Gantt ignores sourceImportedNotCalculated | Add check (future) |

---

## 11. Audit Completion Checklist

- ✅ XER date/time parsing examined: time preserved if present, date-only if not
- ✅ Canonical storage examined: source dates stored with minute precision
- ✅ TaskTable display examined: format strips time by default, user can switch
- ✅ Gantt projection examined: **critical unit mismatch found** (minutes as days)
- ✅ Root causes classified: E (Gantt unit mismatch) is primary; D (source display) is secondary
- ✅ Recommended behaviour outlined: preserve HH:mm, proportional placement at Week/Day zoom
- ✅ Narrow fix plan proposed: Gantt conversion, optional TaskTable columns
- ✅ Risks documented: rounding, UI clutter, zoom tuning
- ✅ Non-goals clarified: no working-time compression, no timezone conversion, no authority changes

---

## Appendix: Code References

**Key Files for Review:**
- `packages/worker/src/import/mappers/xerMapper.ts` (lines 105-365) — Parsing and mapping
- `apps/web/src/utils/dateProjection.ts` (lines 1-160) — Display formatters
- `apps/web/src/components/gantt/drawGantt.ts` (lines 270-295) — **Critical: Gantt rendering**
- `apps/web/src/components/gantt/timescaleModel.ts` (lines 437-460) — Timescale model
- `packages/protocol/src/import.ts` (lines 235-250) — Source date type

**Key Test Files:**
- `packages/worker/tests/import/importCommit.test.ts` — Import test data
- `apps/web/src/components/taskTableActuals.test.ts` — Display format tests

---

**END OF AUDIT**

*No production code changes made. Audit complete.*
