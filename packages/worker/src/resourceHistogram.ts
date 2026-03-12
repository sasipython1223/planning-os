import type { Assignment, ResourceHistogram, ScheduleResultMap } from "protocol";

/**
 * Compute per-resource per-day loading from assignments and schedule results.
 * Derived data — never stored in state or persisted.
 *
 * earlyFinish is treated as exclusive: a task spanning [0, 5) loads days 0–4.
 * Non-working days are skipped.
 */
export function computeResourceHistogram(
  assignments: Assignment[],
  scheduleResults: ScheduleResultMap,
  nonWorkingDays: ReadonlySet<number>,
): ResourceHistogram {
  const histogram: ResourceHistogram = {};

  for (const a of assignments) {
    const dates = scheduleResults[a.taskId];
    if (!dates) continue;

    const { earlyStart, earlyFinish } = dates;

    for (let day = earlyStart; day < earlyFinish; day++) {
      if (!nonWorkingDays.has(day)) {
        if (!histogram[a.resourceId]) {
          histogram[a.resourceId] = {};
        }
        histogram[a.resourceId][day] = (histogram[a.resourceId][day] || 0) + a.unitsPerDay;
      }
    }
  }

  return histogram;
}
