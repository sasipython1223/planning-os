import { describe, expect, it } from "vitest";
import type { ScheduleResultMap, TemporalCandidateProjection, WorkMinutes } from "../src/index.js";

const wm = (value: number) => value as WorkMinutes;

describe("W5B-B2.4A temporal candidate projection protocol contract", () => {
  it("is modeled separately from authoritative ScheduleResultMap", () => {
    const projection: TemporalCandidateProjection = {
      candidateRunId: "cand-1",
      engine: "temporal",
      calculatedAt: Date.now(),
      performanceMs: null,
      realWasmGateReference: {
        gateReqId: null,
        gateVersion: 1,
        realWasmValidationPassedAtRun: false,
        wasmLoadModeAtRun: "unavailable",
      },
      candidateTasks: [
        {
          taskId: "A",
          earlyStart: wm(0),
          earlyFinish: wm(10),
          lateStart: wm(0),
          lateFinish: wm(10),
          totalFloat: wm(0),
          freeFloat: wm(0),
          critical: true,
          calendarIdUsed: null,
        },
      ],
      candidateSummary: null,
      diagnostics: {
        candidateProjectionAvailable: false,
        candidateProjectionBlockedReason: "candidate_projection_flag_disabled",
        unsupportedFeatureFlags: [],
        temporalExecutionErrors: [],
        unexplainedDivergenceTaskIds: [],
        expectedDivergenceTaskIds: [],
      },
      comparison: null,
    };

    const scheduleResults: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(10),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(10),
        totalFloatMinutes: wm(0),
        isCritical: true,
      },
    };

    expect(projection.candidateTasks.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(projection, "candidateTasks")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(scheduleResults, "candidateTasks")).toBe(false);
  });
});
