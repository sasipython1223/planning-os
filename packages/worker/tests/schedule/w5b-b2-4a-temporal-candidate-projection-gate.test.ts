import { describe, expect, it } from "vitest";
import { evaluateTemporalCandidateProjectionGate } from "../../src/schedule/TemporalCandidateProjectionGate.js";

const makeInput = () => ({
  temporalCandidateProjectionEnabled: false,
  temporalAuthorityEmergencyRollback: false,
  realWasmValidationPassed: false,
  sourceProtectionStatus: "blocked" as const,
  unexplainedDivergenceTaskIds: [] as readonly string[],
  unsupportedFeatureFlags: [] as readonly string[],
  projectFeatureProfileSupported: true,
  rolloutRing: "off" as const,
  temporalEngineAvailable: false,
});

describe("W5B-B2.4A temporal candidate projection gate", () => {
  it("blocks by default", () => {
    const decision = evaluateTemporalCandidateProjectionGate(makeInput());

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("candidate_projection_flag_disabled");
  });

  it("blocks when emergency rollback is active", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
      temporalAuthorityEmergencyRollback: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("emergency_rollback_active");
  });

  it("blocks when real WASM validation is not passed", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("real_wasm_gate_not_passed");
  });

  it("blocks when source protection is not ok", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
      realWasmValidationPassed: true,
      sourceProtectionStatus: "violated",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("source_protection_not_ok");
  });

  it("blocks when unexplained divergence exists", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
      realWasmValidationPassed: true,
      sourceProtectionStatus: "ok",
      unexplainedDivergenceTaskIds: ["T-1"],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("unexplained_divergence_present");
  });

  it("blocks when unsupported feature flags are present", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
      realWasmValidationPassed: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: ["resource_calendar_required"],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockedReason).toBe("unsupported_project_feature_profile");
  });

  it("allows candidate projection when all gates pass", () => {
    const decision = evaluateTemporalCandidateProjectionGate({
      ...makeInput(),
      temporalCandidateProjectionEnabled: true,
      rolloutRing: "dogfood",
      realWasmValidationPassed: true,
      sourceProtectionStatus: "ok",
      temporalEngineAvailable: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.blockedReason).toBeNull();
    expect(decision.rolloutRingAllowed).toBe(true);
  });
});
