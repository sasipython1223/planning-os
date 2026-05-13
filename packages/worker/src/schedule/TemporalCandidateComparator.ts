import type {
    ScheduleResultMap,
    TemporalCandidateDivergenceSummary,
    TemporalCandidateTaskComparison,
    TemporalCandidateTaskDivergenceClass,
    TemporalCandidateTaskResult,
    WorkMinutes,
} from "@planner/protocol";

type SlotTaskResult = ScheduleResultMap[string] & {
  freeFloatMinutes?: WorkMinutes;
};

export type TemporalCandidateComparisonResult = {
  summary: TemporalCandidateDivergenceSummary;
  unexplainedTaskIds: string[];
};

export type TemporalCandidateComparatorInput = {
  slotResults: ScheduleResultMap;
  candidateTasks: readonly TemporalCandidateTaskResult[];
  expectedCalendarDivergenceTaskIds?: readonly string[];
  unsupportedFeatureFlags?: readonly string[];
  /**
   * W5B-B2.6.2B: summary/WBS task ids. When a row's ONLY difference is the
   * critical flag and the row is a summary, classify as
   * `expected_summary_critical_rollup_divergence` (cosmetic — apply discards
   * summary kernel results and recomputes critical via rollup).
   */
  summaryTaskIds?: readonly string[];
};

const toWorkMinutes = (value: number): WorkMinutes => value as WorkMinutes;

const varianceOrNull = (slotValue: WorkMinutes | null | undefined, temporalValue: WorkMinutes | null | undefined): WorkMinutes | null => {
  if (slotValue == null || temporalValue == null) {
    return null;
  }
  return toWorkMinutes((temporalValue as number) - (slotValue as number));
};

const absOrZero = (value: WorkMinutes | null): number =>
  value == null ? 0 : Math.abs(value as number);

const classifyTask = (
  taskId: string,
  hasDifference: boolean,
  isCriticalOnlyDifference: boolean,
  isSummary: boolean,
  expectedTaskIds: ReadonlySet<string>,
  hasUnsupportedFeatureFlags: boolean,
): TemporalCandidateTaskDivergenceClass => {
  if (!hasDifference) {
    return "no_difference";
  }
  if (expectedTaskIds.has(taskId)) {
    return "expected_calendar_related_divergence";
  }
  // W5B-B2.6.2B: summary critical-flag-only divergences are cosmetic — apply
  // recomputes summary critical via rollupSummarySchedules (any-child rule)
  // and discards kernel summary results in the mapper.
  if (isSummary && isCriticalOnlyDifference) {
    return "expected_summary_critical_rollup_divergence";
  }
  if (hasUnsupportedFeatureFlags) {
    return "unsupported_feature_divergence";
  }
  return "unexplained_divergence";
};

const isNonZeroVariance = (value: WorkMinutes | null): boolean =>
  value != null && (value as number) !== 0;

export const compareSlotVsTemporalCandidate = (
  input: TemporalCandidateComparatorInput,
): TemporalCandidateComparisonResult => {
  const expectedTaskIds = new Set(input.expectedCalendarDivergenceTaskIds ?? []);
  const summaryTaskIds = new Set(input.summaryTaskIds ?? []);
  const hasUnsupportedFeatureFlags = (input.unsupportedFeatureFlags?.length ?? 0) > 0;

  const temporalByTaskId = new Map<string, TemporalCandidateTaskResult>();
  for (const task of input.candidateTasks) {
    temporalByTaskId.set(task.taskId, task);
  }

  const slotTaskIds = Object.keys(input.slotResults);
  const comparedTaskIds = slotTaskIds.filter((taskId) => temporalByTaskId.has(taskId));

  const missingInTemporal = slotTaskIds.filter((taskId) => !temporalByTaskId.has(taskId));
  const missingInSlot = [...temporalByTaskId.keys()].filter((taskId) => !(taskId in input.slotResults));

  const taskComparisons: TemporalCandidateTaskComparison[] = [];
  let identicalTaskCount = 0;
  let expectedCalendarDivergenceCount = 0;
  let unsupportedFeatureDivergenceCount = 0;
  let expectedSummaryCriticalRollupDivergenceCount = 0;
  let unexplainedDivergenceCount = 0;
  let criticalFlagVarianceCount = 0;

  let maxAbsStartVarianceMinutes = 0;
  let maxAbsFinishVarianceMinutes = 0;
  let maxAbsTotalFloatVarianceMinutes = 0;

  for (const taskId of comparedTaskIds) {
    const slot = input.slotResults[taskId] as SlotTaskResult;
    const temporal = temporalByTaskId.get(taskId)!;

    const startVarianceMinutes = varianceOrNull(slot.earlyStartMinutes, temporal.earlyStart);
    const finishVarianceMinutes = varianceOrNull(slot.earlyFinishMinutes, temporal.earlyFinish);
    const lateStartVarianceMinutes = varianceOrNull(slot.lateStartMinutes, temporal.lateStart);
    const lateFinishVarianceMinutes = varianceOrNull(slot.lateFinishMinutes, temporal.lateFinish);
    const totalFloatVarianceMinutes = varianceOrNull(slot.totalFloatMinutes, temporal.totalFloat);

    // Slot canonical ScheduleResultMap has no freeFloat; compare only when slot extension exists.
    const freeFloatVarianceMinutes =
      typeof slot.freeFloatMinutes === "number"
        ? varianceOrNull(slot.freeFloatMinutes, temporal.freeFloat)
        : null;

    const criticalVariance = slot.isCritical !== temporal.critical;

    const hasNonCriticalDifference =
      isNonZeroVariance(startVarianceMinutes)
      || isNonZeroVariance(finishVarianceMinutes)
      || isNonZeroVariance(lateStartVarianceMinutes)
      || isNonZeroVariance(lateFinishVarianceMinutes)
      || isNonZeroVariance(totalFloatVarianceMinutes)
      || isNonZeroVariance(freeFloatVarianceMinutes);

    const hasDifference = hasNonCriticalDifference || criticalVariance;
    const isCriticalOnlyDifference = criticalVariance && !hasNonCriticalDifference;

    const classification = classifyTask(
      taskId,
      hasDifference,
      isCriticalOnlyDifference,
      summaryTaskIds.has(taskId),
      expectedTaskIds,
      hasUnsupportedFeatureFlags,
    );

    if (classification === "no_difference") {
      identicalTaskCount += 1;
    } else if (classification === "expected_calendar_related_divergence") {
      expectedCalendarDivergenceCount += 1;
    } else if (classification === "unsupported_feature_divergence") {
      unsupportedFeatureDivergenceCount += 1;
    } else if (classification === "expected_summary_critical_rollup_divergence") {
      expectedSummaryCriticalRollupDivergenceCount += 1;
    } else {
      unexplainedDivergenceCount += 1;
    }

    if (criticalVariance) {
      criticalFlagVarianceCount += 1;
    }

    maxAbsStartVarianceMinutes = Math.max(maxAbsStartVarianceMinutes, absOrZero(startVarianceMinutes));
    maxAbsFinishVarianceMinutes = Math.max(maxAbsFinishVarianceMinutes, absOrZero(finishVarianceMinutes));
    maxAbsTotalFloatVarianceMinutes = Math.max(
      maxAbsTotalFloatVarianceMinutes,
      absOrZero(totalFloatVarianceMinutes),
    );

    taskComparisons.push({
      taskId,
      classification,
      startVarianceMinutes,
      finishVarianceMinutes,
      lateStartVarianceMinutes,
      lateFinishVarianceMinutes,
      totalFloatVarianceMinutes,
      freeFloatVarianceMinutes,
      criticalVariance,
    });
  }

  return {
    summary: {
      comparedTaskCount: comparedTaskIds.length,
      identicalTaskCount,
      expectedCalendarDivergenceCount,
      unsupportedFeatureDivergenceCount,
      expectedSummaryCriticalRollupDivergenceCount,
      unexplainedDivergenceCount,
      criticalFlagVarianceCount,
      maxAbsStartVarianceMinutes: toWorkMinutes(maxAbsStartVarianceMinutes),
      maxAbsFinishVarianceMinutes: toWorkMinutes(maxAbsFinishVarianceMinutes),
      maxAbsTotalFloatVarianceMinutes: toWorkMinutes(maxAbsTotalFloatVarianceMinutes),
      taskComparisons,
    },
    unexplainedTaskIds: [...new Set([...missingInTemporal, ...missingInSlot])],
  };
};
