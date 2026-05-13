import type {
    TemporalAuthorityRolloutRing,
    TemporalCandidateProjection,
    TemporalCandidateProjectionBlockedReason,
    TemporalCandidateProjectionGateDecision,
    TemporalCandidateProjectionGateInput,
} from "@planner/protocol";

const DEFAULT_ALLOWED_ROLLOUT_RINGS: readonly TemporalAuthorityRolloutRing[] = [
  "internal_test",
  "dogfood",
  "uat",
  "production",
];

export const evaluateTemporalCandidateProjectionGate = (
  input: TemporalCandidateProjectionGateInput,
): TemporalCandidateProjectionGateDecision => {
  const rolloutRingAllowed =
    input.rolloutRing !== "off" && DEFAULT_ALLOWED_ROLLOUT_RINGS.includes(input.rolloutRing);

  if (!input.temporalCandidateProjectionEnabled || !rolloutRingAllowed) {
    return {
      allowed: false,
      blockedReason: "candidate_projection_flag_disabled",
      rolloutRingAllowed,
    };
  }

  if (input.temporalAuthorityEmergencyRollback) {
    return {
      allowed: false,
      blockedReason: "emergency_rollback_active",
      rolloutRingAllowed,
    };
  }

  if (!input.realWasmValidationPassed) {
    return {
      allowed: false,
      blockedReason: "real_wasm_gate_not_passed",
      rolloutRingAllowed,
    };
  }

  if (input.sourceProtectionStatus !== "ok") {
    return {
      allowed: false,
      blockedReason: "source_protection_not_ok",
      rolloutRingAllowed,
    };
  }

  if (input.unexplainedDivergenceTaskIds.length > 0) {
    return {
      allowed: false,
      blockedReason: "unexplained_divergence_present",
      rolloutRingAllowed,
    };
  }

  if (!input.projectFeatureProfileSupported || input.unsupportedFeatureFlags.length > 0) {
    return {
      allowed: false,
      blockedReason: "unsupported_project_feature_profile",
      rolloutRingAllowed,
    };
  }

  if (!input.temporalEngineAvailable) {
    return {
      allowed: false,
      blockedReason: "temporal_engine_unavailable",
      rolloutRingAllowed,
    };
  }

  return {
    allowed: true,
    blockedReason: null,
    rolloutRingAllowed,
  };
};

export const createBlockedTemporalCandidateProjection = (
  params: {
    candidateRunId: string;
    blockedReason: TemporalCandidateProjectionBlockedReason;
    unsupportedFeatureFlags?: readonly string[];
    unexplainedDivergenceTaskIds?: readonly string[];
    expectedDivergenceTaskIds?: readonly string[];
    temporalExecutionErrors?: readonly string[];
    gateReqId?: string | null;
    realWasmValidationPassedAtRun: boolean;
    wasmLoadModeAtRun: "real" | "unavailable" | "mocked";
    calculatedAt?: number;
  },
): TemporalCandidateProjection => ({
  candidateRunId: params.candidateRunId,
  engine: "temporal",
  calculatedAt: params.calculatedAt ?? Date.now(),
  performanceMs: null,
  realWasmGateReference: {
    gateReqId: params.gateReqId ?? null,
    gateVersion: 1,
    realWasmValidationPassedAtRun: params.realWasmValidationPassedAtRun,
    wasmLoadModeAtRun: params.wasmLoadModeAtRun,
  },
  candidateTasks: [],
  candidateSummary: null,
  diagnostics: {
    candidateProjectionAvailable: false,
    candidateProjectionBlockedReason: params.blockedReason,
    unsupportedFeatureFlags: [...(params.unsupportedFeatureFlags ?? [])],
    temporalExecutionErrors: [...(params.temporalExecutionErrors ?? [])],
    unexplainedDivergenceTaskIds: [...(params.unexplainedDivergenceTaskIds ?? [])],
    expectedDivergenceTaskIds: [...(params.expectedDivergenceTaskIds ?? [])],
  },
  comparison: null,
});
