import type { ScheduleResultMap, Task } from "protocol";

type ScheduleEntry = ScheduleResultMap[string];

/** A schedule entry is valid if it has finite ES/EF with EF >= ES. */
const isValidScheduled = (entry: ScheduleEntry | undefined): entry is ScheduleEntry =>
  entry !== undefined &&
  Number.isFinite(entry.earlyStart) &&
  Number.isFinite(entry.earlyFinish) &&
  entry.earlyFinish >= entry.earlyStart;

/**
 * Bottom-up rollup of summary schedule fields.
 * Mutates scheduleResults in-place.
 *
 * For each summary task (deepest first):
 *   - Collects direct children's schedule entries
 *   - Sets summary earlyStart = min(valid child earlyStart)
 *   - Sets summary earlyFinish = max(valid child earlyFinish)
 *   - Removes summary from map if no valid children exist
 *
 * Processing deepest-first ensures nested summaries propagate correctly:
 * by the time a shallower summary is processed, its child summaries
 * already have their rolled-up values in scheduleResults.
 */
export const rollupSummarySchedules = (
  tasks: readonly Task[],
  scheduleResults: ScheduleResultMap,
): void => {
  // Build parent → direct children lookup
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId);
      if (arr) arr.push(t.id);
      else childrenOf.set(t.parentId, [t.id]);
    }
  }

  // Collect summaries sorted by depth descending (deepest first)
  const summaries = tasks
    .filter(t => t.isSummary)
    .slice()
    .sort((a, b) => b.depth - a.depth);

  for (const summary of summaries) {
    const childIds = childrenOf.get(summary.id);
    if (!childIds || childIds.length === 0) {
      delete scheduleResults[summary.id];
      continue;
    }

    let minES = Infinity;
    let maxEF = -Infinity;

    for (const childId of childIds) {
      const entry = scheduleResults[childId];
      if (!isValidScheduled(entry)) continue;
      if (entry.earlyStart < minES) minES = entry.earlyStart;
      if (entry.earlyFinish > maxEF) maxEF = entry.earlyFinish;
    }

    if (!Number.isFinite(minES) || !Number.isFinite(maxEF)) {
      delete scheduleResults[summary.id];
    } else {
      scheduleResults[summary.id] = {
        earlyStart: minES,
        earlyFinish: maxEF,
        lateStart: minES,
        lateFinish: maxEF,
        totalFloat: 0,
        isCritical: false,
      };
    }
  }
};
