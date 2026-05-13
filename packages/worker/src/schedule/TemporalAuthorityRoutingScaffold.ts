export type ScheduleAuthorityEngineMode =
  | "slot_authoritative"
  | "temporal_shadow_only"
  | "temporal_authoritative"
  | "slot_fallback";

export type TemporalAuthorityRolloutRing =
  | "off"
  | "internal_test"
  | "dogfood"
  | "uat"
  | "production";

export type TemporalAuthorityFallbackReason =
  | "feature_disabled"
  | "rollout_ring_off"
  | "emergency_rollback"
  | "gate_failed"
  | "shadow_evidence_missing"
  | "unexplained_divergence"
  | "temporal_execution_error"
  | "temporal_result_incomplete"
  | "calendar_resolution_failure"
  | "unsupported_calendar_feature"
  | "unsupported_dependency_or_lag_mode"
  | "source_protection_violation"
  | "performance_threshold_exceeded";

export type TemporalAuthorityRoutingConfig = {
  readonly temporalAuthorityRoutingEnabled: boolean;
  readonly temporalAuthorityRolloutRing: TemporalAuthorityRolloutRing;
  readonly temporalAuthorityEmergencyRollback: boolean;
  readonly temporalShadowExecutionEnabled: boolean;
  /**
   * B2.1 safety override for tests only. Keep false in normal environments.
   */
  readonly allowTemporalAuthorityInTests?: boolean;
};

export type TemporalSourceProtectionStatus = "ok" | "violated" | "unknown" | "blocked" | "not_evaluated_wasm_unavailable";

export type TemporalAuthorityReadinessSnapshot = {
  readonly hasUnexplainedDivergences: boolean;
  readonly tasksCompared: number;
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly maxStartVarianceMs: number;
  readonly maxFinishVarianceMs: number;
  readonly maxFloatVarianceMs: number;
};

export type TemporalAuthorityGatePassMatrix = {
  readonly shadowEvidenceAvailable: boolean;
  readonly noUnexplainedDivergences: boolean;
  readonly sourceProtectionValid: boolean;
  readonly supportedCalendarFeatureProfile: boolean;
  readonly supportedDependencyLagMode: boolean;
  readonly performanceWithinThreshold: boolean;
  readonly realWasmValidationPassed: boolean;
  readonly eligibilityProfileSupported: boolean;
};

export type TemporalAuthorityRoutingInput = {
  readonly config: TemporalAuthorityRoutingConfig;
  readonly readinessReport: TemporalAuthorityReadinessSnapshot | null;
  readonly unsupportedCalendarFeatureFlags: readonly string[];
  readonly unsupportedDependencyOrLagModeDetected: boolean;
  readonly sourceProtectionStatus: TemporalSourceProtectionStatus;
  readonly performanceThresholdPassed: boolean;
  readonly realWasmValidationPassed: boolean;
  /** Conservative placeholder gate for B2.1. */
  readonly placeholderGatePassed: boolean;
  readonly projectEligibilityProfile: string;
  readonly temporalRunId: string | null;
  readonly shadowReadinessReportId: string | null;
};

export type TemporalAuthorityRoutingDiagnostics = {
  readonly authorityEngineUsed: ScheduleAuthorityEngineMode;
  readonly fallbackReason: TemporalAuthorityFallbackReason | null;
  readonly temporalRunId: string | null;
  readonly shadowReadinessReportId: string | null;
  readonly tasksCompared: number;
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly maxStartVarianceMs: number;
  readonly maxFinishVarianceMs: number;
  readonly maxFloatVarianceMs: number;
  readonly unsupportedCalendarFeatureFlags: readonly string[];
  readonly sourceProtectionStatus: TemporalSourceProtectionStatus;
  readonly rolloutRing: TemporalAuthorityRolloutRing;
  readonly authorityDecisionVersion: "w5b-b2-1";
  readonly gatePassMatrix: TemporalAuthorityGatePassMatrix;
  readonly temporalExecutionDurationMs: number | null;
  readonly slotExecutionDurationMs: number | null;
  readonly projectionApplied: boolean;
  readonly emergencyRollbackActive: boolean;
  readonly projectEligibilityProfile: string;
};

export type ScheduleAuthorityDecision = {
  readonly mode: ScheduleAuthorityEngineMode;
  readonly fallbackReason: TemporalAuthorityFallbackReason | null;
  readonly temporalAuthorityCandidate: boolean;
  readonly diagnostics: TemporalAuthorityRoutingDiagnostics;
};

export const DEFAULT_TEMPORAL_AUTHORITY_ROUTING_CONFIG: TemporalAuthorityRoutingConfig = {
  temporalAuthorityRoutingEnabled: false,
  temporalAuthorityRolloutRing: "off",
  temporalAuthorityEmergencyRollback: false,
  temporalShadowExecutionEnabled: true,
  allowTemporalAuthorityInTests: false,
};

const createGateMatrix = (input: TemporalAuthorityRoutingInput): TemporalAuthorityGatePassMatrix => {
  const readiness = input.readinessReport;
  return {
    shadowEvidenceAvailable: readiness != null,
    noUnexplainedDivergences: readiness != null && !readiness.hasUnexplainedDivergences,
    sourceProtectionValid: input.sourceProtectionStatus === "ok",
    supportedCalendarFeatureProfile:
      !input.unsupportedCalendarFeatureFlags.includes("resource_calendar_required") &&
      !input.unsupportedCalendarFeatureFlags.includes("lag_calendar_required"),
    supportedDependencyLagMode: !input.unsupportedDependencyOrLagModeDetected,
    performanceWithinThreshold: input.performanceThresholdPassed,
    realWasmValidationPassed: input.realWasmValidationPassed,
    eligibilityProfileSupported: input.placeholderGatePassed,
  };
};

const buildDiagnostics = (
  input: TemporalAuthorityRoutingInput,
  mode: ScheduleAuthorityEngineMode,
  fallbackReason: TemporalAuthorityFallbackReason | null,
): TemporalAuthorityRoutingDiagnostics => {
  const readiness = input.readinessReport;
  return {
    authorityEngineUsed: mode,
    fallbackReason,
    temporalRunId: input.temporalRunId,
    shadowReadinessReportId: input.shadowReadinessReportId,
    tasksCompared: readiness?.tasksCompared ?? 0,
    unexplainedDivergenceTaskIds: readiness?.unexplainedDivergenceTaskIds ?? [],
    maxStartVarianceMs: readiness?.maxStartVarianceMs ?? 0,
    maxFinishVarianceMs: readiness?.maxFinishVarianceMs ?? 0,
    maxFloatVarianceMs: readiness?.maxFloatVarianceMs ?? 0,
    unsupportedCalendarFeatureFlags: input.unsupportedCalendarFeatureFlags,
    sourceProtectionStatus: input.sourceProtectionStatus,
    rolloutRing: input.config.temporalAuthorityRolloutRing,
    authorityDecisionVersion: "w5b-b2-1",
    gatePassMatrix: createGateMatrix(input),
    temporalExecutionDurationMs: null,
    slotExecutionDurationMs: null,
    projectionApplied: false,
    emergencyRollbackActive: input.config.temporalAuthorityEmergencyRollback,
    projectEligibilityProfile: input.projectEligibilityProfile,
  };
};

const fallback = (
  input: TemporalAuthorityRoutingInput,
  fallbackReason: TemporalAuthorityFallbackReason,
): ScheduleAuthorityDecision => ({
  mode: "slot_fallback",
  fallbackReason,
  temporalAuthorityCandidate: false,
  diagnostics: buildDiagnostics(input, "slot_fallback", fallbackReason),
});

export const decideScheduleAuthorityRoute = (
  input: TemporalAuthorityRoutingInput,
): ScheduleAuthorityDecision => {
  if (input.config.temporalAuthorityEmergencyRollback) {
    return fallback(input, "emergency_rollback");
  }

  if (!input.config.temporalAuthorityRoutingEnabled) {
    return {
      mode: "slot_authoritative",
      fallbackReason: "feature_disabled",
      temporalAuthorityCandidate: false,
      diagnostics: buildDiagnostics(input, "slot_authoritative", "feature_disabled"),
    };
  }

  if (input.config.temporalAuthorityRolloutRing === "off") {
    return fallback(input, "rollout_ring_off");
  }

  if (input.readinessReport == null) {
    return fallback(input, "shadow_evidence_missing");
  }

  if (input.readinessReport.hasUnexplainedDivergences) {
    return fallback(input, "unexplained_divergence");
  }

  if (input.unsupportedCalendarFeatureFlags.includes("resource_calendar_required")) {
    return fallback(input, "unsupported_calendar_feature");
  }

  if (input.unsupportedCalendarFeatureFlags.includes("lag_calendar_required")) {
    return fallback(input, "unsupported_dependency_or_lag_mode");
  }

  if (input.unsupportedDependencyOrLagModeDetected) {
    return fallback(input, "unsupported_dependency_or_lag_mode");
  }

  if (input.sourceProtectionStatus !== "ok") {
    return fallback(input, "source_protection_violation");
  }

  if (!input.performanceThresholdPassed) {
    return fallback(input, "performance_threshold_exceeded");
  }

  if (!input.placeholderGatePassed) {
    return fallback(input, "gate_failed");
  }

  const ring = input.config.temporalAuthorityRolloutRing;
  if ((ring === "uat" || ring === "production") && !input.realWasmValidationPassed) {
    return fallback(input, "gate_failed");
  }

  const temporalAuthorityAllowedByRing = ring === "internal_test" || ring === "dogfood";
  const temporalAuthorityAllowedByConfig = input.config.allowTemporalAuthorityInTests === true;

  if (temporalAuthorityAllowedByRing && temporalAuthorityAllowedByConfig) {
    return {
      mode: "temporal_authoritative",
      fallbackReason: null,
      temporalAuthorityCandidate: true,
      diagnostics: buildDiagnostics(input, "temporal_authoritative", null),
    };
  }

  if (input.config.temporalShadowExecutionEnabled) {
    return {
      mode: "temporal_shadow_only",
      fallbackReason: null,
      temporalAuthorityCandidate: false,
      diagnostics: buildDiagnostics(input, "temporal_shadow_only", null),
    };
  }

  return {
    mode: "slot_authoritative",
    fallbackReason: "gate_failed",
    temporalAuthorityCandidate: false,
    diagnostics: buildDiagnostics(input, "slot_authoritative", "gate_failed"),
  };
};

export const makeDefaultTemporalAuthorityRoutingInput = (
  overrides: Partial<TemporalAuthorityRoutingInput> = {},
): TemporalAuthorityRoutingInput => ({
  config: DEFAULT_TEMPORAL_AUTHORITY_ROUTING_CONFIG,
  readinessReport: {
    hasUnexplainedDivergences: false,
    tasksCompared: 0,
    unexplainedDivergenceTaskIds: [],
    maxStartVarianceMs: 0,
    maxFinishVarianceMs: 0,
    maxFloatVarianceMs: 0,
  },
  unsupportedCalendarFeatureFlags: [],
  unsupportedDependencyOrLagModeDetected: false,
  sourceProtectionStatus: "ok",
  performanceThresholdPassed: true,
  realWasmValidationPassed: false,
  placeholderGatePassed: true,
  projectEligibilityProfile: "default_supported",
  temporalRunId: null,
  shadowReadinessReportId: null,
  ...overrides,
});
