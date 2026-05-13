import { describe, expect, it } from "vitest";
import { DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS } from "../../src/schedule/CutoverReadinessBenchmark.js";
import type {
    AuthorityFlipGateReport,
    CutoverReadinessDecision,
    CutoverTelemetrySnapshot,
    MinuteCanaryEnablementDecision,
    RehearsalVerificationState,
    RingProgressionApprovalState,
    RolloutControlState,
} from "../../src/schedule/CutoverReadinessGate.js";
import {
    buildCutoverReadinessReport,
    type CutoverReadinessMinuteCanaryExecutionArtifact,
} from "../../src/schedule/CutoverReadinessReport.js";

const makeCutoverDecision = (): CutoverReadinessDecision => ({
  requestedMode: "minute",
  effectiveMode: "slot",
  reason: "kill_switch_forced_slot",
  killSwitchForceSlot: true,
  parityGatePassed: false,
});

const makeTelemetry = (
  overrides: Partial<CutoverTelemetrySnapshot> = {},
): CutoverTelemetrySnapshot => ({
  primaryRuns: 80,
  shadowRuns: 80,
  shadowFailures: 0,
  mismatchCategories: {
    true_regression: 0,
    expected_precision_improvement: 0,
    known_slot_minute_divergence: 0,
    comparator_tolerance_policy_gap: 0,
  },
  primaryP95Ms: 100,
  shadowP95Ms: 110,
  primaryRequestBuildP95Ms: 10,
  primaryEngineExecP95Ms: 60,
  primaryProjectionP95Ms: 14,
  shadowRequestBuildP95Ms: 12,
  shadowEngineExecP95Ms: 75,
  primaryRequestBuildRuns: 80,
  primaryEngineExecRuns: 80,
  primaryProjectionRuns: 80,
  shadowRequestBuildRuns: 80,
  shadowEngineExecRuns: 80,
  ...overrides,
});

const makeAuthorityFlipGate = (): AuthorityFlipGateReport => ({
  requestedMode: "minute",
  killSwitchForceSlot: false,
  parityGatePassed: true,
  readinessBenchmarkPassed: true,
  persistencePurityPassed: true,
  stagingGuardPassed: true,
  eligible: true,
  blockers: [],
});

const makeRolloutControl = (): RolloutControlState => ({
  ring: "internal_dogfood",
  targetingMode: "cohort_allowlist",
  subjectCohortId: "dogfood-a",
  targetedCohorts: ["dogfood-a"],
  cohortMatched: true,
  eligible: true,
  blockers: [],
});

const makeRehearsalVerification = (): RehearsalVerificationState => ({
  killSwitch: {
    result: "passed",
    recordedAt: 100,
    ring: "internal_dogfood",
    notes: "verified in ring 0",
  },
  rollback: {
    result: "passed",
    recordedAt: 200,
    ring: "internal_dogfood",
    notes: "verified in ring 0",
  },
  bothPassed: true,
});

const makeRingProgressionApproval = (): RingProgressionApprovalState => ({
  currentRing: "internal_dogfood",
  approvedRing: "internal_dogfood",
  canProgress: true,
});

const makeMinuteCanaryEnablement = (): MinuteCanaryEnablementDecision => ({
  requestedMode: "minute",
  ring: "internal_dogfood",
  subjectCohortId: "dogfood-a",
  canaryEnablementFlag: true,
  authorityFlipEligible: true,
  rolloutEligible: true,
  rehearsalsPassed: true,
  effectiveMode: "minute",
  canEnableMinuteAuthorityForCohort: true,
  blockers: [],
});

const makeMinuteCanaryExecution = (
  overrides: Partial<CutoverReadinessMinuteCanaryExecutionArtifact> = {},
): CutoverReadinessMinuteCanaryExecutionArtifact => ({
  attemptedMinuteAuthority: true,
  executedRoute: "minute",
  fallbackOccurred: false,
  fallbackReason: null,
  routingReason: "minute_executed",
  ineligibilityBlockers: [],
  persistenceSafetyVerified: true,
  persistencePurityViolationCount: 0,
  ...overrides,
});

describe("D10h ring 0 execution support batch", () => {
  it("surfaces internal dogfood readiness evidence for runbook execution", () => {
    const report = buildCutoverReadinessReport({
      generatedAt: 86_400_100,
      cutoverDecision: makeCutoverDecision(),
      telemetry: makeTelemetry({ primaryRuns: 120 }),
      authorityFlipGate: makeAuthorityFlipGate(),
      rolloutControl: makeRolloutControl(),
      rehearsalVerification: makeRehearsalVerification(),
      ringProgressionApproval: makeRingProgressionApproval(),
      minuteCanaryEnablement: makeMinuteCanaryEnablement(),
      minuteCanaryExecution: makeMinuteCanaryExecution(),
      benchmarkReport: {
        thresholds: DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
        latencyPass: true,
        samplePass: true,
        shadowFailurePass: true,
        overallPass: true,
        shadowFailure: { observed: 0, maxAllowed: 0, pass: true },
        metrics: {
          primary_overall: {
            key: "primary_overall",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          shadow_overall: {
            key: "shadow_overall",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          primary_request_build: {
            key: "primary_request_build",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          primary_engine_exec: {
            key: "primary_engine_exec",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          primary_projection: {
            key: "primary_projection",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          shadow_request_build: {
            key: "shadow_request_build",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
          shadow_engine_exec: {
            key: "shadow_engine_exec",
            baselineP95Ms: 1,
            candidateP95Ms: 1,
            baselineRuns: 30,
            candidateRuns: 30,
            samplePass: true,
            regressionPct: 0,
            budgetPct: 10,
            latencyPass: true,
            pass: true,
          },
        },
        failingChecks: [],
      },
    });

    expect(report.internalDogfoodSupport).toEqual({
      active: true,
      approvedForCurrentRing: true,
      executionEntryReady: true,
      executionEntryBlockers: [],
      benchmarkReportCaptured: true,
      killSwitchEvidenceCaptured: true,
      rollbackEvidenceCaptured: true,
      persistencePurityEvidencePassed: true,
      evidenceBundleComplete: true,
      minimumObservationDurationMsRequired: 86_400_000,
      observedObservationDurationMs: 86_400_000,
      minimumObservationDurationMet: true,
      observedSchedulingRuns: 120,
      minimumSchedulingRunsRequired: 100,
      minimumSchedulingRunsMet: true,
      inRingKillSwitchVerified: true,
      inRingRollbackVerified: true,
      inRingRehearsalsVerified: true,
      lastExecutionRoute: "minute",
      lastRoutingReason: "minute_executed",
      lastFallbackReason: null,
      minuteExecutionObserved: true,
      persistenceSafetyVerified: true,
      persistencePurityViolationCount: 0,
      parityTrueRegressionCount: 0,
      parityClearForReview: true,
      benchmarkPassedForReview: true,
      continuationGateReady: true,
      eligibilityEvidenceCaptured: true,
      fallbackEvidenceCaptured: true,
      reviewReady: true,
      reviewBlockers: [],
    });
  });

  it("captures slot-route evidence for ring 0 cohorts that were not eligible to execute minute", () => {
    const report = buildCutoverReadinessReport({
      generatedAt: 999,
      cutoverDecision: makeCutoverDecision(),
      telemetry: makeTelemetry({ primaryRuns: 20 }),
      authorityFlipGate: makeAuthorityFlipGate(),
      rolloutControl: makeRolloutControl(),
      rehearsalVerification: makeRehearsalVerification(),
      ringProgressionApproval: makeRingProgressionApproval(),
      minuteCanaryEnablement: {
        ...makeMinuteCanaryEnablement(),
        effectiveMode: "slot",
        canEnableMinuteAuthorityForCohort: false,
        blockers: ["rollout_control_blocked", "ring_progression_not_approved"],
      },
    });

    expect(report.minuteCanaryExecution.routingReason).toBe("runtime_not_observed");
    expect(report.minuteCanaryExecution.ineligibilityBlockers).toEqual([
      "rollout_control_blocked",
      "ring_progression_not_approved",
    ]);
    expect(report.operatorSummary.minuteExecutionRoute).toBe("slot");
    expect(report.operatorSummary.minuteRoutingReason).toBe("runtime_not_observed");
    expect(report.internalDogfoodSupport.minimumSchedulingRunsMet).toBe(false);
    expect(report.internalDogfoodSupport.minimumObservationDurationMet).toBe(false);
    expect(report.internalDogfoodSupport.eligibilityEvidenceCaptured).toBe(true);
    expect(report.internalDogfoodSupport.executionEntryReady).toBe(false);
    expect(report.internalDogfoodSupport.executionEntryBlockers).toContain(
      "minute_canary_enablement_not_ready",
    );
    expect(report.internalDogfoodSupport.evidenceBundleComplete).toBe(false);
    expect(report.internalDogfoodSupport.reviewReady).toBe(false);
    expect(report.internalDogfoodSupport.reviewBlockers).toContain("minimum_scheduling_runs_not_met");
    expect(report.internalDogfoodSupport.reviewBlockers).toContain(
      "minimum_observation_duration_not_met",
    );
    expect(report.internalDogfoodSupport.continuationGateReady).toBe(true);
    expect(report.operatorSummary.internalDogfoodExecutionEntryReady).toBe(false);
    expect(report.operatorSummary.internalDogfoodExecutionEntryBlockers).toContain(
      "minute_canary_enablement_not_ready",
    );
    expect(report.operatorSummary.internalDogfoodEvidenceBundleComplete).toBe(false);
    expect(report.operatorSummary.internalDogfoodReviewReady).toBe(false);
    expect(report.operatorSummary.internalDogfoodReviewBlockers).toContain(
      "minute_execution_not_observed",
    );
    expect(report.operatorSummary.internalDogfoodContinuationGateReady).toBe(true);
  });

  it("preserves fallback evidence when ring 0 minute execution falls back to slot", () => {
    const report = buildCutoverReadinessReport({
      generatedAt: 999,
      cutoverDecision: makeCutoverDecision(),
      telemetry: makeTelemetry({ primaryRuns: 140 }),
      authorityFlipGate: makeAuthorityFlipGate(),
      rolloutControl: makeRolloutControl(),
      rehearsalVerification: makeRehearsalVerification(),
      ringProgressionApproval: makeRingProgressionApproval(),
      minuteCanaryEnablement: makeMinuteCanaryEnablement(),
      minuteCanaryExecution: makeMinuteCanaryExecution({
        executedRoute: "slot",
        fallbackOccurred: true,
        fallbackReason: "minute_engine_error:ShadowExecutionFailed",
        routingReason: "minute_engine_error",
      }),
    });

    expect(report.internalDogfoodSupport.lastExecutionRoute).toBe("slot");
    expect(report.internalDogfoodSupport.lastRoutingReason).toBe("minute_engine_error");
    expect(report.internalDogfoodSupport.lastFallbackReason).toBe(
      "minute_engine_error:ShadowExecutionFailed",
    );
    expect(report.internalDogfoodSupport.fallbackEvidenceCaptured).toBe(true);
    expect(report.internalDogfoodSupport.executionEntryReady).toBe(true);
    expect(report.internalDogfoodSupport.reviewReady).toBe(false);
    expect(report.internalDogfoodSupport.reviewBlockers).toContain(
      "minimum_observation_duration_not_met",
    );
    expect(report.operatorSummary.minuteFallbackReason).toBe(
      "minute_engine_error:ShadowExecutionFailed",
    );
    expect(report.operatorSummary.internalDogfoodExecutionEntryReady).toBe(true);
    expect(report.operatorSummary.internalDogfoodReviewReady).toBe(false);
    expect(report.operatorSummary.internalDogfoodContinuationGateReady).toBe(true);
  });

  it("surfaces continuation blockers when benchmark/parity evidence is not review-safe", () => {
    const report = buildCutoverReadinessReport({
      generatedAt: 86_400_100,
      cutoverDecision: makeCutoverDecision(),
      telemetry: makeTelemetry({
        primaryRuns: 120,
        mismatchCategories: {
          true_regression: 2,
          expected_precision_improvement: 0,
          known_slot_minute_divergence: 0,
          comparator_tolerance_policy_gap: 0,
        },
      }),
      authorityFlipGate: {
        ...makeAuthorityFlipGate(),
        readinessBenchmarkPassed: false,
      },
      rolloutControl: makeRolloutControl(),
      rehearsalVerification: makeRehearsalVerification(),
      ringProgressionApproval: makeRingProgressionApproval(),
      minuteCanaryEnablement: makeMinuteCanaryEnablement(),
      minuteCanaryExecution: makeMinuteCanaryExecution(),
    });

    expect(report.internalDogfoodSupport.parityTrueRegressionCount).toBe(2);
    expect(report.internalDogfoodSupport.parityClearForReview).toBe(false);
    expect(report.internalDogfoodSupport.benchmarkPassedForReview).toBe(false);
    expect(report.internalDogfoodSupport.continuationGateReady).toBe(false);
    expect(report.internalDogfoodSupport.reviewBlockers).toContain("benchmark_not_passed");
    expect(report.internalDogfoodSupport.reviewBlockers).toContain(
      "parity_true_regressions_detected",
    );
    expect(report.operatorSummary.internalDogfoodContinuationGateReady).toBe(false);
  });
});