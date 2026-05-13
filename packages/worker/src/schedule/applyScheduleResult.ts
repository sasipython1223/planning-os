/**
 * @deprecated Phase D4. Superseded by SlotScheduleTranslator + ProjectionAdapter.
 *
 * The worker's authoritative path now uses:
 *   SlotScheduleTranslator.translate() → NormalizedScheduleFacts
 *   ProjectionAdapter.projectFacts()   → ScheduleResultMap
 *
 * This function is retained only because worker.test.ts backward-compat
 * fixtures still import it. Safe to remove once those fixtures are
 * migrated to the D4 pipeline.
 */
import type { ScheduleResultMap } from "@planner/protocol";
import type { ScheduleResponse } from "@planner/protocol/kernel";

export const applyScheduleResult = (response: ScheduleResponse): ScheduleResultMap => {
  const resultMap: ScheduleResultMap = {};

  for (const result of response.results) {
    resultMap[result.taskId] = {
      earlyStartMinutes: result.earlyStartMinutes,
      earlyFinishMinutes: result.earlyFinishMinutes,
      lateStartMinutes: result.lateStartMinutes,
      lateFinishMinutes: result.lateFinishMinutes,
      totalFloatMinutes: result.totalFloatMinutes,
      isCritical: result.isCritical,
    };
  }

  return resultMap;
};
