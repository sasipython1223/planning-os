import type { ScheduleResultMap, TemporalCandidateTaskResult, WorkMinutes } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compareSlotVsTemporalCandidate } from "../../src/schedule/TemporalCandidateComparator.js";

const wm = (value: number): WorkMinutes => value as WorkMinutes;

const slot = (overrides?: Partial<ScheduleResultMap[string]>): ScheduleResultMap[string] => ({
  earlyStartMinutes: wm(0),
  earlyFinishMinutes: wm(5),
  lateStartMinutes: wm(0),
  lateFinishMinutes: wm(5),
  totalFloatMinutes: wm(0),
  isCritical: true,
  ...overrides,
});

const temporal = (taskId: string, overrides?: Partial<TemporalCandidateTaskResult>): TemporalCandidateTaskResult => ({
  taskId,
  earlyStart: wm(0),
  earlyFinish: wm(5),
  lateStart: wm(0),
  lateFinish: wm(5),
  totalFloat: wm(0),
  freeFloat: wm(0),
  critical: true,
  calendarIdUsed: null,
  ...overrides,
});

describe("W5B-B2.4C slot vs temporal candidate comparison", () => {
  it("classifies identical tasks as no_difference", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot(),
      },
      candidateTasks: [temporal("A")],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });

    expect(result.summary.comparedTaskCount).toBe(1);
    expect(result.summary.identicalTaskCount).toBe(1);
    expect(result.summary.unexplainedDivergenceCount).toBe(0);
    expect(result.summary.taskComparisons[0]?.classification).toBe("no_difference");
  });

  it("classifies expected calendar divergence when task id is expected", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot({ earlyStartMinutes: wm(0) }),
      },
      candidateTasks: [temporal("A", { earlyStart: wm(2) })],
      expectedCalendarDivergenceTaskIds: ["A"],
      unsupportedFeatureFlags: [],
    });

    expect(result.summary.expectedCalendarDivergenceCount).toBe(1);
    expect(result.summary.unexplainedDivergenceCount).toBe(0);
    expect(result.summary.taskComparisons[0]?.classification).toBe("expected_calendar_related_divergence");
  });

  it("classifies unsupported feature divergence when unsupported flags exist", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot({ earlyFinishMinutes: wm(5) }),
      },
      candidateTasks: [temporal("A", { earlyFinish: wm(9) })],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: ["lag_calendar_mode_not_supported"],
    });

    expect(result.summary.unsupportedFeatureDivergenceCount).toBe(1);
    expect(result.summary.unexplainedDivergenceCount).toBe(0);
    expect(result.summary.taskComparisons[0]?.classification).toBe("unsupported_feature_divergence");
  });

  it("classifies unexplained divergence when no expected attribution exists", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot({ totalFloatMinutes: wm(0) }),
      },
      candidateTasks: [temporal("A", { totalFloat: wm(4) })],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });

    expect(result.summary.unexplainedDivergenceCount).toBe(1);
    expect(result.summary.expectedCalendarDivergenceCount).toBe(0);
    expect(result.summary.unsupportedFeatureDivergenceCount).toBe(0);
    expect(result.summary.taskComparisons[0]?.classification).toBe("unexplained_divergence");
  });

  it("handles missing slot or temporal task safely", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot(),
      },
      candidateTasks: [temporal("B")],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });

    expect(result.summary.comparedTaskCount).toBe(0);
    expect(result.summary.taskComparisons).toHaveLength(0);
    expect(result.unexplainedTaskIds.sort()).toEqual(["A", "B"]);
  });

  // W5B-B2.6.2B: summary critical-flag-only divergences
  describe("W5B-B2.6.2B summary critical-flag-only divergence reclassification", () => {
    it("reclassifies summary row critical-flag-only divergence as expected_summary_critical_rollup_divergence", () => {
      const result = compareSlotVsTemporalCandidate({
        slotResults: {
          // Summary: dates/float identical, slot rollup says critical=false
          // (no critical children); kernel says critical=true (its own
          // total_float<=0 rule on the summary row).
          S: slot({ isCritical: false }),
        },
        candidateTasks: [temporal("S", { critical: true })],
        expectedCalendarDivergenceTaskIds: [],
        unsupportedFeatureFlags: [],
        summaryTaskIds: ["S"],
      });

      expect(result.summary.expectedSummaryCriticalRollupDivergenceCount).toBe(1);
      expect(result.summary.unexplainedDivergenceCount).toBe(0);
      expect(result.summary.criticalFlagVarianceCount).toBe(1);
      expect(result.summary.taskComparisons[0]?.classification).toBe(
        "expected_summary_critical_rollup_divergence",
      );
    });

    it("keeps leaf critical-flag-only divergence classified as unexplained_divergence (apply must remain blocked)", () => {
      const result = compareSlotVsTemporalCandidate({
        slotResults: {
          L: slot({ isCritical: false }),
        },
        candidateTasks: [temporal("L", { critical: true })],
        expectedCalendarDivergenceTaskIds: [],
        unsupportedFeatureFlags: [],
        summaryTaskIds: [], // L is a leaf
      });

      expect(result.summary.unexplainedDivergenceCount).toBe(1);
      expect(result.summary.expectedSummaryCriticalRollupDivergenceCount).toBe(0);
      expect(result.summary.criticalFlagVarianceCount).toBe(1);
      expect(result.summary.taskComparisons[0]?.classification).toBe("unexplained_divergence");
    });

    it("does NOT reclassify when summary row also has date or float divergence", () => {
      const result = compareSlotVsTemporalCandidate({
        slotResults: {
          S: slot({ isCritical: false, earlyStartMinutes: wm(0) }),
        },
        candidateTasks: [
          temporal("S", { critical: true, earlyStart: wm(2) }),
        ],
        expectedCalendarDivergenceTaskIds: [],
        unsupportedFeatureFlags: [],
        summaryTaskIds: ["S"],
      });

      expect(result.summary.expectedSummaryCriticalRollupDivergenceCount).toBe(0);
      expect(result.summary.unexplainedDivergenceCount).toBe(1);
      expect(result.summary.taskComparisons[0]?.classification).toBe("unexplained_divergence");
    });

    it("AI002 shape: 9 summary rows with critical-flag-only divergence are zero unexplained", () => {
      const slotResults: ScheduleResultMap = {};
      const candidateTasks: TemporalCandidateTaskResult[] = [];
      const summaryIds: string[] = [];
      // 9 summaries: dates/float identical, criticals disagree (any direction).
      for (let i = 0; i < 9; i += 1) {
        const id = `S${i}`;
        summaryIds.push(id);
        const slotCritical = i % 2 === 0;
        slotResults[id] = slot({ isCritical: slotCritical });
        candidateTasks.push(temporal(id, { critical: !slotCritical }));
      }
      // Plus 78 identical leaves.
      for (let i = 0; i < 78; i += 1) {
        const id = `L${i}`;
        slotResults[id] = slot();
        candidateTasks.push(temporal(id));
      }

      const result = compareSlotVsTemporalCandidate({
        slotResults,
        candidateTasks,
        expectedCalendarDivergenceTaskIds: [],
        unsupportedFeatureFlags: [],
        summaryTaskIds: summaryIds,
      });

      expect(result.summary.comparedTaskCount).toBe(87);
      expect(result.summary.identicalTaskCount).toBe(78);
      expect(result.summary.expectedSummaryCriticalRollupDivergenceCount).toBe(9);
      expect(result.summary.unexplainedDivergenceCount).toBe(0);
      expect(result.summary.criticalFlagVarianceCount).toBe(9);
      expect(result.summary.maxAbsStartVarianceMinutes as number).toBe(0);
      expect(result.summary.maxAbsFinishVarianceMinutes as number).toBe(0);
      expect(result.summary.maxAbsTotalFloatVarianceMinutes as number).toBe(0);
    });
  });
});
