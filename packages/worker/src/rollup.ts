import type { ScheduleResultMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import { countWorkingDays } from "./calendar.js";
import type { CompiledCalendar } from "./calendarRegistry.js";
import { countWorkingMinutesBetween, daySlotToProjectInstant } from "./workingTimeEngine.js";

/**
 * Calendar context for output-side calendar-aware duration translation.
 *
 * When provided to computeRollups, summary and leaf duration are computed
 * via WorkingTimeEngine (interval-level precision) rather than scalar
 * countWorkingDays × minutesPerDay.
 *
 * Track A Step 6b-2: only project calendar is used. Task calendars
 * are not active in this path yet.
 */
export type CalendarOutputContext = {
  readonly calendar: CompiledCalendar;
  readonly projectStartDate: string;
};

/**
 * Compute rollup fields on full projection rows (pre-collapse).
 *
 * - Leaf tasks: rollupStart = earlyStart, rollupFinish = earlyFinish,
 *              duration = (kernelFinish − kernelStart) × minutesPerDay
 * - Summary tasks: rollupStart = min(child rollupStart), rollupFinish = max(child rollupFinish),
 *                  duration = countWorkingDays(startSlot, finishSlot) × minutesPerDay
 * - null if no schedule data available
 *
 * Summary duration uses the working calendar so weekends/holidays are excluded,
 * matching the unit leaf tasks already use (working minutes, not elapsed time).
 * countWorkingDays() operates on day-offset indices (schedule result values),
 * not raw minute offsets.
 *
 * Operates bottom-up (deepest first) so nested summaries propagate correctly.
 * Must receive the FULL projection (all rows, not visibility-filtered) so that
 * collapsed descendants contribute to their parent summary rollups.
 * Returns a new array — row objects are reused when rollup values are unchanged.
 *
 * D6a: minutesPerDay is a required plain number. This function no longer
 * depends on KernelTemporalAdapter or MINUTES_PER_DAY — the caller
 * (worker.ts) extracts the value from calendar services. The conversion
 * math is output-side (day-offset ↔ WorkMinutes), not input translation.
 *
 * Track A Step 6b-2: when calendarContext is provided, summary and leaf
 * duration use daySlotToProjectInstant + countWorkingMinutesBetween for
 * interval-level precision. Start/finish remain scalar (daySlot × minutesPerDay)
 * for Gantt bar positioning. When calendarContext is absent, the existing
 * scalar path (countWorkingDays × minutesPerDay) runs unchanged.
 */
export function computeRollups(
  fullProjection: readonly VisibleRow[],
  scheduleResults: ScheduleResultMap,
  nonWorkingDays: ReadonlySet<number> = new Set(),
  minutesPerDay: number = 480,
  calendarContext?: CalendarOutputContext,
): VisibleRow[] {
  // Build parent → direct children
  const childrenOf = new Map<string, VisibleRow[]>();
  for (const row of fullProjection) {
    if (row.parentId) {
      const arr = childrenOf.get(row.parentId);
      if (arr) arr.push(row);
      else childrenOf.set(row.parentId, [row]);
    }
  }

  // Process deepest first — sort by depth descending
  const sorted = fullProjection.slice().sort((a, b) => b.depth - a.depth);

  // Temp map for computed rollup values (before we stamp them onto rows)
  const rollupValues = new Map<string, {
    start: WorkMinutes | null;
    finish: WorkMinutes | null;
    duration: WorkMinutes | null;
  }>();

  for (const row of sorted) {
    if (row.isSummary) {
      // Aggregate from children (which may themselves be summaries already computed)
      const children = childrenOf.get(row.id);
      if (!children || children.length === 0) {
        rollupValues.set(row.id, { start: null, finish: null, duration: null });
        continue;
      }

      let minStart = Infinity;
      let maxFinish = -Infinity;

      for (const child of children) {
        const childRollup = rollupValues.get(child.id);
        if (childRollup) {
          if (childRollup.start !== null && childRollup.start < minStart) minStart = childRollup.start;
          if (childRollup.finish !== null && childRollup.finish > maxFinish) maxFinish = childRollup.finish;
        }
      }

      if (!Number.isFinite(minStart) || !Number.isFinite(maxFinish)) {
        rollupValues.set(row.id, { start: null, finish: null, duration: null });
      } else {
        // Convert WorkMinutes → day-offsets for duration computation.
        const startSlot = minStart / minutesPerDay;
        const finishSlot = maxFinish / minutesPerDay;

        let duration: WorkMinutes;
        if (calendarContext) {
          // Track A Step 6b-2: calendar-aware summary duration via WorkingTimeEngine.
          const startInstant = daySlotToProjectInstant(calendarContext.projectStartDate, startSlot, calendarContext.calendar);
          const finishInstant = daySlotToProjectInstant(calendarContext.projectStartDate, finishSlot, calendarContext.calendar);
          duration = countWorkingMinutesBetween(calendarContext.calendar, startInstant, finishInstant) as WorkMinutes;
        } else {
          // Scalar fallback: countWorkingDays × minutesPerDay (D6a path).
          const workingDays = countWorkingDays(startSlot, finishSlot, nonWorkingDays);
          duration = (workingDays * minutesPerDay) as WorkMinutes;
        }

        rollupValues.set(row.id, {
          start: minStart as WorkMinutes,
          finish: maxFinish as WorkMinutes,
          duration,
        });
      }
    } else {
      // Leaf task — read from scheduleResults.
      // Schedule results are in day-offset units. Convert back to WorkMinutes
      // for rollup fields so the UI can display them correctly.
      const entry = scheduleResults[row.id];
      if (
        entry &&
        Number.isFinite(entry.earlyStartMinutes) &&
        Number.isFinite(entry.earlyFinishMinutes)
      ) {
        const start = (entry.earlyStartMinutes * minutesPerDay) as WorkMinutes;
        const finish = (entry.earlyFinishMinutes * minutesPerDay) as WorkMinutes;

        let duration: WorkMinutes;
        if (calendarContext) {
          // Track A Step 6b-2: calendar-aware leaf duration via WorkingTimeEngine.
          const startInstant = daySlotToProjectInstant(calendarContext.projectStartDate, entry.earlyStartMinutes as number, calendarContext.calendar);
          const finishInstant = daySlotToProjectInstant(calendarContext.projectStartDate, entry.earlyFinishMinutes as number, calendarContext.calendar);
          duration = countWorkingMinutesBetween(calendarContext.calendar, startInstant, finishInstant) as WorkMinutes;
        } else {
          // Scalar fallback: (finish − start) × minutesPerDay (D6a path).
          duration = ((entry.earlyFinishMinutes - entry.earlyStartMinutes) * minutesPerDay) as WorkMinutes;
        }

        rollupValues.set(row.id, { start, finish, duration });
      } else {
        rollupValues.set(row.id, { start: null, finish: null, duration: null });
      }
    }
  }

  // Stamp rollup values onto rows, preserving reference equality when unchanged
  const result: VisibleRow[] = [];
  for (const row of fullProjection) {
    const rv = rollupValues.get(row.id)!;
    if (
      row.rollupStartMinutes === rv.start &&
      row.rollupFinishMinutes === rv.finish &&
      row.rollupDurationMinutes === rv.duration
    ) {
      result.push(row);
    } else {
      result.push({
        ...row,
        rollupStartMinutes: rv.start,
        rollupFinishMinutes: rv.finish,
        rollupDurationMinutes: rv.duration,
      });
    }
  }

  return result;
}
