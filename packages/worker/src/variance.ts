import type { BaselineMap, ScheduleResultMap, VarianceMap, WorkMinutes } from "@planner/protocol";

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
    const liveDuration = live.earlyFinishMinutes - live.earlyStartMinutes;
    const baseDuration = base.finishMinutes - base.startMinutes;
    variances[taskId] = {
      startVarianceMinutes: (live.earlyStartMinutes - base.startMinutes) as WorkMinutes,
      finishVarianceMinutes: (live.earlyFinishMinutes - base.finishMinutes) as WorkMinutes,
      durationVarianceMinutes: (liveDuration - baseDuration) as WorkMinutes,
    };
  }
  return variances;
}
