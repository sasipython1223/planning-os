/**
 * Calendar module — generates non-working-day integer offsets
 * and provides working-day counting utilities.
 *
 * The Worker owns calendar config; the Rust kernel stays date-blind
 * and only receives blocked integer offsets.
 */

/**
 * Generate integer day-offsets that fall on weekends (Saturday=6, Sunday=0)
 * relative to a project start date.
 *
 * @param projectStartDate ISO date string (YYYY-MM-DD)
 * @param excludeWeekends  whether weekends are non-working
 * @param horizon          number of calendar days to scan
 * @returns sorted array of blocked day-offsets
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
