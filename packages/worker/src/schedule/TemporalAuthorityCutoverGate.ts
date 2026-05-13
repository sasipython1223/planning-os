import type {
    TemporalAuthorityCutoverDecision,
    TemporalAuthorityCutoverFallbackReason,
    TemporalAuthorityCutoverGateInput,
    TemporalAuthorityCutoverGatePassMatrix,
    TemporalAuthorityEngineMode,
} from "@planner/protocol";

const PRECHECK_BLOCKERS: ReadonlySet<TemporalAuthorityCutoverFallbackReason> = new Set([
  "rollout_ring_off",
  "temporal_authority_disabled",
]);

const pushBlockedReason = (
  blockedReasons: TemporalAuthorityCutoverFallbackReason[],
  reason: TemporalAuthorityCutoverFallbackReason,
): void => {
  if (!blockedReasons.includes(reason)) {
    blockedReasons.push(reason);
  }
};

const pickPrimaryBlockedReason = (
  blockedReasons: readonly TemporalAuthorityCutoverFallbackReason[],
): TemporalAuthorityCutoverFallbackReason | null => blockedReasons[0] ?? null;

const hasOnlyPrecheckBlockers = (
  blockedReasons: readonly TemporalAuthorityCutoverFallbackReason[],
): boolean => blockedReasons.length > 0 && blockedReasons.every((reason) => PRECHECK_BLOCKERS.has(reason));

const computeGatePassMatrix = (input: TemporalAuthorityCutoverGateInput): TemporalAuthorityCutoverGatePassMatrix => {
  const realWasmGate =
    !input.realWasmGateRequired
    || (input.realWasmValidationPassed && input.wasmLoadMode === "real");
  const candidateComparisonPresent =
    !input.candidateComparisonRequired || input.candidateComparisonPresent;
  const performanceWithinThreshold =
    input.performanceThresholdMs == null
    || input.performanceMs == null
    || input.performanceMs <= input.performanceThresholdMs;

  return {
    rolloutRingEnabled: input.temporalAuthorityRolloutRing !== "off",
    temporalAuthorityEnabled: input.temporalAuthorityEnabled,
    emergencyRollbackClear: !input.temporalAuthorityEmergencyRollback,
    realWasmGate,
    candidateProjectionAvailable: input.candidateProjectionAvailable,
    candidateComparisonPresent,
    candidateAuthorityPrecondition: !input.candidateAuthorityAppliedPreApply,
    temporalExecutionErrorFree: input.temporalExecutionErrors.length === 0,
    unexplainedDivergenceWithinTolerance:
      input.unexplainedDivergenceCount <= input.unexplainedDivergenceTolerance,
    sourceProtectionValid: input.sourceProtectionStatus === "ok",
    unsupportedFeatureFlagsAllowed: input.unsupportedFeatureFlags.length === 0,
    projectEligibilityProfileSupported:
      !input.supportedProjectProfileRequired || input.projectEligibilityProfileSupported,
    resourceCalendarRequirementSupported: !input.resourceCalendarRequirementDetected,
    lagCalendarRequirementSupported: !input.lagCalendarRequirementDetected,
    p6SemanticsRequirementSupported: !input.p6SemanticsRequirementDetected,
    performanceWithinThreshold,
    lifecycleSafetyValid: input.lifecycleSafetyPassed !== false,
  };
};

const buildBlockedReasons = (
  input: TemporalAuthorityCutoverGateInput,
  gatePassMatrix: TemporalAuthorityCutoverGatePassMatrix,
): TemporalAuthorityCutoverFallbackReason[] => {
  const blockedReasons: TemporalAuthorityCutoverFallbackReason[] = [];

  if (!gatePassMatrix.rolloutRingEnabled) {
    pushBlockedReason(blockedReasons, "rollout_ring_off");
  }
  if (!gatePassMatrix.temporalAuthorityEnabled) {
    pushBlockedReason(blockedReasons, "temporal_authority_disabled");
  }
  if (!gatePassMatrix.emergencyRollbackClear) {
    pushBlockedReason(blockedReasons, "emergency_rollback_active");
  }
  if (!gatePassMatrix.realWasmGate) {
    pushBlockedReason(blockedReasons, "real_wasm_gate_not_passed");
  }
  if (!input.temporalCandidateProjectionEnabled || !gatePassMatrix.candidateProjectionAvailable) {
    pushBlockedReason(blockedReasons, "candidate_projection_unavailable");
  }
  if (!gatePassMatrix.candidateComparisonPresent) {
    pushBlockedReason(blockedReasons, "candidate_comparison_missing");
  }
  if (!gatePassMatrix.candidateAuthorityPrecondition) {
    pushBlockedReason(blockedReasons, "candidate_authority_precondition_failed");
  }
  if (!gatePassMatrix.temporalExecutionErrorFree) {
    pushBlockedReason(blockedReasons, "temporal_execution_error");
  }
  if (!gatePassMatrix.unexplainedDivergenceWithinTolerance) {
    pushBlockedReason(blockedReasons, "unexplained_divergence_over_threshold");
  }
  if (!gatePassMatrix.sourceProtectionValid) {
    pushBlockedReason(blockedReasons, "source_protection_not_ok");
  }
  if (!gatePassMatrix.unsupportedFeatureFlagsAllowed) {
    pushBlockedReason(blockedReasons, "unsupported_feature_detected");
  }
  if (!gatePassMatrix.projectEligibilityProfileSupported) {
    pushBlockedReason(blockedReasons, "unsupported_project_profile");
  }
  if (!gatePassMatrix.resourceCalendarRequirementSupported) {
    pushBlockedReason(blockedReasons, "resource_calendar_not_supported");
  }
  if (!gatePassMatrix.lagCalendarRequirementSupported) {
    pushBlockedReason(blockedReasons, "lag_calendar_not_supported");
  }
  if (!gatePassMatrix.p6SemanticsRequirementSupported) {
    pushBlockedReason(blockedReasons, "p6_semantics_not_supported");
  }
  if (!gatePassMatrix.performanceWithinThreshold) {
    pushBlockedReason(blockedReasons, "performance_threshold_exceeded");
  }
  if (!gatePassMatrix.lifecycleSafetyValid) {
    pushBlockedReason(blockedReasons, "lifecycle_safety_failed");
  }

  return blockedReasons;
};

const makeDecision = (
  input: TemporalAuthorityCutoverGateInput,
  authorityEngineMode: TemporalAuthorityEngineMode,
  allowed: boolean,
  fallbackRequired: boolean,
  blockedReasons: TemporalAuthorityCutoverFallbackReason[],
  gatePassMatrix: TemporalAuthorityCutoverGatePassMatrix,
): TemporalAuthorityCutoverDecision => ({
  authorityEngineMode,
  requestedAuthorityEngineMode: input.requestedAuthorityEngineMode,
  rolloutRing: input.temporalAuthorityRolloutRing,
  allowed,
  fallbackRequired,
  fallbackReason: pickPrimaryBlockedReason(blockedReasons),
  blockedReasons,
  gatePassMatrix,
  emergencyRollbackActive: input.temporalAuthorityEmergencyRollback,
  sourceProtectionStatus: input.sourceProtectionStatus,
  realWasmGateStatus: {
    required: input.realWasmGateRequired,
    passed: gatePassMatrix.realWasmGate,
    wasmLoadMode: input.wasmLoadMode,
  },
  candidateProjectionStatus: {
    candidateProjectionEnabled: input.temporalCandidateProjectionEnabled,
    available: input.candidateProjectionAvailable,
  },
  comparisonStatus: {
    required: input.candidateComparisonRequired,
    present: input.candidateComparisonPresent,
  },
  unsupportedFeatureFlags: [...input.unsupportedFeatureFlags],
  unexplainedDivergenceCount: input.unexplainedDivergenceCount,
  performanceMs: input.performanceMs,
  authorityApplied: false,
});

export const evaluateTemporalAuthorityCutoverGate = (
  input: TemporalAuthorityCutoverGateInput,
): TemporalAuthorityCutoverDecision => {
  const gatePassMatrix = computeGatePassMatrix(input);

  // Slot request is always safe/default in B2.5A control-plane decisions.
  if (input.requestedAuthorityEngineMode === "slot_authoritative") {
    return makeDecision(input, "slot_authoritative", true, false, [], gatePassMatrix);
  }

  // Emergency rollback dominates all other signals.
  if (input.temporalAuthorityEmergencyRollback) {
    return makeDecision(
      input,
      "slot_fallback",
      false,
      true,
      ["emergency_rollback_active"],
      gatePassMatrix,
    );
  }

  // Candidate-only mode is decision-only and never applies authority.
  if (input.requestedAuthorityEngineMode === "temporal_candidate_only") {
    if (!input.temporalCandidateProjectionEnabled) {
      return makeDecision(
        input,
        "slot_authoritative",
        false,
        false,
        ["candidate_projection_unavailable"],
        gatePassMatrix,
      );
    }

    return makeDecision(input, "temporal_candidate_only", true, false, [], gatePassMatrix);
  }

  const blockedReasons = buildBlockedReasons(input, gatePassMatrix);

  if (blockedReasons.length > 0) {
    if (
      hasOnlyPrecheckBlockers(blockedReasons)
      || blockedReasons.some((reason) => PRECHECK_BLOCKERS.has(reason))
    ) {
      return makeDecision(input, "slot_authoritative", false, false, blockedReasons, gatePassMatrix);
    }

    return makeDecision(input, "slot_fallback", false, true, blockedReasons, gatePassMatrix);
  }

  // B2.5A is decision-only: returning an allowed temporal_authoritative decision
  // must not apply authority, mutate state, or emit DIFF_STATE.
  return makeDecision(input, "temporal_authoritative", true, false, [], gatePassMatrix);
};

export const createDefaultTemporalAuthorityCutoverGateInput = (): TemporalAuthorityCutoverGateInput => ({
  temporalAuthorityEnabled: false,
  temporalCandidateProjectionEnabled: false,
  temporalAuthorityRolloutRing: "off",
  temporalAuthorityEmergencyRollback: false,
  requestedAuthorityEngineMode: "temporal_authoritative",
  candidateComparisonRequired: true,
  realWasmGateRequired: true,
  unexplainedDivergenceTolerance: 0,
  supportedProjectProfileRequired: true,
  temporalAuthorityPersistenceEnabled: false,
  realWasmValidationPassed: false,
  wasmLoadMode: "unavailable",
  candidateProjectionAvailable: false,
  candidateComparisonPresent: false,
  candidateAuthorityAppliedPreApply: false,
  temporalExecutionErrors: [],
  unexplainedDivergenceCount: 0,
  sourceProtectionStatus: "blocked",
  unsupportedFeatureFlags: [],
  projectEligibilityProfileSupported: false,
  resourceCalendarRequirementDetected: false,
  lagCalendarRequirementDetected: false,
  p6SemanticsRequirementDetected: false,
  performanceMs: null,
  performanceThresholdMs: null,
  lifecycleSafetyPassed: true,
});
