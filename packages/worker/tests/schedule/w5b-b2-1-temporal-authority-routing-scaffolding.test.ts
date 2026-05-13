import { describe, expect, it } from "vitest";
import {
    decideScheduleAuthorityRoute,
    makeDefaultTemporalAuthorityRoutingInput,
} from "../../src/schedule/TemporalAuthorityRoutingScaffold.js";

describe("W5B-B2.1 temporal authority routing scaffolding", () => {
  it("A. defaults to slot when routing is disabled", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: false,
          temporalAuthorityRolloutRing: "off",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: false,
        },
      }),
    );

    expect(decision.mode).toBe("slot_authoritative");
    expect(decision.fallbackReason).toBe("feature_disabled");
    expect(decision.temporalAuthorityCandidate).toBe(false);
  });

  it("B. emergency rollback wins", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: true,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("emergency_rollback");
    expect(decision.diagnostics.emergencyRollbackActive).toBe(true);
  });

  it("C. rollout ring off denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "off",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("rollout_ring_off");
  });

  it("D. missing shadow evidence denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        readinessReport: null,
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("shadow_evidence_missing");
  });

  it("E. unexplained divergence denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        readinessReport: {
          hasUnexplainedDivergences: true,
          tasksCompared: 2,
          unexplainedDivergenceTaskIds: ["T2"],
          maxStartVarianceMs: 10,
          maxFinishVarianceMs: 12,
          maxFloatVarianceMs: 8,
        },
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("unexplained_divergence");
    expect(decision.diagnostics.unexplainedDivergenceTaskIds).toEqual(["T2"]);
  });

  it("F. unsupported resource calendar requirement denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        unsupportedCalendarFeatureFlags: ["resource_calendar_required"],
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("unsupported_calendar_feature");
  });

  it("G. unsupported lag calendar requirement denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        unsupportedCalendarFeatureFlags: ["lag_calendar_required"],
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("unsupported_dependency_or_lag_mode");
  });

  it("H. source protection violation denies temporal", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "internal_test",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        sourceProtectionStatus: "violated",
      }),
    );

    expect(decision.mode).toBe("slot_fallback");
    expect(decision.fallbackReason).toBe("source_protection_violation");
  });

  it("I. happy path can select temporal authoritative only in test config", () => {
    const decision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "dogfood",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        readinessReport: {
          hasUnexplainedDivergences: false,
          tasksCompared: 2,
          unexplainedDivergenceTaskIds: [],
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          maxFloatVarianceMs: 0,
        },
        unsupportedCalendarFeatureFlags: [],
        unsupportedDependencyOrLagModeDetected: false,
        sourceProtectionStatus: "ok",
        performanceThresholdPassed: true,
        placeholderGatePassed: true,
      }),
    );

    expect(decision.mode).toBe("temporal_authoritative");
    expect(decision.temporalAuthorityCandidate).toBe(true);
    expect(decision.fallbackReason).toBeNull();
    expect(decision.diagnostics.projectionApplied).toBe(false);
  });

  it("J. UAT and production blocked without real WASM validation", () => {
    const uatDecision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "uat",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        realWasmValidationPassed: false,
      }),
    );

    const prodDecision = decideScheduleAuthorityRoute(
      makeDefaultTemporalAuthorityRoutingInput({
        config: {
          temporalAuthorityRoutingEnabled: true,
          temporalAuthorityRolloutRing: "production",
          temporalAuthorityEmergencyRollback: false,
          temporalShadowExecutionEnabled: true,
          allowTemporalAuthorityInTests: true,
        },
        realWasmValidationPassed: false,
      }),
    );

    expect(uatDecision.mode).toBe("slot_fallback");
    expect(uatDecision.fallbackReason).toBe("gate_failed");
    expect(prodDecision.mode).toBe("slot_fallback");
    expect(prodDecision.fallbackReason).toBe("gate_failed");
  });
});
