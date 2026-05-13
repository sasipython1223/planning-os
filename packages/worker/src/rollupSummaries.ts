import type { ScheduleResultMap, Task, WorkMinutes } from "@planner/protocol";

type ScheduleEntry = ScheduleResultMap[string];

/** A schedule entry is valid if it has finite ES/EF with EF >= ES. */
const isValidScheduled = (entry: ScheduleEntry | undefined): entry is ScheduleEntry =>
  entry !== undefined &&
  Number.isFinite(entry.earlyStartMinutes) &&
  Number.isFinite(entry.earlyFinishMinutes) &&
  entry.earlyFinishMinutes >= entry.earlyStartMinutes;

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
  const summaryIds = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) {
      summaryIds.add(t.parentId);
      const arr = childrenOf.get(t.parentId);
      if (arr) arr.push(t.id);
      else childrenOf.set(t.parentId, [t.id]);
    }
  }

  // Derive depth from parentId chain (tasks are in WBS order)
  const depthOf = new Map<string, number>();
  for (const t of tasks) {
    depthOf.set(t.id, t.parentId ? (depthOf.get(t.parentId) ?? 0) + 1 : 0);
  }

  // Collect summaries sorted by depth descending (deepest first)
  const summaries = tasks
    .filter(t => summaryIds.has(t.id))
    .slice()
    .sort((a, b) => (depthOf.get(b.id) ?? 0) - (depthOf.get(a.id) ?? 0));

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
      if (entry.earlyStartMinutes < minES) minES = entry.earlyStartMinutes;
      if (entry.earlyFinishMinutes > maxEF) maxEF = entry.earlyFinishMinutes;
    }

    if (!Number.isFinite(minES) || !Number.isFinite(maxEF)) {
      delete scheduleResults[summary.id];
    } else {
      let hasCriticalChild = false;
      for (const childId of childIds) {
        const entry = scheduleResults[childId];
        if (entry?.isCritical) { hasCriticalChild = true; break; }
      }
      scheduleResults[summary.id] = {
        earlyStartMinutes: minES as WorkMinutes,
        earlyFinishMinutes: maxEF as WorkMinutes,
        lateStartMinutes: minES as WorkMinutes,
        lateFinishMinutes: maxEF as WorkMinutes,
        totalFloatMinutes: 0 as WorkMinutes,
        isCritical: hasCriticalChild,
      };
    }
  }
};
