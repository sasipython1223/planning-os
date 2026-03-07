import type { ScheduleResultMap } from "protocol";
import type { ScheduleResponse } from "protocol/kernel";

/**
 * Convert ScheduleResponse into a patch/state update payload.
 * Returns a ScheduleResultMap for inclusion in DIFF_STATE.
 * Does not mutate global state - pure transformation.
 */

export const applyScheduleResult = (response: ScheduleResponse): ScheduleResultMap => {
  const resultMap: ScheduleResultMap = {};

  for (const result of response.results) {
    resultMap[result.taskId] = {
      earlyStart: result.earlyStart,
      earlyFinish: result.earlyFinish,
      lateStart: result.lateStart,
      lateFinish: result.lateFinish,
      totalFloat: result.totalFloat,
      isCritical: result.isCritical,
    };
  }

  return resultMap;
};
