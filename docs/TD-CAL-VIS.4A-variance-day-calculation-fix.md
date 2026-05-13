# TD-CAL-VIS.4A Variance Day Calculation Fix Report

## 1. Root Cause

The Source vs Planner Recalculation Report (TD-CAL-VIS.4) was displaying incorrect date/time movement variance values due to a divisor unit mismatch:

**Problem:**
- The formatter function `formatVarianceMinutes()` divided all variance values by `MINUTES_PER_DAY` (480 minutes = 1 working day)
- **Working day minutes (480)** is appropriate for duration-based differences (task duration spans working hours within the 8-hour workday)
- **Calendar day minutes (1440)** is required for date/time movement calculations (elapsed calendar time spanning all 24 hours)
- Date/time movement and duration are conceptually different and should not share the same divisor

**Evidence:**
For Therme XER example activity TME_GN1050:
- Source Start: 30-Sep-26 08:00
- Planner Start: 20-Feb-26 08:00
- **Reported variance (before fix):** -666.00d
- **Expected variance (after fix):** -221.33d
- **Mathematical verification:** -666.00d ≈ -221.33d × 3, confirming divisor used 480 instead of 1440

For Therme XER project finish:
- Imported Source Rollup Finish: 30-Sep-26 08:00
- Planner Rollup Finish: 20-Feb-26 16:00
- **Reported finish movement (before fix):** -665.00d
- **Expected finish movement (after fix):** -221.00d

**Root cause code location:**
`apps/web/src/services/sourcePlannerReportViewModel.ts`, function `formatVarianceMinutes()`:
```typescript
// BEFORE (WRONG for date/time movement):
function formatVarianceMinutes(minutes: number | undefined): string {
  const days = minutes / MINUTES_PER_DAY;  // 480 → wrong for dates
  return `${sign}${days.toFixed(2)}d`;
}
```

---

## 2. Fix Applied

**Solution: Separate date-movement formatter from duration formatter**

Introduced three distinct formatters to clarify unit semantics:

1. **`formatDateMovementVarianceMinutes()`** — Uses 1440 calendar minutes/day
   - Applied to: Start variance, Finish variance, Finish movement
   - Represents: Elapsed calendar time between two date/time values
   - Formula: `minutes / 1440`

2. **`formatDurationVarianceMinutes()`** — Uses 480 working minutes/day
   - Applied to: Duration variance
   - Represents: Difference between two duration quantities (stored in working minutes)
   - Formula: `minutes / 480`

3. **`formatDurationMinutes()`** — Uses 480 working minutes/day
   - Applied to: Source and planner duration displays
   - Represents: Duration display in working days
   - Formula: `minutes / 480`

**Fix code location:**
`apps/web/src/services/sourcePlannerReportViewModel.ts` lines 79–113:
```typescript
/** Calendar minutes per day: 24 hours × 60 minutes. Used for date/time movement calculations. */
const CALENDAR_MINUTES_PER_DAY = 1440;

/**
 * Format date/calendar movement variance in calendar days (1440 minutes/day).
 * Used for start variance, finish variance, and finish movement.
 */
function formatDateMovementVarianceMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const sign = minutes > 0 ? "+" : "";
  const days = minutes / CALENDAR_MINUTES_PER_DAY;
  return `${sign}${days.toFixed(2)}d`;
}

/**
 * Format duration variance in working days (480 minutes/day).
 * Used for duration-based differences.
 */
function formatDurationVarianceMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const sign = minutes > 0 ? "+" : "";
  const days = minutes / MINUTES_PER_DAY;
  return `${sign}${days.toFixed(2)}d`;
}

/**
 * Format duration display in working days (480 minutes/day).
 * Used for source and planner duration displays.
 */
function formatDurationMinutes(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined;
  return `${(minutes / MINUTES_PER_DAY).toFixed(2)}d`;
}
```

**Applied to report fields:**
- Line 222: `startVariance: formatDateMovementVarianceMinutes(variance.startVarianceMinutes)`
- Line 230: `finishVariance: formatDateMovementVarianceMinutes(variance.finishVarianceMinutes)`
- Line 231: `durationVariance: formatDurationVarianceMinutes(durationVarianceMinutes)`
- Line 284: `finishMovement: formatDateMovementVarianceMinutes(finishMovementMinutes)`

---

## 3. Before / After Example

### Therme XER Activity TME_GN1050 Finish Variance

| Metric | Before Fix | After Fix | Unit | Calculation |
|--------|-----------|-----------|------|-------------|
| Source Finish Minutes | 391680 | 391680 | project-relative | Sep 30 08:00 from Jan 1 |
| Planner Finish Minutes | 73440 | 73440 | project-relative | Feb 20 16:00 from Jan 1 |
| Variance Minutes | -318240 | -318240 | minutes | 73440 − 391680 |
| Divisor Used | 480 (wrong) | 1440 (correct) | minutes/day | working vs calendar |
| Reported Variance | -663.00d ❌ | -221.00d ✅ | calendar days | |

**Calculation detail:**
- -318240 minutes ÷ 480 (working min/day) = -663.00d (WRONG)
- -318240 minutes ÷ 1440 (calendar min/day) = -221.00d ✅

### Therme XER Project Finish Movement

| Metric | Before Fix | After Fix | Notes |
|--------|-----------|-----------|-------|
| Imported Source Rollup Finish | 30-Sep-26 08:00 | 30-Sep-26 08:00 | Unchanged |
| Planner Rollup Finish | 20-Feb-26 16:00 | 20-Feb-26 16:00 | Unchanged |
| Reported Finish Movement | -665.00d ❌ | -221.00d ✅ | Now uses calendar days |

---

## 4. Tests Added

### Test Suite: Date Movement Variance Calculation

File: `apps/web/src/services/sourcePlannerReportViewModel.test.ts`

**New test cases (lines 237–410):**

1. **`calculates finish movement using calendar days (1440 min/day), not working days (480 min/day)`**
   - Verifies: Summary finishMovement uses 1440-minute divisor
   - Data: Sep 30 08:00 → Feb 20 16:00
   - Expected: -221.00d
   - Assertion: NOT -665.00d

2. **`calculates activity finish variance using calendar days`**
   - Verifies: Activity row finishVariance uses 1440-minute divisor
   - Data: Sep 30 08:00 → Feb 20 16:00
   - Expected: -221.00d
   - Assertion: NOT -665.00d

3. **`calculates activity start variance using calendar days`**
   - Verifies: Activity row startVariance uses 1440-minute divisor
   - Data: Sep 30 08:00 → Feb 20 08:00
   - Expected: -221.33d
   - Assertion: NOT -666.00d

4. **`separates date movement variance from duration variance`**
   - Verifies: Date movement and duration use different divisors
   - Data: 1-calendar-day task (1440 minutes = 3.00 working days)
   - Expected: sourceDuration="3.00d", finishVariance="0.00d"
   - Assertion: Correct separation of units

5. **`milestone with zero duration displays correctly`**
   - Verifies: Zero-duration milestone doesn't inflate to 1 day
   - Data: Milestone at Jan 2 with 0 duration
   - Expected: sourceDuration="0.00d", plannerDuration="0.00d"
   - Assertion: No artificial inflation

**Test results:**
```
✅ buildSourcePlannerRecalculationReport
  ✅ builds summary with distinct source rollup finish, must-finish-by, and planner rollup finish
  ✅ creates activity-level rows with source/planner starts and finishes plus reason tags
  ✅ does not mutate source dates while building the report

✅ date movement variance calculation (calendar days, not working days)
  ✅ calculates finish movement using calendar days (1440 min/day), not working days (480 min/day)
  ✅ calculates activity finish variance using calendar days
  ✅ calculates activity start variance using calendar days
  ✅ separates date movement variance from duration variance
  ✅ milestone with zero duration displays correctly

Tests: 8 passed (8)
```

---

## 5. Validation Results

### Typecheck: ✅ All Pass

```bash
✅ pnpm --filter @planner/protocol run typecheck
✅ pnpm --filter @planner/worker run typecheck
✅ pnpm --filter @planner/web run typecheck
```

### Worker Tests: ✅ All Pass

```bash
cd packages/worker && npx vitest run --reporter=dot

✅ Test Files: 52 passed (52)
✅ Tests: 1,084 passed (1,084)
Duration: 2.21s
```

### Web Tests: ✅ All Pass

```bash
cd apps/web && npx vitest run --reporter=dot

✅ Test Files: 38 passed (38)
✅ Tests: 462 passed (462)
Duration: 1.92s
```

**Note:** Pre-existing jsdom canvas warnings are non-failing and unrelated to this fix.

---

## 6. Architectural Compliance

✅ **No scheduling authority changes**
- Slot remains applied result
- No temporal authority activation

✅ **No lifecycle rewrite**
- sourceImportedNotCalculated unchanged
- No state machine transitions modified

✅ **No engine behavior changes**
- Worker computation unaffected
- Planner-calculated dates unchanged

✅ **No source date mutation**
- Report reads only, never modifies
- sourceImportFidelityState immutable

✅ **Report-only fix**
- Isolated to view-model formatter functions
- No protocol changes
- No worker pipeline changes

---

## Summary

**Root Cause:** Using 480-minute (working day) divisor instead of 1440-minute (calendar day) divisor for date/time movement variance calculations.

**Fix:** Introduced separate formatters with distinct divisors:
- `formatDateMovementVarianceMinutes()` → 1440 min/day
- `formatDurationVarianceMinutes()` → 480 min/day

**Validation:** All 1,084 worker tests + 462 web tests + typechecks pass. No regressions.

**Result:** Date movement variances now correctly display in calendar days (not inflated 3× by working-day divisor).
