import { describe, expect, it } from "vitest";
import type {
    MinuteCanaryEnablementDecision,
} from "../../src/schedule/CutoverReadinessGate.js";
import { decideD10eAuthorityRouting } from "../../src/schedule/D10eAuthorityRouting.js";
import type { EngineResult } from "../../src/schedule/ISchedulingEngine.js";

const makeMinuteCanaryEnablement = (
  overrides: Partial<MinuteCanaryEnablementDecision> = {},
): MinuteCanaryEnablementDecision => ({
  requestedMode: "minute",
  ring: "off",
  subjectCohortId: null,
  canaryEnablementFlag: false,
  authorityFlipEligible: false,
  rolloutEligible: false,
  rehearsalsPassed: false,
  effectiveMode: "slot",
  canEnableMinuteAuthorityForCohort: false,
  blockers: [
    "canary_enablement_flag_off",
    "authority_flip_gate_blocked",
    "rollout_control_blocked",
    "rehearsal_verification_not_passed",
  ],
  ...overrides,
});

const makeMinuteSuccessResult = (): EngineResult => ({
  rawResult: {
    scheduleVersion: 1,
    results: [],
  } as any,
  normalized: {
    T1: {
      taskId: "T1",
      earlyStartDate: 0,
      earlyFinishDate: 0,
      lateStartDate: 0,
      lateFinishDate: 0,
      totalFloatMinutes: 0,
      freeFloatMinutes: 0,
      isCritical: false,
    },
  },
});

describe("D10e authority routing", () => {
  it("keeps slot authority when canary is not eligible", () => {
    const decision = decideD10eAuthorityRouting(
      makeMinuteCanaryEnablement({ canEnableMinuteAuthorityForCohort: false }),
      makeMinuteSuccessResult(),
    );

    expect(decision.route).toBe("slot");
    expect(decision.canaryEligible).toBe(false);
    expect(decision.fallbackReason).toBeNull();
    expect(decision.reason).toBe("cohort_not_eligible");
    expect(decision.ineligibilityBlockers).toEqual([
      "canary_enablement_flag_off",
      "authority_flip_gate_blocked",
      "rollout_control_blocked",
      "rehearsal_verification_not_passed",
    ]);
  });

  it("routes to minute authority when canary is eligible and minute result is healthy", () => {
    const decision = decideD10eAuthorityRouting(
      makeMinuteCanaryEnablement({
        canEnableMinuteAuthorityForCohort: true,
        canaryEnablementFlag: true,
        authorityFlipEligible: true,
        rolloutEligible: true,
        rehearsalsPassed: true,
        effectiveMode: "minute",
        blockers: [],
      }),
      makeMinuteSuccessResult(),
    );

    expect(decision.route).toBe("minute");
    expect(decision.canaryEligible).toBe(true);
    expect(decision.fallbackReason).toBeNull();
    expect(decision.reason).toBe("minute_executed");
    expect(decision.ineligibilityBlockers).toEqual([]);
  });

  it("falls back to slot when minute execution returns an engine error", () => {
    const decision = decideD10eAuthorityRouting(
      makeMinuteCanaryEnablement({
        canEnableMinuteAuthorityForCohort: true,
        canaryEnablementFlag: true,
        authorityFlipEligible: true,
        rolloutEligible: true,
        rehearsalsPassed: true,
        effectiveMode: "minute",
        blockers: [],
      }),
      {
        rawResult: {
          type: "ShadowExecutionFailed",
          message: "minute wasm error",
        } as any,
        normalized: null,
      },
    );

    expect(decision.route).toBe("slot");
    expect(decision.canaryEligible).toBe(true);
    expect(decision.fallbackReason).toBe("minute_engine_error:ShadowExecutionFailed");
    expect(decision.reason).toBe("minute_engine_error");
    expect(decision.ineligibilityBlockers).toEqual([]);
  });

  it("falls back to slot when minute execution has no normalized facts", () => {
    const decision = decideD10eAuthorityRouting(
      makeMinuteCanaryEnablement({
        canEnableMinuteAuthorityForCohort: true,
        canaryEnablementFlag: true,
        authorityFlipEligible: true,
        rolloutEligible: true,
        rehearsalsPassed: true,
        effectiveMode: "minute",
        blockers: [],
      }),
      {
        rawResult: {
          scheduleVersion: 1,
          results: [],
        } as any,
        normalized: null,
      },
    );

    expect(decision.route).toBe("slot");
    expect(decision.canaryEligible).toBe(true);
    expect(decision.fallbackReason).toBe("minute_normalized_missing");
    expect(decision.reason).toBe("minute_normalized_missing");
    expect(decision.ineligibilityBlockers).toEqual([]);
  });
});