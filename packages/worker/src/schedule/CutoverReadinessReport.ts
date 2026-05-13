import type { CutoverReadinessBenchmarkReport } from "./CutoverReadinessBenchmark.js";
import type {
    AuthorityFlipGateBlocker,
    AuthorityFlipGateReport,
    CutoverReadinessDecision,
    CutoverTelemetrySnapshot,
    MinuteCanaryEnablementBlocker,
    MinuteCanaryEnablementDecision,
    RehearsalResult,
    RehearsalVerificationState,
    RequestedAuthorityMode,
    RingProgressionApprovalState,
    RolloutControlState,
    RolloutTargetingMode,
} from "./CutoverReadinessGate.js";
import type { D10eAuthorityRoutingReason } from "./D10eAuthorityRouting.js";

export type CutoverReadinessBenchmarkArtifact = {
  readonly passed: boolean;
  readonly hasReport: boolean;
  readonly report: CutoverReadinessBenchmarkReport | null;
};

export type CutoverReadinessPersistenceArtifact = {
  readonly passed: boolean;
};

export type CutoverReadinessRehearsalArtifact = {
  readonly killSwitch: RehearsalVerificationState["killSwitch"];
  readonly rollback: RehearsalVerificationState["rollback"];
  readonly bothPassed: boolean;
};

export type CutoverReadinessMinuteCanaryEnablementArtifact = {
  readonly canaryEnablementFlag: boolean;
  readonly effectiveMode: MinuteCanaryEnablementDecision["effectiveMode"];
  readonly canEnableMinuteAuthorityForCohort: boolean;
  readonly blockers: readonly MinuteCanaryEnablementBlocker[];
  readonly ring: RolloutControlState["ring"];
  readonly subjectCohortId: string | null;
};

export type CutoverReadinessMinuteCanaryExecutionArtifact = {
  readonly attemptedMinuteAuthority: boolean;
  readonly executedRoute: "slot" | "minute";
  readonly fallbackOccurred: boolean;
  readonly fallbackReason: string | null;
  readonly routingReason: D10eAuthorityRoutingReason;
  readonly ineligibilityBlockers: readonly MinuteCanaryEnablementBlocker[];
  readonly persistenceSafetyVerified: boolean;
  readonly persistencePurityViolationCount: number;
};

export type CutoverReadinessInternalDogfoodSupportArtifact = {
  readonly active: boolean;
  readonly approvedForCurrentRing: boolean;
  readonly executionEntryReady: boolean;
  readonly executionEntryBlockers: readonly Ring0ExecutionEntryBlocker[];
  readonly benchmarkReportCaptured: boolean;
  readonly killSwitchEvidenceCaptured: boolean;
  readonly rollbackEvidenceCaptured: boolean;
  readonly persistencePurityEvidencePassed: boolean;
  readonly evidenceBundleComplete: boolean;
  readonly minimumObservationDurationMsRequired: number;
  readonly observedObservationDurationMs: number | null;
  readonly minimumObservationDurationMet: boolean;
  readonly observedSchedulingRuns: number;
  readonly minimumSchedulingRunsRequired: number;
  readonly minimumSchedulingRunsMet: boolean;
  readonly inRingKillSwitchVerified: boolean;
  readonly inRingRollbackVerified: boolean;
  readonly inRingRehearsalsVerified: boolean;
  readonly lastExecutionRoute: CutoverReadinessMinuteCanaryExecutionArtifact["executedRoute"];
  readonly lastRoutingReason: CutoverReadinessMinuteCanaryExecutionArtifact["routingReason"];
  readonly lastFallbackReason: string | null;
  readonly minuteExecutionObserved: boolean;
  readonly persistenceSafetyVerified: boolean;
  readonly persistencePurityViolationCount: number;
  readonly parityTrueRegressionCount: number;
  readonly parityClearForReview: boolean;
  readonly benchmarkPassedForReview: boolean;
  readonly continuationGateReady: boolean;
  readonly eligibilityEvidenceCaptured: boolean;
  readonly fallbackEvidenceCaptured: boolean;
  readonly reviewReady: boolean;
  readonly reviewBlockers: readonly Ring0ReviewBlocker[];
};

export type Ring0ReviewBlocker =
  | "ring_not_internal_dogfood"
  | "ring_progression_not_approved"
  | "minimum_observation_duration_not_met"
  | "minimum_scheduling_runs_not_met"
  | "kill_switch_rehearsal_not_verified_in_ring"
  | "rollback_rehearsal_not_verified_in_ring"
  | "minute_execution_not_observed"
  | "persistence_safety_not_verified"
  | "persistence_purity_violations_detected"
  | "benchmark_not_passed"
  | "parity_true_regressions_detected";

export type Ring0ExecutionEntryBlocker =
  | "ring_not_internal_dogfood"
  | "authority_flip_gate_blocked"
  | "rollout_control_blocked"
  | "ring_progression_not_approved"
  | "rehearsal_verification_not_passed"
  | "minute_canary_enablement_not_ready";

export type CutoverReadinessOperationalState = {
  readonly advisoryOnly: true;
  readonly slotAuthorityRemainsPrimary: true;
  readonly minutePathShadowOnly: true;
  readonly taskCalendarsActive: false;
  readonly resourceCalendarsActive: false;
};

export type RolloutCohortInclusion =
  | "not_applicable_all"
  | "targeted"
  | "not_targeted"
  | "allowlist_empty";

export type OperatorAuthorityCorrelationReason =
  | "minute_not_requested"
  | "kill_switch_forced_slot"
  | "authority_flip_gate_blocked"
  | "rollout_control_blocked"
  | "minute_authority_actionable";

export type CutoverOperatorAuthorityCorrelation = {
  readonly requestedAuthorityMode: RequestedAuthorityMode;
  readonly effectiveAuthorityMode: CutoverReadinessDecision["effectiveMode"];
  readonly killSwitchPosture: "force_slot" | "open";
  readonly authorityFlipEligible: boolean;
  readonly rolloutEligible: boolean;
  readonly minuteAuthorityActionable: boolean;
  readonly correlationReason: OperatorAuthorityCorrelationReason;
  readonly primaryBlockers: readonly string[];
};

export type CutoverReadinessOperatorSummary = {
  readonly ring: RolloutControlState["ring"];
  readonly approvedRing: RingProgressionApprovalState["approvedRing"];
  readonly ringProgressionApproved: boolean;
  readonly targetingMode: RolloutTargetingMode;
  readonly subjectCohortId: string | null;
  readonly targetedCohortCount: number;
  readonly cohortInclusion: RolloutCohortInclusion;
  readonly rolloutBlockers: readonly RolloutControlState["blockers"][number][];
  readonly authorityFlipBlockers: readonly AuthorityFlipGateBlocker[];
  readonly killSwitchRehearsalResult: RehearsalResult;
  readonly rollbackRehearsalResult: RehearsalResult;
  readonly rehearsalsPassed: boolean;
  readonly missingRehearsals: readonly ("kill_switch" | "rollback")[];
  readonly minuteCanaryEnablementFlag: boolean;
  readonly minuteCanaryEligibleForCohort: boolean;
  readonly minuteCanaryBlockers: readonly MinuteCanaryEnablementBlocker[];
  readonly minuteExecutionRoute: CutoverReadinessMinuteCanaryExecutionArtifact["executedRoute"];
  readonly minuteRoutingReason: CutoverReadinessMinuteCanaryExecutionArtifact["routingReason"];
  readonly minuteFallbackReason: string | null;
  readonly internalDogfoodExecutionEntryReady: boolean;
  readonly internalDogfoodExecutionEntryBlockers: readonly Ring0ExecutionEntryBlocker[];
  readonly internalDogfoodEvidenceBundleComplete: boolean;
  readonly internalDogfoodReviewReady: boolean;
  readonly internalDogfoodReviewBlockers: readonly Ring0ReviewBlocker[];
  readonly internalDogfoodContinuationGateReady: boolean;
  readonly authorityCorrelation: CutoverOperatorAuthorityCorrelation;
};

export type CutoverReadinessReport = {
  readonly version: 1;
  readonly generatedAt: number;
  readonly cutoverDecision: CutoverReadinessDecision;
  readonly telemetry: CutoverTelemetrySnapshot;
  readonly benchmark: CutoverReadinessBenchmarkArtifact;
  readonly persistencePurity: CutoverReadinessPersistenceArtifact;
  readonly rehearsalVerification: CutoverReadinessRehearsalArtifact;
  readonly ringProgressionApproval: RingProgressionApprovalState;
  readonly internalDogfoodSupport: CutoverReadinessInternalDogfoodSupportArtifact;
  readonly minuteCanaryEnablement: CutoverReadinessMinuteCanaryEnablementArtifact;
  readonly minuteCanaryExecution: CutoverReadinessMinuteCanaryExecutionArtifact;
  readonly authorityFlipGate: AuthorityFlipGateReport;
  readonly rolloutControl: RolloutControlState;
  readonly operatorSummary: CutoverReadinessOperatorSummary;
  readonly operationalState: CutoverReadinessOperationalState;
};

export type BuildCutoverReadinessReportInput = {
  readonly generatedAt?: number;
  readonly cutoverDecision: CutoverReadinessDecision;
  readonly telemetry: CutoverTelemetrySnapshot;
  readonly authorityFlipGate: AuthorityFlipGateReport;
  readonly rolloutControl: RolloutControlState;
  readonly rehearsalVerification: RehearsalVerificationState;
  readonly ringProgressionApproval: RingProgressionApprovalState;
  readonly minuteCanaryEnablement: MinuteCanaryEnablementDecision;
  readonly benchmarkReport?: CutoverReadinessBenchmarkReport | null;
  readonly minuteCanaryExecution?: CutoverReadinessMinuteCanaryExecutionArtifact | null;
};

const deriveMissingRehearsals = (
  rehearsalVerification: RehearsalVerificationState,
): Array<"kill_switch" | "rollback"> => {
  const missing: Array<"kill_switch" | "rollback"> = [];
  if (rehearsalVerification.killSwitch.result !== "passed") {
    missing.push("kill_switch");
  }
  if (rehearsalVerification.rollback.result !== "passed") {
    missing.push("rollback");
  }
  return missing;
};

const deriveCohortInclusion = (
  rolloutControl: RolloutControlState,
): RolloutCohortInclusion => {
  if (rolloutControl.targetingMode === "all") {
    return "not_applicable_all";
  }
  if (rolloutControl.blockers.includes("cohort_allowlist_empty")) {
    return "allowlist_empty";
  }
  return rolloutControl.cohortMatched ? "targeted" : "not_targeted";
};

const deriveAuthorityCorrelation = (
  cutoverDecision: CutoverReadinessDecision,
  authorityFlipGate: AuthorityFlipGateReport,
  rolloutControl: RolloutControlState,
): CutoverOperatorAuthorityCorrelation => {
  const primaryBlockers = [
    ...authorityFlipGate.blockers,
    ...rolloutControl.blockers,
  ];

  let correlationReason: OperatorAuthorityCorrelationReason;
  if (cutoverDecision.requestedMode !== "minute") {
    correlationReason = "minute_not_requested";
  } else if (cutoverDecision.killSwitchForceSlot) {
    correlationReason = "kill_switch_forced_slot";
  } else if (!authorityFlipGate.eligible) {
    correlationReason = "authority_flip_gate_blocked";
  } else if (!rolloutControl.eligible) {
    correlationReason = "rollout_control_blocked";
  } else {
    correlationReason = "minute_authority_actionable";
  }

  return {
    requestedAuthorityMode: cutoverDecision.requestedMode,
    effectiveAuthorityMode: cutoverDecision.effectiveMode,
    killSwitchPosture: cutoverDecision.killSwitchForceSlot ? "force_slot" : "open",
    authorityFlipEligible: authorityFlipGate.eligible,
    rolloutEligible: rolloutControl.eligible,
    minuteAuthorityActionable: correlationReason === "minute_authority_actionable",
    correlationReason,
    primaryBlockers,
  };
};

const INTERNAL_DOGFOOD_MINIMUM_RUNS = 100;
const INTERNAL_DOGFOOD_MINIMUM_DURATION_MS = 24 * 60 * 60 * 1000;

const deriveInternalDogfoodSupport = (
  generatedAt: number,
  authorityFlipGate: AuthorityFlipGateReport,
  rolloutControl: RolloutControlState,
  ringProgressionApproval: RingProgressionApprovalState,
  rehearsalVerification: RehearsalVerificationState,
  minuteCanaryEnablement: MinuteCanaryEnablementDecision,
  benchmarkReport: CutoverReadinessBenchmarkReport | null | undefined,
  minuteCanaryExecution: CutoverReadinessMinuteCanaryExecutionArtifact,
  telemetry: CutoverTelemetrySnapshot,
): CutoverReadinessInternalDogfoodSupportArtifact => {
  const active = rolloutControl.ring === "internal_dogfood";
  const observedSchedulingRuns = telemetry.primaryRuns;
  const executionEntryBlockers: Ring0ExecutionEntryBlocker[] = [];
  const benchmarkReportCaptured = benchmarkReport != null;
  const killSwitchEvidenceCaptured = rehearsalVerification.killSwitch.recordedAt != null;
  const rollbackEvidenceCaptured = rehearsalVerification.rollback.recordedAt != null;
  const persistencePurityEvidencePassed = authorityFlipGate.persistencePurityPassed;
  const inRingKillSwitchVerified =
    rehearsalVerification.killSwitch.result === "passed"
    && rehearsalVerification.killSwitch.ring === rolloutControl.ring;
  const inRingRollbackVerified =
    rehearsalVerification.rollback.result === "passed"
    && rehearsalVerification.rollback.ring === rolloutControl.ring;
  const rehearsalTimestamps = [
    inRingKillSwitchVerified ? rehearsalVerification.killSwitch.recordedAt : null,
    inRingRollbackVerified ? rehearsalVerification.rollback.recordedAt : null,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const firstInRingEvidenceAt = rehearsalTimestamps.length > 0
    ? Math.min(...rehearsalTimestamps)
    : null;
  const observedObservationDurationMs = firstInRingEvidenceAt == null
    ? null
    : Math.max(0, generatedAt - firstInRingEvidenceAt);
  const minimumObservationDurationMet =
    observedObservationDurationMs != null
    && observedObservationDurationMs >= INTERNAL_DOGFOOD_MINIMUM_DURATION_MS;
  const minuteExecutionObserved =
    minuteCanaryExecution.attemptedMinuteAuthority
    || minuteCanaryExecution.routingReason !== "runtime_not_observed";
  const parityTrueRegressionCount = telemetry.mismatchCategories.true_regression;
  const parityClearForReview = parityTrueRegressionCount === 0;
  const benchmarkPassedForReview = authorityFlipGate.readinessBenchmarkPassed;
  const continuationGateReady = parityClearForReview && benchmarkPassedForReview;
  const evidenceBundleComplete =
    benchmarkReportCaptured
    && killSwitchEvidenceCaptured
    && rollbackEvidenceCaptured
    && persistencePurityEvidencePassed;
  const reviewBlockers: Ring0ReviewBlocker[] = [];

  if (!active) {
    executionEntryBlockers.push("ring_not_internal_dogfood");
  }
  if (!authorityFlipGate.eligible) {
    executionEntryBlockers.push("authority_flip_gate_blocked");
  }
  if (!rolloutControl.eligible) {
    executionEntryBlockers.push("rollout_control_blocked");
  }
  if (!ringProgressionApproval.canProgress) {
    executionEntryBlockers.push("ring_progression_not_approved");
  }
  if (!rehearsalVerification.bothPassed) {
    executionEntryBlockers.push("rehearsal_verification_not_passed");
  }
  if (!minuteCanaryEnablement.canEnableMinuteAuthorityForCohort) {
    executionEntryBlockers.push("minute_canary_enablement_not_ready");
  }

  if (!active) {
    reviewBlockers.push("ring_not_internal_dogfood");
  }
  if (!ringProgressionApproval.canProgress) {
    reviewBlockers.push("ring_progression_not_approved");
  }
  if (!minimumObservationDurationMet) {
    reviewBlockers.push("minimum_observation_duration_not_met");
  }
  if (observedSchedulingRuns < INTERNAL_DOGFOOD_MINIMUM_RUNS) {
    reviewBlockers.push("minimum_scheduling_runs_not_met");
  }
  if (!inRingKillSwitchVerified) {
    reviewBlockers.push("kill_switch_rehearsal_not_verified_in_ring");
  }
  if (!inRingRollbackVerified) {
    reviewBlockers.push("rollback_rehearsal_not_verified_in_ring");
  }
  if (!minuteExecutionObserved) {
    reviewBlockers.push("minute_execution_not_observed");
  }
  if (!minuteCanaryExecution.persistenceSafetyVerified) {
    reviewBlockers.push("persistence_safety_not_verified");
  }
  if (minuteCanaryExecution.persistencePurityViolationCount > 0) {
    reviewBlockers.push("persistence_purity_violations_detected");
  }
  if (!benchmarkPassedForReview) {
    reviewBlockers.push("benchmark_not_passed");
  }
  if (!parityClearForReview) {
    reviewBlockers.push("parity_true_regressions_detected");
  }

  return {
    active,
    approvedForCurrentRing: ringProgressionApproval.canProgress,
    executionEntryReady: executionEntryBlockers.length === 0,
    executionEntryBlockers,
    benchmarkReportCaptured,
    killSwitchEvidenceCaptured,
    rollbackEvidenceCaptured,
    persistencePurityEvidencePassed,
    evidenceBundleComplete,
    minimumObservationDurationMsRequired: INTERNAL_DOGFOOD_MINIMUM_DURATION_MS,
    observedObservationDurationMs,
    minimumObservationDurationMet,
    observedSchedulingRuns,
    minimumSchedulingRunsRequired: INTERNAL_DOGFOOD_MINIMUM_RUNS,
    minimumSchedulingRunsMet: observedSchedulingRuns >= INTERNAL_DOGFOOD_MINIMUM_RUNS,
    inRingKillSwitchVerified,
    inRingRollbackVerified,
    inRingRehearsalsVerified: inRingKillSwitchVerified && inRingRollbackVerified,
    lastExecutionRoute: minuteCanaryExecution.executedRoute,
    lastRoutingReason: minuteCanaryExecution.routingReason,
    lastFallbackReason: minuteCanaryExecution.fallbackReason,
    minuteExecutionObserved,
    persistenceSafetyVerified: minuteCanaryExecution.persistenceSafetyVerified,
    persistencePurityViolationCount: minuteCanaryExecution.persistencePurityViolationCount,
    parityTrueRegressionCount,
    parityClearForReview,
    benchmarkPassedForReview,
    continuationGateReady,
    eligibilityEvidenceCaptured:
      minuteCanaryExecution.routingReason !== "cohort_not_eligible"
      || minuteCanaryExecution.ineligibilityBlockers.length > 0,
    fallbackEvidenceCaptured:
      !minuteCanaryExecution.fallbackOccurred || minuteCanaryExecution.fallbackReason != null,
    reviewReady: reviewBlockers.length === 0,
    reviewBlockers,
  };
};

export const buildCutoverReadinessReport = (
  input: BuildCutoverReadinessReportInput,
): CutoverReadinessReport => {
  const generatedAt = input.generatedAt ?? Date.now();
  const minuteCanaryExecution = input.minuteCanaryExecution ?? {
    attemptedMinuteAuthority: false,
    executedRoute: "slot",
    fallbackOccurred: false,
    fallbackReason: null,
    routingReason: "runtime_not_observed",
    ineligibilityBlockers: input.minuteCanaryEnablement.canEnableMinuteAuthorityForCohort
      ? []
      : input.minuteCanaryEnablement.blockers,
    persistenceSafetyVerified: false,
    persistencePurityViolationCount: 0,
  };
  const authorityCorrelation = deriveAuthorityCorrelation(
    input.cutoverDecision,
    input.authorityFlipGate,
    input.rolloutControl,
  );
  const internalDogfoodSupport = deriveInternalDogfoodSupport(
    generatedAt,
    input.authorityFlipGate,
    input.rolloutControl,
    input.ringProgressionApproval,
    input.rehearsalVerification,
    input.minuteCanaryEnablement,
    input.benchmarkReport,
    minuteCanaryExecution,
    input.telemetry,
  );

  return {
    version: 1,
    generatedAt,
    cutoverDecision: input.cutoverDecision,
    telemetry: input.telemetry,
    benchmark: {
      passed: input.authorityFlipGate.readinessBenchmarkPassed,
      hasReport: input.benchmarkReport != null,
      report: input.benchmarkReport ?? null,
    },
    persistencePurity: {
      passed: input.authorityFlipGate.persistencePurityPassed,
    },
    rehearsalVerification: {
      killSwitch: input.rehearsalVerification.killSwitch,
      rollback: input.rehearsalVerification.rollback,
      bothPassed: input.rehearsalVerification.bothPassed,
    },
    ringProgressionApproval: input.ringProgressionApproval,
    internalDogfoodSupport,
    minuteCanaryEnablement: {
      canaryEnablementFlag: input.minuteCanaryEnablement.canaryEnablementFlag,
      effectiveMode: input.minuteCanaryEnablement.effectiveMode,
      canEnableMinuteAuthorityForCohort: input.minuteCanaryEnablement.canEnableMinuteAuthorityForCohort,
      blockers: input.minuteCanaryEnablement.blockers,
      ring: input.minuteCanaryEnablement.ring,
      subjectCohortId: input.minuteCanaryEnablement.subjectCohortId,
    },
    minuteCanaryExecution,
    authorityFlipGate: input.authorityFlipGate,
    rolloutControl: input.rolloutControl,
    operatorSummary: {
      ring: input.rolloutControl.ring,
      approvedRing: input.ringProgressionApproval.approvedRing,
      ringProgressionApproved: input.ringProgressionApproval.canProgress,
      targetingMode: input.rolloutControl.targetingMode,
      subjectCohortId: input.rolloutControl.subjectCohortId,
      targetedCohortCount: input.rolloutControl.targetedCohorts.length,
      cohortInclusion: deriveCohortInclusion(input.rolloutControl),
      rolloutBlockers: input.rolloutControl.blockers,
      authorityFlipBlockers: input.authorityFlipGate.blockers,
      killSwitchRehearsalResult: input.rehearsalVerification.killSwitch.result,
      rollbackRehearsalResult: input.rehearsalVerification.rollback.result,
      rehearsalsPassed: input.rehearsalVerification.bothPassed,
      missingRehearsals: deriveMissingRehearsals(input.rehearsalVerification),
      minuteCanaryEnablementFlag: input.minuteCanaryEnablement.canaryEnablementFlag,
      minuteCanaryEligibleForCohort: input.minuteCanaryEnablement.canEnableMinuteAuthorityForCohort,
      minuteCanaryBlockers: input.minuteCanaryEnablement.blockers,
      minuteExecutionRoute: minuteCanaryExecution.executedRoute,
      minuteRoutingReason: minuteCanaryExecution.routingReason,
      minuteFallbackReason: minuteCanaryExecution.fallbackReason,
      internalDogfoodExecutionEntryReady: internalDogfoodSupport.executionEntryReady,
      internalDogfoodExecutionEntryBlockers: internalDogfoodSupport.executionEntryBlockers,
      internalDogfoodEvidenceBundleComplete: internalDogfoodSupport.evidenceBundleComplete,
      internalDogfoodReviewReady: internalDogfoodSupport.reviewReady,
      internalDogfoodReviewBlockers: internalDogfoodSupport.reviewBlockers,
      internalDogfoodContinuationGateReady: internalDogfoodSupport.continuationGateReady,
      authorityCorrelation,
    },
    operationalState: {
      advisoryOnly: true,
      slotAuthorityRemainsPrimary: true,
      minutePathShadowOnly: true,
      taskCalendarsActive: false,
      resourceCalendarsActive: false,
    },
  };
};