/**
 * @module ScheduleAuthorityPolicyGate
 *
 * B2.2 integration layer — bridges CutoverReadinessGate (environment eligibility)
 * with TemporalAuthorityRoutingScaffold (run-level policy decision).
 *
 * This module decides whether a scheduling run should even ATTEMPT temporal
 * authority based on policy gates and readiness evidence.
 *
 * Decision layers:
 * 1. CutoverReadinessGate: Is this environment/cohort enabled for minute authority?
 * 2. ScheduleAuthorityPolicyGate (here): Given enabled environment, is THIS run ready?
 * 3. D10eAuthorityRouting: Given temporal executed, should we apply results?
 *
 * B2.2 invariant: This layer produces DIAGNOSTICS ONLY. Applied results are always slot.
 */

import type { ShadowComparisonReadinessReport } from "./ScheduleComparator.js";
import {
    decideScheduleAuthorityRoute,
    type ScheduleAuthorityDecision,
    type TemporalAuthorityRoutingInput
} from "./TemporalAuthorityRoutingScaffold.js";

/**
 * Build a TemporalAuthorityRoutingInput from current scheduling state and
 * shadow comparison results.
 *
 * Integrates evidence from the slot execution and shadow comparison to
 * populate the policy gate's decision context.
 *
 * B2.2: This is called BEFORE temporal engine execution in some cases,
 * and AFTER shadow comparison in others. Callers decide when to invoke.
 */
export function buildTemporalAuthorityRoutingInput(opts: {
  readonly shadowComparisonReport?: ShadowComparisonReadinessReport | null;
  readonly temporalShadowExecutionEnabled: boolean;
  readonly temporalAuthorityRoutingEnabled: boolean;
  readonly temporalAuthorityRolloutRing: "off" | "internal_test" | "dogfood" | "uat" | "production";
  readonly temporalAuthorityEmergencyRollback: boolean;
  readonly unsupportedCalendarFeatureFlags?: readonly string[];
  readonly unsupportedDependencyOrLagModeDetected?: boolean;
  readonly sourceProtectionStatus?: "ok" | "violated" | "unknown" | "blocked" | "not_evaluated_wasm_unavailable";
  readonly performanceThresholdPassed?: boolean;
  readonly realWasmValidationPassed?: boolean;
  readonly allowTemporalAuthorityInTests?: boolean;
  readonly projectEligibilityProfile?: string;
}): TemporalAuthorityRoutingInput {
  const readiness = opts.shadowComparisonReport
    ? {
        hasUnexplainedDivergences: opts.shadowComparisonReport.hasUnexplainedDivergences,
        tasksCompared: opts.shadowComparisonReport.tasksCompared,
        unexplainedDivergenceTaskIds: opts.shadowComparisonReport.unexplainedDivergenceTaskIds,
        maxStartVarianceMs: opts.shadowComparisonReport.maxStartVarianceMs,
        maxFinishVarianceMs: opts.shadowComparisonReport.maxFinishVarianceMs,
        maxFloatVarianceMs: 0, // shadow comparison doesn't track float variance yet
      }
    : null;

  return {
    config: {
      temporalAuthorityRoutingEnabled: opts.temporalAuthorityRoutingEnabled,
      temporalAuthorityRolloutRing: opts.temporalAuthorityRolloutRing,
      temporalAuthorityEmergencyRollback: opts.temporalAuthorityEmergencyRollback,
      temporalShadowExecutionEnabled: opts.temporalShadowExecutionEnabled,
      allowTemporalAuthorityInTests: opts.allowTemporalAuthorityInTests ?? false,
    },
    readinessReport: readiness,
    unsupportedCalendarFeatureFlags: opts.unsupportedCalendarFeatureFlags ?? [],
    unsupportedDependencyOrLagModeDetected: opts.unsupportedDependencyOrLagModeDetected ?? false,
    sourceProtectionStatus: opts.sourceProtectionStatus ?? "ok",
    performanceThresholdPassed: opts.performanceThresholdPassed ?? true,
    realWasmValidationPassed: opts.realWasmValidationPassed ?? false,
    placeholderGatePassed: true,
    projectEligibilityProfile: opts.projectEligibilityProfile ?? "default_supported",
    temporalRunId: null,
    shadowReadinessReportId: null,
  };
}

/**
 * Make a policy gate decision for the given input.
 *
 * This is a thin wrapper over the B2.1 scaffold decision function,
 * exported for use in the worker and tests.
 *
 * B2.2 constraint: even if decision.mode === "temporal_authoritative",
 * the worker MUST NOT apply it. Only slot results are applied to
 * canonical state in B2.2. The decision is diagnostics-only.
 */
export function decideScheduleAuthorityPolicy(
  input: TemporalAuthorityRoutingInput,
): ScheduleAuthorityDecision {
  return decideScheduleAuthorityRoute(input);
}

/**
 * Check whether a policy decision indicates temporal authority was a candidate.
 *
 * Used for diagnostic filtering in worker output.
 */
export function wasTemporalAuthorityCandidate(decision: ScheduleAuthorityDecision): boolean {
  return decision.temporalAuthorityCandidate;
}

// Re-export key types for convenience
export type { ScheduleAuthorityDecision } from "./TemporalAuthorityRoutingScaffold.js";
