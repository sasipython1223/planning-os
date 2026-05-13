import type { ParityMismatchCategory } from "./ParityPolicy.js";
import type { ShadowComparisonReadinessReport } from "./ScheduleComparator.js";

export type RequestedAuthorityMode = "slot" | "minute";
export type EffectiveAuthorityMode = "slot" | "minute";

export type CutoverDecisionReason =
  | "kill_switch_forced_slot"
  | "minute_mode_not_requested"
  | "parity_gate_not_passed"
  | "minute_mode_allowed";

export type CutoverReadinessDecision = {
  readonly requestedMode: RequestedAuthorityMode;
  readonly effectiveMode: EffectiveAuthorityMode;
  readonly reason: CutoverDecisionReason;
  readonly killSwitchForceSlot: boolean;
  readonly parityGatePassed: boolean;
};

export type AuthorityFlipGateBlocker =
  | "requested_mode_not_minute"
  | "kill_switch_forced_slot"
  | "parity_gate_not_passed"
  | "readiness_benchmark_not_passed"
  | "persistence_purity_not_passed"
  | "staging_guard_not_passed";

export type AuthorityFlipGateReport = {
  readonly requestedMode: RequestedAuthorityMode;
  readonly killSwitchForceSlot: boolean;
  readonly parityGatePassed: boolean;
  readonly readinessBenchmarkPassed: boolean;
  readonly persistencePurityPassed: boolean;
  readonly stagingGuardPassed: boolean;
  readonly eligible: boolean;
  readonly blockers: readonly AuthorityFlipGateBlocker[];
};

export type RolloutRing =
  | "off"
  | "internal_dogfood"
  | "canary"
  | "partial_production"
  | "full_production";

export type RolloutTargetingMode = "all" | "cohort_allowlist";

export type RolloutControlBlocker =
  | "ring_not_enabled"
  | "cohort_not_targeted"
  | "cohort_allowlist_empty";

export type RolloutControlState = {
  readonly ring: RolloutRing;
  readonly targetingMode: RolloutTargetingMode;
  readonly subjectCohortId: string | null;
  readonly targetedCohorts: readonly string[];
  readonly cohortMatched: boolean;
  readonly eligible: boolean;
  readonly blockers: readonly RolloutControlBlocker[];
};

export type RehearsalResult = "not_run" | "passed" | "failed";

export type RehearsalVerificationRecord = {
  readonly result: RehearsalResult;
  readonly recordedAt: number | null;
  readonly ring: RolloutRing | null;
  readonly notes: string | null;
};

export type RehearsalVerificationState = {
  readonly killSwitch: RehearsalVerificationRecord;
  readonly rollback: RehearsalVerificationRecord;
  readonly bothPassed: boolean;
};

export type RingProgressionApprovalState = {
  readonly currentRing: RolloutRing;
  readonly approvedRing: RolloutRing;
  readonly canProgress: boolean;
};

export type MinuteCanaryEnablementBlocker =
  | "canary_enablement_flag_off"
  | "requested_mode_not_minute"
  | "authority_flip_gate_blocked"
  | "rollout_control_blocked"
  | "rehearsal_verification_not_passed"
  | "ring_progression_not_approved";

export type MinuteCanaryEnablementDecision = {
  readonly requestedMode: RequestedAuthorityMode;
  readonly ring: RolloutRing;
  readonly subjectCohortId: string | null;
  readonly canaryEnablementFlag: boolean;
  readonly authorityFlipEligible: boolean;
  readonly rolloutEligible: boolean;
  readonly rehearsalsPassed: boolean;
  readonly effectiveMode: EffectiveAuthorityMode;
  readonly canEnableMinuteAuthorityForCohort: boolean;
  readonly blockers: readonly MinuteCanaryEnablementBlocker[];
};

export type CutoverTelemetrySnapshot = {
  readonly primaryRuns: number;
  readonly shadowRuns: number;
  readonly shadowFailures: number;
  readonly mismatchCategories: Readonly<Record<ParityMismatchCategory, number>>;
  readonly primaryP95Ms: number;
  readonly shadowP95Ms: number;
  readonly primaryRequestBuildP95Ms: number;
  readonly primaryEngineExecP95Ms: number;
  readonly primaryProjectionP95Ms: number;
  readonly shadowRequestBuildP95Ms: number;
  readonly shadowEngineExecP95Ms: number;
  readonly primaryRequestBuildRuns: number;
  readonly primaryEngineExecRuns: number;
  readonly primaryProjectionRuns: number;
  readonly shadowRequestBuildRuns: number;
  readonly shadowEngineExecRuns: number;
  /** Number of shadow comparison reports captured. */
  readonly shadowComparisonRuns?: number;
  /** Latest shadow readiness comparison report. */
  readonly latestShadowComparison?: ShadowComparisonReadinessReport | null;
  /** Runs where divergence was fully explained by task calendars (W5B-B1 expected). */
  readonly expectedShadowDivergenceRuns?: number;
  /** Runs with at least one unexplained divergence. */
  readonly unexplainedShadowDivergenceRuns?: number;
  /** Single-calendar parity runs observed. */
  readonly singleCalendarParityRuns?: number;
  /** Single-calendar runs that still had unexplained divergence. */
  readonly singleCalendarParityViolationRuns?: number;
};

let requestedMode: RequestedAuthorityMode = "slot";
let killSwitchForceSlot = true;
let parityGatePassed = false;
let readinessBenchmarkPassed = false;
let persistencePurityPassed = false;
let stagingGuardPassed = false;
let rolloutRing: RolloutRing = "off";
let approvedRing: RolloutRing = "off";
let rolloutTargetingMode: RolloutTargetingMode = "all";
let rolloutSubjectCohortId: string | null = null;
let rolloutTargetedCohorts: string[] = [];
let canaryMinuteEnablementEnabled = false;
let killSwitchRehearsal: RehearsalVerificationRecord = {
  result: "not_run",
  recordedAt: null,
  ring: null,
  notes: null,
};
let rollbackRehearsal: RehearsalVerificationRecord = {
  result: "not_run",
  recordedAt: null,
  ring: null,
  notes: null,
};

const primaryDurationsMs: number[] = [];
const shadowDurationsMs: number[] = [];
const primaryRequestBuildDurationsMs: number[] = [];
const primaryEngineExecDurationsMs: number[] = [];
const primaryProjectionDurationsMs: number[] = [];
const shadowRequestBuildDurationsMs: number[] = [];
const shadowEngineExecDurationsMs: number[] = [];
let shadowFailures = 0;
let shadowComparisonRuns = 0;
let expectedShadowDivergenceRuns = 0;
let unexplainedShadowDivergenceRuns = 0;
let singleCalendarParityRuns = 0;
let singleCalendarParityViolationRuns = 0;
let latestShadowComparison: ShadowComparisonReadinessReport | null = null;

const mismatchCategories: Record<ParityMismatchCategory, number> = {
  true_regression: 0,
  expected_precision_improvement: 0,
  known_slot_minute_divergence: 0,
  comparator_tolerance_policy_gap: 0,
};

const MAX_DURATION_SAMPLES = 256;

const pushDurationSample = (buffer: number[], durationMs: number): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  buffer.push(durationMs);
  if (buffer.length > MAX_DURATION_SAMPLES) {
    buffer.splice(0, buffer.length - MAX_DURATION_SAMPLES);
  }
};

const percentile95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
};

export const evaluateCutoverReadiness = (): CutoverReadinessDecision => {
  if (killSwitchForceSlot) {
    return {
      requestedMode,
      effectiveMode: "slot",
      reason: "kill_switch_forced_slot",
      killSwitchForceSlot,
      parityGatePassed,
    };
  }

  if (requestedMode !== "minute") {
    return {
      requestedMode,
      effectiveMode: "slot",
      reason: "minute_mode_not_requested",
      killSwitchForceSlot,
      parityGatePassed,
    };
  }

  if (!parityGatePassed) {
    return {
      requestedMode,
      effectiveMode: "slot",
      reason: "parity_gate_not_passed",
      killSwitchForceSlot,
      parityGatePassed,
    };
  }

  return {
    requestedMode,
    effectiveMode: "minute",
    reason: "minute_mode_allowed",
    killSwitchForceSlot,
    parityGatePassed,
  };
};

export const setRequestedAuthorityMode = (mode: RequestedAuthorityMode): void => {
  requestedMode = mode;
};

export const setCutoverKillSwitchForceSlot = (enabled: boolean): void => {
  killSwitchForceSlot = enabled;
};

export const setParityGatePassed = (passed: boolean): void => {
  parityGatePassed = passed;
};

export const setReadinessBenchmarkPassed = (passed: boolean): void => {
  readinessBenchmarkPassed = passed;
};

export const setPersistencePurityPassed = (passed: boolean): void => {
  persistencePurityPassed = passed;
};

export const setStagingGuardPassed = (passed: boolean): void => {
  stagingGuardPassed = passed;
};

export const setRolloutRing = (ring: RolloutRing): void => {
  rolloutRing = ring;
};

export const setRingProgressionApprovedTo = (ring: RolloutRing): void => {
  approvedRing = ring;
};

export const setRolloutTargetingMode = (mode: RolloutTargetingMode): void => {
  rolloutTargetingMode = mode;
};

export const setRolloutSubjectCohortId = (cohortId: string | null): void => {
  rolloutSubjectCohortId = cohortId;
};

export const setRolloutTargetedCohorts = (cohorts: readonly string[]): void => {
  const normalized = cohorts
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  rolloutTargetedCohorts = Array.from(new Set(normalized));
};

export const setCanaryMinuteEnablementEnabled = (enabled: boolean): void => {
  canaryMinuteEnablementEnabled = enabled;
};

const normalizeRehearsalRecord = (
  result: RehearsalResult,
  recordedAt?: number,
  ring?: RolloutRing | null,
  notes?: string | null,
): RehearsalVerificationRecord => ({
  result,
  recordedAt: typeof recordedAt === "number" && Number.isFinite(recordedAt) ? recordedAt : null,
  ring: ring ?? null,
  notes: notes?.trim() ? notes.trim() : null,
});

export const setKillSwitchRehearsalResult = (
  result: RehearsalResult,
  recordedAt?: number,
  ring?: RolloutRing | null,
  notes?: string | null,
): void => {
  killSwitchRehearsal = normalizeRehearsalRecord(result, recordedAt, ring, notes);
};

export const setRollbackRehearsalResult = (
  result: RehearsalResult,
  recordedAt?: number,
  ring?: RolloutRing | null,
  notes?: string | null,
): void => {
  rollbackRehearsal = normalizeRehearsalRecord(result, recordedAt, ring, notes);
};

export const evaluateRehearsalVerificationState = (): RehearsalVerificationState => ({
  killSwitch: { ...killSwitchRehearsal },
  rollback: { ...rollbackRehearsal },
  bothPassed: killSwitchRehearsal.result === "passed" && rollbackRehearsal.result === "passed",
});

export const evaluateRingProgressionApprovalState = (): RingProgressionApprovalState => {
  const ringOrder: Record<RolloutRing, number> = {
    off: 0,
    internal_dogfood: 1,
    canary: 2,
    partial_production: 3,
    full_production: 4,
  };

  const currentRingLevel = ringOrder[rolloutRing];
  const approvedRingLevel = ringOrder[approvedRing];
  const canProgress = approvedRingLevel >= currentRingLevel;

  return {
    currentRing: rolloutRing,
    approvedRing,
    canProgress,
  };
};

export const evaluateMinuteCanaryEnablementDecision = (): MinuteCanaryEnablementDecision => {
  const authorityFlipGate = evaluateAuthorityFlipGate();
  const rolloutControl = evaluateRolloutControlState();
  const ringProgression = evaluateRingProgressionApprovalState();
  const rehearsalVerification = evaluateRehearsalVerificationState();
  const blockers: MinuteCanaryEnablementBlocker[] = [];

  if (!canaryMinuteEnablementEnabled) {
    blockers.push("canary_enablement_flag_off");
  }

  if (requestedMode !== "minute") {
    blockers.push("requested_mode_not_minute");
  }

  if (!authorityFlipGate.eligible) {
    blockers.push("authority_flip_gate_blocked");
  }

  if (!rolloutControl.eligible) {
    blockers.push("rollout_control_blocked");
  }

  if (!ringProgression.canProgress) {
    blockers.push("ring_progression_not_approved");
  }

  if (!rehearsalVerification.bothPassed) {
    blockers.push("rehearsal_verification_not_passed");
  }

  const canEnableMinuteAuthorityForCohort = blockers.length === 0;

  return {
    requestedMode,
    ring: rolloutControl.ring,
    subjectCohortId: rolloutControl.subjectCohortId,
    canaryEnablementFlag: canaryMinuteEnablementEnabled,
    authorityFlipEligible: authorityFlipGate.eligible,
    rolloutEligible: rolloutControl.eligible,
    rehearsalsPassed: rehearsalVerification.bothPassed,
    effectiveMode: canEnableMinuteAuthorityForCohort ? "minute" : "slot",
    canEnableMinuteAuthorityForCohort,
    blockers,
  };
};

export const evaluateAuthorityFlipGate = (): AuthorityFlipGateReport => {
  const blockers: AuthorityFlipGateBlocker[] = [];

  if (requestedMode !== "minute") {
    blockers.push("requested_mode_not_minute");
  }

  if (killSwitchForceSlot) {
    blockers.push("kill_switch_forced_slot");
  }

  if (!parityGatePassed) {
    blockers.push("parity_gate_not_passed");
  }

  if (!readinessBenchmarkPassed) {
    blockers.push("readiness_benchmark_not_passed");
  }

  if (!persistencePurityPassed) {
    blockers.push("persistence_purity_not_passed");
  }

  if (!stagingGuardPassed) {
    blockers.push("staging_guard_not_passed");
  }

  return {
    requestedMode,
    killSwitchForceSlot,
    parityGatePassed,
    readinessBenchmarkPassed,
    persistencePurityPassed,
    stagingGuardPassed,
    eligible: blockers.length === 0,
    blockers,
  };
};

export const evaluateRolloutControlState = (): RolloutControlState => {
  const blockers: RolloutControlBlocker[] = [];

  if (rolloutRing === "off") {
    blockers.push("ring_not_enabled");
  }

  let cohortMatched = true;
  if (rolloutTargetingMode === "cohort_allowlist") {
    if (rolloutTargetedCohorts.length === 0) {
      blockers.push("cohort_allowlist_empty");
      cohortMatched = false;
    } else {
      cohortMatched =
        rolloutSubjectCohortId != null && rolloutTargetedCohorts.includes(rolloutSubjectCohortId);
      if (!cohortMatched) {
        blockers.push("cohort_not_targeted");
      }
    }
  }

  return {
    ring: rolloutRing,
    targetingMode: rolloutTargetingMode,
    subjectCohortId: rolloutSubjectCohortId,
    targetedCohorts: [...rolloutTargetedCohorts],
    cohortMatched,
    eligible: blockers.length === 0,
    blockers,
  };
};

export const recordPrimaryDuration = (durationMs: number): void => {
  pushDurationSample(primaryDurationsMs, durationMs);
};

export const recordShadowDuration = (durationMs: number): void => {
  pushDurationSample(shadowDurationsMs, durationMs);
};

export const recordPrimaryRequestBuildDuration = (durationMs: number): void => {
  pushDurationSample(primaryRequestBuildDurationsMs, durationMs);
};

export const recordPrimaryEngineExecDuration = (durationMs: number): void => {
  pushDurationSample(primaryEngineExecDurationsMs, durationMs);
};

export const recordPrimaryProjectionDuration = (durationMs: number): void => {
  pushDurationSample(primaryProjectionDurationsMs, durationMs);
};

export const recordShadowRequestBuildDuration = (durationMs: number): void => {
  pushDurationSample(shadowRequestBuildDurationsMs, durationMs);
};

export const recordShadowEngineExecDuration = (durationMs: number): void => {
  pushDurationSample(shadowEngineExecDurationsMs, durationMs);
};

export const recordShadowFailure = (): void => {
  shadowFailures += 1;
};

export const recordMismatchCategories = (
  summary: Readonly<Record<ParityMismatchCategory, number>>,
): void => {
  mismatchCategories.true_regression += summary.true_regression;
  mismatchCategories.expected_precision_improvement += summary.expected_precision_improvement;
  mismatchCategories.known_slot_minute_divergence += summary.known_slot_minute_divergence;
  mismatchCategories.comparator_tolerance_policy_gap += summary.comparator_tolerance_policy_gap;
};

export const recordShadowComparisonReport = (
  report: ShadowComparisonReadinessReport,
): void => {
  shadowComparisonRuns += 1;
  latestShadowComparison = report;

  if (report.divergencesDueToPerTaskCalendar) {
    expectedShadowDivergenceRuns += 1;
  }

  if (report.hasUnexplainedDivergences) {
    unexplainedShadowDivergenceRuns += 1;
  }

  if (report.singleCalendarParity) {
    singleCalendarParityRuns += 1;
    if (report.hasUnexplainedDivergences) {
      singleCalendarParityViolationRuns += 1;
    }
  }
};

export const getCutoverTelemetrySnapshot = (): CutoverTelemetrySnapshot => ({
  primaryRuns: primaryDurationsMs.length,
  shadowRuns: shadowDurationsMs.length,
  shadowFailures,
  mismatchCategories: { ...mismatchCategories },
  primaryP95Ms: percentile95(primaryDurationsMs),
  shadowP95Ms: percentile95(shadowDurationsMs),
  primaryRequestBuildP95Ms: percentile95(primaryRequestBuildDurationsMs),
  primaryEngineExecP95Ms: percentile95(primaryEngineExecDurationsMs),
  primaryProjectionP95Ms: percentile95(primaryProjectionDurationsMs),
  shadowRequestBuildP95Ms: percentile95(shadowRequestBuildDurationsMs),
  shadowEngineExecP95Ms: percentile95(shadowEngineExecDurationsMs),
  primaryRequestBuildRuns: primaryRequestBuildDurationsMs.length,
  primaryEngineExecRuns: primaryEngineExecDurationsMs.length,
  primaryProjectionRuns: primaryProjectionDurationsMs.length,
  shadowRequestBuildRuns: shadowRequestBuildDurationsMs.length,
  shadowEngineExecRuns: shadowEngineExecDurationsMs.length,
  shadowComparisonRuns,
  latestShadowComparison,
  expectedShadowDivergenceRuns,
  unexplainedShadowDivergenceRuns,
  singleCalendarParityRuns,
  singleCalendarParityViolationRuns,
});

export const _resetCutoverReadinessGate = (): void => {
  requestedMode = "slot";
  killSwitchForceSlot = true;
  parityGatePassed = false;
  readinessBenchmarkPassed = false;
  persistencePurityPassed = false;
  stagingGuardPassed = false;
  rolloutRing = "off";
  approvedRing = "off";
  rolloutTargetingMode = "all";
  rolloutSubjectCohortId = null;
  rolloutTargetedCohorts = [];
  canaryMinuteEnablementEnabled = false;
  killSwitchRehearsal = {
    result: "not_run",
    recordedAt: null,
    ring: null,
    notes: null,
  };
  rollbackRehearsal = {
    result: "not_run",
    recordedAt: null,
    ring: null,
    notes: null,
  };
  primaryDurationsMs.splice(0, primaryDurationsMs.length);
  shadowDurationsMs.splice(0, shadowDurationsMs.length);
  primaryRequestBuildDurationsMs.splice(0, primaryRequestBuildDurationsMs.length);
  primaryEngineExecDurationsMs.splice(0, primaryEngineExecDurationsMs.length);
  primaryProjectionDurationsMs.splice(0, primaryProjectionDurationsMs.length);
  shadowRequestBuildDurationsMs.splice(0, shadowRequestBuildDurationsMs.length);
  shadowEngineExecDurationsMs.splice(0, shadowEngineExecDurationsMs.length);
  shadowFailures = 0;
  shadowComparisonRuns = 0;
  expectedShadowDivergenceRuns = 0;
  unexplainedShadowDivergenceRuns = 0;
  singleCalendarParityRuns = 0;
  singleCalendarParityViolationRuns = 0;
  latestShadowComparison = null;
  mismatchCategories.true_regression = 0;
  mismatchCategories.expected_precision_improvement = 0;
  mismatchCategories.known_slot_minute_divergence = 0;
  mismatchCategories.comparator_tolerance_policy_gap = 0;
};
