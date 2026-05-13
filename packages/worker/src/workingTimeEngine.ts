/**
 * @module workingTimeEngine
 *
 * Track A Steps 4–5 — WorkingTimeEngine.
 *
 * Pure functions for calendar-aware temporal evaluation against a
 * CompiledCalendar (Step 2). Accepts project-local ISO date strings
 * and minute-of-day values. Does not read Worker state directly.
 *
 * Step 4: single-day evaluation + snap-forward.
 * Step 5: multi-day duration traversal (addWorkingMinutes, countWorkingMinutesBetween).
 * Step 6b-1: daySlotToProjectInstant anchor (kernel day-offset → ProjectInstant).
 * Step 6c: live translator/request path uses the project-calendar snapping helpers.
 *
 * Timezone note: all dates are treated as project-local ISO strings
 * (YYYY-MM-DD). No timezone conversion is applied — this matches the
 * convention used throughout Track A calendar definitions. Timezone
 * support is intentionally deferred to a future step.
 */

import type { CompiledCalendar, NormalizedInterval } from "./calendarRegistry.js";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Resolved working-day definition for a specific date.
 * Combines the weekly pattern with exception overrides.
 */
export type WorkingDayDefinition = {
  readonly isWorking: boolean;
  readonly intervals: readonly NormalizedInterval[];
};

/**
 * A project-local date + minute-of-day instant.
 * Used as input/output for temporal evaluation functions.
 */
export type ProjectInstant = {
  /** ISO date string (YYYY-MM-DD). */
  readonly date: string;
  /** Minutes since midnight (0–1440). */
  readonly minuteOfDay: number;
};

// ─── Day Evaluation ─────────────────────────────────────────────────

/**
 * Get the working-day definition for a specific date.
 *
 * Resolution:
 *   1. If exceptionsByDate has an entry for date → use exception intervals.
 *   2. Otherwise → use weekly pattern for the day-of-week.
 *   3. isWorking = intervals.length > 0.
 *
 * @param calendar  Compiled calendar (Step 2).
 * @param date      ISO date string (YYYY-MM-DD), project-local.
 */
export function getWorkingDayDefinition(
  calendar: CompiledCalendar,
  date: string,
): WorkingDayDefinition {
  // Exception override
  const exception = calendar.exceptionsByDate.get(date);
  if (exception !== undefined) {
    return { isWorking: exception.length > 0, intervals: exception };
  }

  // Weekly pattern — derive day-of-week from date
  const dow = parseDow(date);
  const intervals = calendar.weeklyPattern[dow];
  return { isWorking: intervals.length > 0, intervals };
}

// ─── Instant Evaluation ─────────────────────────────────────────────

/**
 * Check whether a project-local instant falls inside a working interval.
 *
 * Returns true if minuteOfDay is within [startMinute, endMinute) of any
 * interval on that date. The interval is half-open: start is inclusive,
 * end is exclusive (an instant at exactly endMinute is outside the interval).
 *
 * @param calendar  Compiled calendar (Step 2).
 * @param instant   Project-local date + minute-of-day.
 */
export function isWorkingInstant(
  calendar: CompiledCalendar,
  instant: ProjectInstant,
): boolean {
  const { intervals } = getWorkingDayDefinition(calendar, instant.date);
  return intervals.some(
    (iv) => instant.minuteOfDay >= iv.startMinute && instant.minuteOfDay < iv.endMinute,
  );
}

// ─── Snap Forward ───────────────────────────────────────────────────

/**
 * Maximum number of calendar days to scan forward when looking for
 * the next working instant. Safety guard against infinite loops
 * with degenerate calendars (e.g. all days non-working).
 */
const MAX_SCAN_DAYS = 365;

/**
 * Snap a project-local instant forward to the nearest working time.
 *
 * Rules:
 *   1. If already inside a working interval → return same instant.
 *   2. If before first interval on a working day → snap to first interval start.
 *   3. If between intervals → snap to next interval start.
 *   4. If after last interval or non-working day → advance to next working day,
 *      snap to first interval start.
 *
 * Returns undefined if no working day is found within MAX_SCAN_DAYS
 * (degenerate calendar with no working time).
 *
 * @param calendar  Compiled calendar (Step 2).
 * @param instant   Project-local date + minute-of-day.
 */
export function snapForwardToWorkingTime(
  calendar: CompiledCalendar,
  instant: ProjectInstant,
): ProjectInstant | undefined {
  let currentDate = instant.date;
  let minuteOfDay = instant.minuteOfDay;

  for (let daysScanned = 0; daysScanned < MAX_SCAN_DAYS; daysScanned++) {
    const day = getWorkingDayDefinition(calendar, currentDate);

    if (day.isWorking) {
      // Check if we can snap within this day's intervals
      for (const iv of day.intervals) {
        if (minuteOfDay < iv.endMinute) {
          // We're before the end of this interval
          return {
            date: currentDate,
            minuteOfDay: Math.max(minuteOfDay, iv.startMinute),
          };
        }
      }
      // Past all intervals on this day — fall through to next day
    }

    // Advance to next calendar day, start at midnight
    currentDate = nextDate(currentDate);
    minuteOfDay = 0;
  }

  // No working day found within scan horizon
  return undefined;
}

/**
 * Snap a project-local date backward to the nearest working day.
 *
 * Returns the same date when it is already working. Otherwise scans
 * backward one calendar day at a time until a working day is found,
 * or undefined if none is found within MAX_SCAN_DAYS.
 */
export function snapBackwardToWorkingDay(
  calendar: CompiledCalendar,
  date: string,
): string | undefined {
  let currentDate = date;

  for (let daysScanned = 0; daysScanned < MAX_SCAN_DAYS; daysScanned++) {
    if (getWorkingDayDefinition(calendar, currentDate).isWorking) {
      return currentDate;
    }
    currentDate = previousDate(currentDate);
  }

  return undefined;
}

// ─── Duration Traversal (Step 5) ────────────────────────────────────

/**
 * Add a non-negative number of working minutes to a start instant.
 *
 * Rules:
 *   1. Snap startInstant forward to working time (if not already).
 *   2. If minutes === 0, return the snapped instant.
 *   3. Consume working minutes interval-by-interval, day-by-day.
 *   4. Return the resulting ProjectInstant.
 *   5. Return undefined if no working time exists within MAX_SCAN_DAYS.
 *
 * Half-open interval semantics: an interval [s, e) contributes (e - s) minutes.
 * The result instant may land at an interval boundary (start or mid-interval).
 *
 * @param calendar  Compiled calendar (Step 2).
 * @param start     Project-local date + minute-of-day.
 * @param minutes   Non-negative working minutes to add.
 */
export function addWorkingMinutes(
  calendar: CompiledCalendar,
  start: ProjectInstant,
  minutes: number,
): ProjectInstant | undefined {
  // Snap to working time first
  const snapped = snapForwardToWorkingTime(calendar, start);
  if (!snapped) return undefined;

  let remaining = minutes;
  let currentDate = snapped.date;
  let minuteOfDay = snapped.minuteOfDay;

  for (let daysScanned = 0; daysScanned < MAX_SCAN_DAYS; daysScanned++) {
    const day = getWorkingDayDefinition(calendar, currentDate);

    if (day.isWorking) {
      for (const iv of day.intervals) {
        // Skip intervals we've already passed
        if (minuteOfDay >= iv.endMinute) continue;

        const effectiveStart = Math.max(minuteOfDay, iv.startMinute);
        const available = iv.endMinute - effectiveStart;

        if (remaining <= available) {
          return { date: currentDate, minuteOfDay: effectiveStart + remaining };
        }

        remaining -= available;
        minuteOfDay = iv.endMinute;
      }
    }

    // Advance to next day
    currentDate = nextDate(currentDate);
    minuteOfDay = 0;
  }

  return undefined;
}

/**
 * Count working minutes in the half-open range [startInstant, endInstant).
 *
 * Rules:
 *   1. If end <= start (by date then minuteOfDay), return 0.
 *   2. Walk day-by-day from start.date to end.date.
 *   3. For each day, sum the overlap of each interval with the active range.
 *   4. Only working intervals contribute; non-working gaps are ignored.
 *
 * Half-open semantics: a minute at exactly endInstant.minuteOfDay on
 * endInstant.date is NOT counted.
 *
 * @param calendar  Compiled calendar (Step 2).
 * @param start     Start of range (inclusive).
 * @param end       End of range (exclusive).
 */
export function countWorkingMinutesBetween(
  calendar: CompiledCalendar,
  start: ProjectInstant,
  end: ProjectInstant,
): number {
  // Quick exit: end <= start
  if (
    end.date < start.date ||
    (end.date === start.date && end.minuteOfDay <= start.minuteOfDay)
  ) {
    return 0;
  }

  let total = 0;
  let currentDate = start.date;

  for (let daysScanned = 0; daysScanned < MAX_SCAN_DAYS; daysScanned++) {
    // Determine the minute range active on this day
    const dayStart = currentDate === start.date ? start.minuteOfDay : 0;
    const dayEnd = currentDate === end.date ? end.minuteOfDay : 1440;

    if (dayStart < dayEnd) {
      const day = getWorkingDayDefinition(calendar, currentDate);
      if (day.isWorking) {
        for (const iv of day.intervals) {
          const overlapStart = Math.max(iv.startMinute, dayStart);
          const overlapEnd = Math.min(iv.endMinute, dayEnd);
          if (overlapStart < overlapEnd) {
            total += overlapEnd - overlapStart;
          }
        }
      }
    }

    // Stop after processing end date
    if (currentDate === end.date) break;

    currentDate = nextDate(currentDate);
  }

  return total;
}

// ─── Day-Slot Anchor (Step 6b-1) ────────────────────────────────────

/**
 * Convert a kernel day-slot offset into a ProjectInstant.
 *
 * The slot kernel operates on integer day-offsets where 0 = project start,
 * 1 = next calendar day, etc. This function bridges kernel output
 * coordinates into the ProjectInstant space consumed by WorkingTimeEngine.
 *
 * The returned instant is anchored at the start of the first working
 * interval on the target date (via the compiled calendar). If the target
 * date is a non-working day, the instant is placed at minute 0 (midnight).
 * Callers that need a working-time instant should pipe the result through
 * snapForwardToWorkingTime().
 *
 * Assumptions (Step 6b-1):
 *   - daySlot is a non-negative integer calendar-day offset.
 *   - projectStartDate is a valid ISO date string (YYYY-MM-DD).
 *   - calendar is the compiled project calendar (uniform-day for now).
 *   - No timezone conversion — project-local dates throughout.
 *
 * Used by output-side calendar-aware translation (Step 6b-2+) and
 * the live slot-translator constraint-date seam (Step 6c).
 *
 * @param projectStartDate  ISO date string (YYYY-MM-DD) for day-offset origin.
 * @param daySlot           Non-negative integer day-offset from kernel output.
 * @param calendar          Compiled project calendar (Step 2).
 * @returns ProjectInstant at the start of the first working interval,
 *          or at minute 0 if the target date is non-working.
 */
export function daySlotToProjectInstant(
  projectStartDate: string,
  daySlot: number,
  calendar: CompiledCalendar,
): ProjectInstant {
  const date = addCalendarDays(projectStartDate, daySlot);
  const dayDef = getWorkingDayDefinition(calendar, date);
  const minuteOfDay = dayDef.isWorking ? dayDef.intervals[0].startMinute : 0;
  return { date, minuteOfDay };
}

/**
 * Convert a project-local ISO date string back to a calendar-day offset.
 *
 * This is the inverse bridge for daySlotToProjectInstant() at day granularity:
 * projectStartDate = 0, next calendar day = 1, etc.
 */
export function projectDateToDaySlot(
  projectStartDate: string,
  date: string,
): number {
  return epochDay(date) - epochDay(projectStartDate);
}

// ─── Date Utilities ─────────────────────────────────────────────────

/**
 * Parse day-of-week (0=Sun..6=Sat) from an ISO date string.
 * Uses UTC to avoid local timezone shifts affecting the day.
 */
function parseDow(date: string): number {
  const d = new Date(date + "T00:00:00Z");
  return d.getUTCDay();
}

/**
 * Advance an ISO date string by one calendar day.
 * Uses UTC arithmetic to avoid DST issues.
 */
function nextDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Retreat an ISO date string by one calendar day.
 * Uses UTC arithmetic to avoid DST issues.
 */
function previousDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Advance an ISO date string by N calendar days.
 * Uses UTC arithmetic to avoid DST issues.
 * N must be a non-negative integer.
 */
function addCalendarDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function epochDay(date: string): number {
  return Math.floor(Date.parse(date + "T00:00:00Z") / 86_400_000);
}
