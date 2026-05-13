/**
 * Calendar module — generates non-working-day integer offsets
 * and provides working-day counting utilities.
 *
 * The Worker owns calendar config; the Rust kernel stays date-blind
 * and only receives blocked integer offsets.
 */

import type { CalendarConfig } from "@planner/protocol";

/**
 * Generate integer day-offsets for all non-working days according to the
 * project calendar configuration: recurring week pattern + holiday exceptions.
 *
 * Phase B: the single computational calendar for the project.
 *
 * @param config           project calendar configuration
 * @param projectStartDate ISO date string (YYYY-MM-DD) for day-offset origin
 * @param horizon          number of calendar days to scan
 * @returns sorted array of blocked day-offsets
 */
export function generateNonWorkingDaysFromConfig(
  config: CalendarConfig,
  projectStartDate: string,
  horizon: number,
): number[] {
  const start = new Date(projectStartDate + "T00:00:00");
  const blocked = new Set<number>();

  // 1. Recurring week pattern
  if (config.workingWeekPattern === "MON_FRI") {
    for (let d = 0; d < horizon; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + d);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) {
        blocked.add(d);
      }
    }
  }
  // ALL_DAYS: no recurring non-working days

  // 2. Holiday exceptions (ISO YYYY-MM-DD strings)
  if (config.holidays && config.holidays.length > 0) {
    const startTime = start.getTime();
    const msPerDay = 86_400_000;
    for (const holiday of config.holidays) {
      const hDate = new Date(holiday + "T00:00:00");
      const offset = Math.round((hDate.getTime() - startTime) / msPerDay);
      if (offset >= 0 && offset < horizon) {
        blocked.add(offset);
      }
    }
  }

  return Array.from(blocked).sort((a, b) => a - b);
}

/**
 * Generate integer day-offsets that fall on weekends (Saturday=6, Sunday=0)
 * relative to a project start date.
 *
 * @deprecated Phase B: use generateNonWorkingDaysFromConfig() instead.
 */
export function generateNonWorkingDays(
  projectStartDate: string,
  excludeWeekends: boolean,
  horizon: number,
): number[] {
  if (!excludeWeekends) return [];

  const start = new Date(projectStartDate + "T00:00:00");
  const blocked: number[] = [];

  for (let d = 0; d < horizon; d++) {
    const date = new Date(start);
    date.setDate(start.getDate() + d);
    const dow = date.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      blocked.push(d);
    }
  }

  return blocked;
}

/**
 * Count working days in the half-open interval [start, end).
 * Used for summary duration rollup.
 *
 * @param start            integer day-offset (inclusive)
 * @param end              integer day-offset (exclusive)
 * @param nonWorkingDaysSet set of blocked day-offsets
 * @returns number of working days in [start, end)
 */
export function countWorkingDays(
  start: number,
  end: number,
  nonWorkingDaysSet: ReadonlySet<number>,
): number {
  let count = 0;
  for (let d = start; d < end; d++) {
    if (!nonWorkingDaysSet.has(d)) count++;
  }
  return count;
}

/**
 * Advance from a start day by `workingDuration` working days,
 * returning the finish day-offset (the first day after the last working day).
 *
 * If start itself is blocked, snaps forward first.
 */
export function advanceByWorkingDays(
  start: number,
  workingDuration: number,
  nonWorkingDaysSet: ReadonlySet<number>,
): number {
  let current = start;
  // Snap start to next working day
  while (nonWorkingDaysSet.has(current)) current++;

  let remaining = workingDuration;
  while (remaining > 0) {
    if (!nonWorkingDaysSet.has(current)) remaining--;
    if (remaining > 0) current++;
    while (nonWorkingDaysSet.has(current)) current++;
  }
  return current;
}

/**
 * Snap a day-slot forward to the next working day.
 * Used for start-oriented constraint snapping (SNET, MSO).
 * If the day-slot is already a working day, returns it unchanged.
 */
export function snapForward(
  daySlot: number,
  nonWorkingDaysSet: ReadonlySet<number>,
): number {
  let d = daySlot;
  while (nonWorkingDaysSet.has(d)) d++;
  return d;
}

/**
 * Snap a day-slot backward to the previous working day.
 * Used for finish-oriented constraint snapping (FNLT, MFO).
 * If the day-slot is already a working day, returns it unchanged.
 */
export function snapBackward(
  daySlot: number,
  nonWorkingDaysSet: ReadonlySet<number>,
): number {
  let d = daySlot;
  while (d >= 0 && nonWorkingDaysSet.has(d)) d--;
  return d;
}
