import { describe, expect, it } from "vitest";
import type { CutoverReadinessBenchmarkReport } from "../../src/schedule/CutoverReadinessBenchmark.js";
import { DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS } from "../../src/schedule/CutoverReadinessBenchmark.js";
import type {
    AuthorityFlipGateReport,
    CutoverReadinessDecision,
    CutoverTelemetrySnapshot,
    MinuteCanaryEnablementDecision,
    RingProgressionApprovalState,
} from "../../src/schedule/CutoverReadinessGate.js";
import { buildCutoverReadinessReport } from "../../src/schedule/CutoverReadinessReport.js";

const makeTelemetry = (
  overrides: Partial<CutoverTelemetrySnapshot> = {},
): CutoverTelemetrySnapshot => ({
  primaryRuns: 40,
  shadowRuns: 40,
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
  primaryRequestBuildRuns: 40,
  primaryEngineExecRuns: 40,
  primaryProjectionRuns: 40,
  shadowRequestBuildRuns: 40,
  shadowEngineExecRuns: 40,
  ...overrides,
});

const makeCutoverDecision = (
  overrides: Partial<CutoverReadinessDecision> = {},
): CutoverReadinessDecision => ({
  requestedMode: "minute",
  effectiveMode: "slot",
  reason: "kill_switch_forced_slot",
  killSwitchForceSlot: true,
  parityGatePassed: false,
  ...overrides,
});

const makeAuthorityFlipGate = (
  overrides: Partial<AuthorityFlipGateReport> = {},
): AuthorityFlipGateReport => ({
  requestedMode: "minute",
  killSwitchForceSlot: true,
  parityGatePassed: false,
  readinessBenchmarkPassed: false,
  persistencePurityPassed: false,
  stagingGuardPassed: false,
  eligible: false,
  blockers: [
    "kill_switch_forced_slot",
    "parity_gate_not_passed",
    "readiness_benchmark_not_passed",
    "persistence_purity_not_passed",
    "staging_guard_not_passed",
  ],
  ...overrides,
});

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

const makeRingProgressionApproval = (
  overrides: Partial<RingProgressionApprovalState> = {},
): RingProgressionApprovalState => ({
  currentRing: "off",
  approvedRing: "off",
  canProgress: true,
  ...overrides,
});

describe("D9e cutover readiness report", () => {
  it("builds a unified advisory report from current D9 signals", () => {
    const report = buildCutoverReadinessReport({
      generatedAt: 1234,
      cutoverDecision: makeCutoverDecision(),
      telemetry: makeTelemetry(),
      authorityFlipGate: makeAuthorityFlipGate(),
      rolloutControl: {
        ring: "off",
        targetingMode: "all",
        subjectCohortId: null,
        targetedCohorts: [],
        cohortMatched: true,
        eligible: false,
        blockers: ["ring_not_enabled"],
      },
      rehearsalVerification: {
        killSwitch: {
          result: "not_run",
          recordedAt: null,
          ring: null,
          notes: null,
        },
        rollback: {
          result: "not_run",
          recordedAt: null,
          ring: null,
          notes: null,
        },
        bothPassed: false,
      },
      ringProgressionApproval: makeRingProgressionApproval(),
      minuteCanaryEnablement: makeMinuteCanaryEnablement(),
    });

    expect(report.version).toBe(1);
    expect(report.generatedAt).toBe(1234);
    expect(report.cutoverDecision.reason).toBe("kill_switch_forced_slot");
    expect(report.telemetry.primaryP95Ms).toBe(100);
    expect(report.benchmark).toEqual({
      passed: false,
      hasReport: false,
      report: null,
    });
    expect(report.persistencePurity).toEqual({ passed: false });
    expect(report.rehearsalVerification).toEqual({
      killSwitch: {
        result: "not_run",
        recordedAt: null,
        ring: null,
        notes: null,
      },
      rollback: {
        result: "not_run",
        recordedAt: null,
        ring: null,
        notes: null,
      },
      bothPassed: false,
    });
    expect(report.ringProgressionApproval).toEqual({
      currentRing: "off",
      approvedRing: "off",
      canProgress: true,
    });
    expect(report.internalDogfoodSupport).toEqual({
      active: false,
      approvedForCurrentRing: true,
      executionEntryReady: false,
      executionEntryBlockers: [
        "ring_not_internal_dogfood",
        "authority_flip_gate_blocked",
        "rollout_control_blocked",
        "rehearsal_verification_not_passed",
        "minute_canary_enablement_not_ready",
      ],
      benchmarkReportCaptured: false,
      killSwitchEvidenceCaptured: false,
      rollbackEvidenceCaptured: false,
      persistencePurityEvidencePassed: false,
      evidenceBundleComplete: false,
      minimumObservationDurationMsRequired: 86_400_000,
      observedObservationDurationMs: null,
      minimumObservationDurationMet: false,
      observedSchedulingRuns: 40,
      minimumSchedulingRunsRequired: 100,
      minimumSchedulingRunsMet: false,
      inRingKillSwitchVerified: false,
      inRingRollbackVerified: false,
      inRingRehearsalsVerified: false,
      lastExecutionRoute: "slot",
      lastRoutingReason: "runtime_not_observed",
      lastFallbackReason: null,
      minuteExecutionObserved: false,
      persistenceSafetyVerified: false,
      persistencePurityViolationCount: 0,
      parityTrueRegressionCount: 0,
      parityClearForReview: true,
      benchmarkPassedForReview: false,
      continuationGateReady: false,
      eligibilityEvidenceCaptured: true,
      fallbackEvidenceCaptured: true,
      reviewReady: false,
      reviewBlockers: [
        "ring_not_internal_dogfood",
        "minimum_observation_duration_not_met",
        "minimum_scheduling_runs_not_met",
        "kill_switch_rehearsal_not_verified_in_ring",
        "rollback_rehearsal_not_verified_in_ring",
        "minute_execution_not_observed",
        "persistence_safety_not_verified",
        "benchmark_not_passed",
      ],
    });
    expect(report.minuteCanaryEnablement).toEqual({
      canaryEnablementFlag: false,
      effectiveMode: "slot",
      canEnableMinuteAuthorityForCohort: false,
      blockers: [
        "canary_enablement_flag_off",
        "authority_flip_gate_blocked",
        "rollout_control_blocked",
        "rehearsal_verification_not_passed",
      ],
      ring: "off",
      subjectCohortId: null,
    });
    expect(report.authorityFlipGate.blockers).toContain("staging_guard_not_passed");
    expect(report.rolloutControl).toEqual({
      ring: "off",
      targetingMode: "all",
      subjectCohortId: null,
      targetedCohorts: [],
      cohortMatched: true,
      eligible: false,
      blockers: ["ring_not_enabled"],
    });
    expect(report.operatorSummary).toEqual({
      ring: "off",
      approvedRing: "off",
      ringProgressionApproved: true,
      targetingMode: "all",
      subjectCohortId: null,
      targetedCohortCount: 0,
      cohortInclusion: "not_applicable_all",
      rolloutBlockers: ["ring_not_enabled"],
      authorityFlipBlockers: [
        "kill_switch_forced_slot",
        "parity_gate_not_passed",
        "readiness_benchmark_not_passed",
        "persistence_purity_not_passed",
        "staging_guard_not_passed",
      ],
      killSwitchRehearsalResult: "not_run",
      rollbackRehearsalResult: "not_run",
      rehearsalsPassed: false,
      missingRehearsals: ["kill_switch", "rollback"],
      minuteCanaryEnablementFlag: false,
      minuteCanaryEligibleForCohort: false,
      minuteCanaryBlockers: [
        "canary_enablement_flag_off",
        "authority_flip_gate_blocked",
        "rollout_control_blocked",
        "rehearsal_verification_not_passed",
      ],
      minuteExecutionRoute: "slot",
      minuteRoutingReason: "runtime_not_observed",
      minuteFallbackReason: null,
      internalDogfoodExecutionEntryReady: false,
      internalDogfoodExecutionEntryBlockers: [
        "ring_not_internal_dogfood",
        "authority_flip_gate_blocked",
        "rollout_control_blocked",
        "rehearsal_verification_not_passed",
        "minute_canary_enablement_not_ready",
      ],
      internalDogfoodEvidenceBundleComplete: false,
      internalDogfoodReviewReady: false,
      internalDogfoodReviewBlockers: [
        "ring_not_internal_dogfood",
        "minimum_observation_duration_not_met",
        "minimum_scheduling_runs_not_met",
        "kill_switch_rehearsal_not_verified_in_ring",
        "rollback_rehearsal_not_verified_in_ring",
        "minute_execution_not_observed",
        "persistence_safety_not_verified",
        "benchmark_not_passed",
      ],
      internalDogfoodContinuationGateReady: false,
      authorityCorrelation: {
        requestedAuthorityMode: "minute",
        effectiveAuthorityMode: "slot",
        killSwitchPosture: "force_slot",
        authorityFlipEligible: false,
        rolloutEligible: false,
        minuteAuthorityActionable: false,
        correlationReason: "kill_switch_forced_slot",
        primaryBlockers: [
          "kill_switch_forced_slot",
          "parity_gate_not_passed",
          "readiness_benchmark_not_passed",
          "persistence_purity_not_passed",
          "staging_guard_not_passed",
          "ring_not_enabled",
        ],
      },
    });
    expect(report.operationalState).toEqual({
      advisoryOnly: true,
      slotAuthorityRemainsPrimary: true,
      minutePathShadowOnly: true,
      taskCalendarsActive: false,
      resourceCalendarsActive: false,
    });
  });

  it("includes a structured benchmark artifact when one is available", () => {
    const telemetry = makeTelemetry();
    const benchmarkReport: CutoverReadinessBenchmarkReport = {
      thresholds: DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      latencyPass: true,
      samplePass: true,
      shadowFailurePass: true,
      overallPass: true,
      shadowFailure: {
        observed: 0,
        maxAllowed: 0,
        pass: true,
      },
      metrics: {
        primary_overall: {
          key: "primary_overall",
          baselineP95Ms: 100,
          candidateP95Ms: 105,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 5,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        shadow_overall: {
          key: "shadow_overall",
          baselineP95Ms: 110,
          candidateP95Ms: 118,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 7.2727272727,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        primary_request_build: {
          key: "primary_request_build",
          baselineP95Ms: 10,
          candidateP95Ms: 10,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 0,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        primary_engine_exec: {
          key: "primary_engine_exec",
          baselineP95Ms: 60,
          candidateP95Ms: 64,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 6.6666666667,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        primary_projection: {
          key: "primary_projection",
          baselineP95Ms: 14,
          candidateP95Ms: 15,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 7.1428571429,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        shadow_request_build: {
          key: "shadow_request_build",
          baselineP95Ms: 12,
          candidateP95Ms: 13,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 8.3333333333,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
        shadow_engine_exec: {
          key: "shadow_engine_exec",
          baselineP95Ms: 75,
          candidateP95Ms: 80,
          baselineRuns: 40,
          candidateRuns: 40,
          samplePass: true,
          regressionPct: 6.6666666667,
          budgetPct: 10,
          latencyPass: true,
          pass: true,
        },
      },
      failingChecks: [],
    };

    const report = buildCutoverReadinessReport({
      generatedAt: 2345,
      cutoverDecision: makeCutoverDecision({
        killSwitchForceSlot: false,
        parityGatePassed: true,
        reason: "minute_mode_allowed",
        effectiveMode: "minute",
      }),
      telemetry,
      authorityFlipGate: makeAuthorityFlipGate({
        killSwitchForceSlot: false,
        parityGatePassed: true,
        readinessBenchmarkPassed: true,
        persistencePurityPassed: true,
        stagingGuardPassed: true,
        eligible: true,
        blockers: [],
      }),
      rolloutControl: {
        ring: "canary",
        targetingMode: "cohort_allowlist",
        subjectCohortId: "cohort-a",
        targetedCohorts: ["cohort-a", "cohort-b"],
        cohortMatched: true,
        eligible: true,
        blockers: [],
      },
      rehearsalVerification: {
        killSwitch: {
          result: "passed",
          recordedAt: 2_000,
          ring: "canary",
          notes: "kill-switch rehearsal complete",
        },
        rollback: {
          result: "passed",
          recordedAt: 2_100,
          ring: "canary",
          notes: "rollback rehearsal complete",
        },
        bothPassed: true,
      },
      ringProgressionApproval: makeRingProgressionApproval({
        currentRing: "canary",
        approvedRing: "canary",
        canProgress: true,
      }),
      minuteCanaryEnablement: makeMinuteCanaryEnablement({
        ring: "canary",
        subjectCohortId: "cohort-a",
        canaryEnablementFlag: true,
        authorityFlipEligible: true,
        rolloutEligible: true,
        rehearsalsPassed: true,
        effectiveMode: "minute",
        canEnableMinuteAuthorityForCohort: true,
        blockers: [],
      }),
      benchmarkReport,
    });

    expect(report.benchmark.hasReport).toBe(true);
    expect(report.benchmark.passed).toBe(true);
    expect(report.benchmark.report?.overallPass).toBe(true);
    expect(report.persistencePurity.passed).toBe(true);
    expect(report.authorityFlipGate.eligible).toBe(true);
    expect(report.rolloutControl.eligible).toBe(true);
    expect(report.rolloutControl.ring).toBe("canary");
    expect(report.ringProgressionApproval).toEqual({
      currentRing: "canary",
      approvedRing: "canary",
      canProgress: true,
    });
    expect(report.internalDogfoodSupport.active).toBe(false);
    expect(report.internalDogfoodSupport.executionEntryReady).toBe(false);
    expect(report.internalDogfoodSupport.executionEntryBlockers).toContain(
      "ring_not_internal_dogfood",
    );
    expect(report.internalDogfoodSupport.evidenceBundleComplete).toBe(true);
    expect(report.internalDogfoodSupport.lastRoutingReason).toBe("runtime_not_observed");
    expect(report.rehearsalVerification.bothPassed).toBe(true);
    expect(report.minuteCanaryEnablement.canaryEnablementFlag).toBe(true);
    expect(report.minuteCanaryEnablement.canEnableMinuteAuthorityForCohort).toBe(true);
    expect(report.minuteCanaryEnablement.effectiveMode).toBe("minute");
    expect(report.minuteCanaryEnablement.blockers).toEqual([]);
    expect(report.operatorSummary.ring).toBe("canary");
    expect(report.operatorSummary.approvedRing).toBe("canary");
    expect(report.operatorSummary.ringProgressionApproved).toBe(true);
    expect(report.operatorSummary.targetingMode).toBe("cohort_allowlist");
    expect(report.operatorSummary.targetedCohortCount).toBe(2);
    expect(report.operatorSummary.cohortInclusion).toBe("targeted");
    expect(report.operatorSummary.killSwitchRehearsalResult).toBe("passed");
    expect(report.operatorSummary.rollbackRehearsalResult).toBe("passed");
    expect(report.operatorSummary.rehearsalsPassed).toBe(true);
    expect(report.operatorSummary.missingRehearsals).toEqual([]);
    expect(report.operatorSummary.minuteCanaryEnablementFlag).toBe(true);
    expect(report.operatorSummary.minuteCanaryEligibleForCohort).toBe(true);
    expect(report.operatorSummary.minuteCanaryBlockers).toEqual([]);
    expect(report.operatorSummary.minuteExecutionRoute).toBe("slot");
    expect(report.operatorSummary.minuteRoutingReason).toBe("runtime_not_observed");
    expect(report.operatorSummary.minuteFallbackReason).toBeNull();
    expect(report.operatorSummary.internalDogfoodExecutionEntryReady).toBe(false);
    expect(report.operatorSummary.internalDogfoodExecutionEntryBlockers).toContain(
      "ring_not_internal_dogfood",
    );
    expect(report.operatorSummary.internalDogfoodEvidenceBundleComplete).toBe(true);
    expect(report.operatorSummary.internalDogfoodReviewReady).toBe(false);
    expect(report.operatorSummary.internalDogfoodReviewBlockers).toContain(
      "ring_not_internal_dogfood",
    );
    expect(report.operatorSummary.internalDogfoodContinuationGateReady).toBe(true);
    expect(report.operatorSummary.authorityCorrelation.killSwitchPosture).toBe("open");
    expect(report.operatorSummary.authorityCorrelation.authorityFlipEligible).toBe(true);
    expect(report.operatorSummary.authorityCorrelation.rolloutEligible).toBe(true);
    expect(report.operatorSummary.authorityCorrelation.correlationReason).toBe("minute_authority_actionable");
    expect(report.operatorSummary.authorityCorrelation.minuteAuthorityActionable).toBe(true);
  });
});