import type { MinuteCanaryEnablementDecision } from "./CutoverReadinessGate.js";
import type { EngineResult } from "./ISchedulingEngine.js";

export type D10eAuthorityExecutionRoute = "slot" | "minute";
export type D10eAuthorityRoutingReason =
  | "cohort_not_eligible"
  | "minute_executed"
  | "minute_engine_error"
  | "minute_normalized_missing"
  | "runtime_not_observed";

export type D10eAuthorityRoutingDecision = {
  readonly route: D10eAuthorityExecutionRoute;
  readonly canaryEligible: boolean;
  readonly fallbackReason: string | null;
  readonly reason: D10eAuthorityRoutingReason;
  readonly ineligibilityBlockers: MinuteCanaryEnablementDecision["blockers"];
};

const hasEngineError = (result: EngineResult): string | null => {
  if ("type" in result.rawResult && typeof result.rawResult.type === "string") {
    return result.rawResult.type;
  }
  return null;
};

export const decideD10eAuthorityRouting = (
  minuteCanaryEnablement: MinuteCanaryEnablementDecision,
  minuteEngineResult: EngineResult,
): D10eAuthorityRoutingDecision => {
  if (!minuteCanaryEnablement.canEnableMinuteAuthorityForCohort) {
    return {
      route: "slot",
      canaryEligible: false,
      fallbackReason: null,
      reason: "cohort_not_eligible",
      ineligibilityBlockers: minuteCanaryEnablement.blockers,
    };
  }

  const engineErrorType = hasEngineError(minuteEngineResult);
  if (engineErrorType) {
    return {
      route: "slot",
      canaryEligible: true,
      fallbackReason: `minute_engine_error:${engineErrorType}`,
      reason: "minute_engine_error",
      ineligibilityBlockers: [],
    };
  }

  if (minuteEngineResult.normalized == null) {
    return {
      route: "slot",
      canaryEligible: true,
      fallbackReason: "minute_normalized_missing",
      reason: "minute_normalized_missing",
      ineligibilityBlockers: [],
    };
  }

  return {
    route: "minute",
    canaryEligible: true,
    fallbackReason: null,
    reason: "minute_executed",
    ineligibilityBlockers: [],
  };
};