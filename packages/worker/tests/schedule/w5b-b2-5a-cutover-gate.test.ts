import { describe, expect, it } from "vitest";
import {
    createDefaultTemporalAuthorityCutoverGateInput,
    evaluateTemporalAuthorityCutoverGate,
} from "../../src/schedule/TemporalAuthorityCutoverGate.js";

describe("W5B-B2.5A temporal authority cutover gate evaluator", () => {
  it("1) default config remains slot-safe and not allowed for temporal_authoritative", () => {
    const decision = evaluateTemporalAuthorityCutoverGate(
      createDefaultTemporalAuthorityCutoverGateInput(),
    );

    expect(decision.authorityEngineMode).toBe("slot_authoritative");
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReasons).toContain("rollout_ring_off");
    expect(decision.blockedReasons).toContain("temporal_authority_disabled");
    expect(decision.authorityApplied).toBe(false);
  });

  it("2) ring off blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "off",
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_authoritative");
    expect(decision.allowed).toBe(false);
    expect(decision.fallbackReason).toBe("rollout_ring_off");
  });

  it("3) real wasm gate required but not passed blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: false,
      wasmLoadMode: "mocked",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReasons).toContain("real_wasm_gate_not_passed");
  });

  it("4) emergency rollback wins over all other checks", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "production",
      temporalAuthorityEmergencyRollback: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.allowed).toBe(false);
    expect(decision.fallbackReason).toBe("emergency_rollback_active");
    expect(decision.blockedReasons).toEqual(["emergency_rollback_active"]);
  });

  it("5) missing candidate projection blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      candidateProjectionAvailable: false,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("candidate_projection_unavailable");
  });

  it("6) missing candidate comparison when required blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: false,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("candidate_comparison_missing");
  });

  it("7) candidate authority pre-apply flag blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "uat",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      candidateAuthorityAppliedPreApply: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("candidate_authority_precondition_failed");
  });

  it("8) temporal execution errors force fallback", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "uat",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      temporalExecutionErrors: ["panic"],
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("temporal_execution_error");
  });

  it("9) unexplained divergence above tolerance blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      unexplainedDivergenceTolerance: 0,
      unexplainedDivergenceCount: 2,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("unexplained_divergence_over_threshold");
  });

  it("10) source protection not ok blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "blocked",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("source_protection_not_ok");
  });

  it("11) unsupported feature flags block temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: ["lag_calendar_mode_not_supported"],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("unsupported_feature_detected");
  });

  it("12) unsupported project profile blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: false,
      unsupportedFeatureFlags: [],
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("unsupported_project_profile");
  });

  it("13) resource calendar requirement detected blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "uat",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      resourceCalendarRequirementDetected: true,
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("resource_calendar_not_supported");
  });

  it("14) lag calendar requirement detected blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "uat",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      lagCalendarRequirementDetected: true,
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("lag_calendar_not_supported");
  });

  it("15) p6 semantics requirement detected blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "uat",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      p6SemanticsRequirementDetected: true,
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("p6_semantics_not_supported");
  });

  it("16) performance threshold exceeded blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "production",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      performanceMs: 120,
      performanceThresholdMs: 50,
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("performance_threshold_exceeded");
  });

  it("17) all gates pass allows temporal_authoritative decision without applying authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "production",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      unexplainedDivergenceTolerance: 0,
      unexplainedDivergenceCount: 0,
      performanceMs: 30,
      performanceThresholdMs: 50,
      lifecycleSafetyPassed: true,
    });

    expect(decision.authorityEngineMode).toBe("temporal_authoritative");
    expect(decision.allowed).toBe(true);
    expect(decision.fallbackRequired).toBe(false);
    expect(decision.blockedReasons).toEqual([]);
    expect(decision.authorityApplied).toBe(false);
  });

  it("18) lifecycle safety failure blocks temporal authority", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      temporalAuthorityEnabled: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      sourceProtectionStatus: "ok",
      projectEligibilityProfileSupported: true,
      unsupportedFeatureFlags: [],
      lifecycleSafetyPassed: false,
    });

    expect(decision.authorityEngineMode).toBe("slot_fallback");
    expect(decision.blockedReasons).toContain("lifecycle_safety_failed");
  });

  it("19) candidate-only mode can be allowed without authority application", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      requestedAuthorityEngineMode: "temporal_candidate_only",
      temporalCandidateProjectionEnabled: true,
    });

    expect(decision.authorityEngineMode).toBe("temporal_candidate_only");
    expect(decision.allowed).toBe(true);
    expect(decision.fallbackRequired).toBe(false);
    expect(decision.authorityApplied).toBe(false);
  });

  it("20) slot-authoritative request remains allowed and safe default", () => {
    const decision = evaluateTemporalAuthorityCutoverGate({
      ...createDefaultTemporalAuthorityCutoverGateInput(),
      requestedAuthorityEngineMode: "slot_authoritative",
      temporalAuthorityEmergencyRollback: true,
    });

    expect(decision.authorityEngineMode).toBe("slot_authoritative");
    expect(decision.allowed).toBe(true);
    expect(decision.fallbackRequired).toBe(false);
    expect(decision.authorityApplied).toBe(false);
  });
});
