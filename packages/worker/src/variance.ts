import type { BaselineMap, ScheduleResultMap, VarianceMap } from "protocol";

/**
 * Compute schedule variance metrics by comparing live scheduleResults against baselines.
 * Iterates only over tasks that have a baseline entry; O(1) lookup into scheduleResults.
 */
export function computeVariances(scheduleResults: ScheduleResultMap, baselines: BaselineMap): VarianceMap {
  const variances: VarianceMap = {};
  for (const taskId of Object.keys(baselines)) {
    const live = scheduleResults[taskId];
    if (!live) continue;
    const base = baselines[taskId];
    const liveDuration = live.earlyFinish - live.earlyStart;
    const baseDuration = base.finish - base.start;
    variances[taskId] = {
      startVariance: live.earlyStart - base.start,
      finishVariance: live.earlyFinish - base.finish,
      durationVariance: liveDuration - baseDuration,
    };
  }
  return variances;
}
