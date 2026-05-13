import { describe, expect, it } from "vitest";
import {
    buildTemporalAuthorityRoutingInput,
    decideScheduleAuthorityPolicy,
    wasTemporalAuthorityCandidate,
} from "../../src/schedule/ScheduleAuthorityPolicyGate.js";

describe("W5B-B2.2 Schedule Authority Policy Gate + Worker Integration", () => {
  describe("Policy gate integration layer", () => {
    it("A. builds routing input from shadow comparison report", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 10,
          tasksWithStartVariance: 2,
          tasksWithFinishVariance: 1,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 86_400_000,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: false,
        temporalAuthorityRolloutRing: "off",
        temporalAuthorityEmergencyRollback: false,
      });

      expect(input.readinessReport).not.toBeNull();
      expect(input.readinessReport?.tasksCompared).toBe(10);
      expect(input.readinessReport?.hasUnexplainedDivergences).toBe(false);
    });

    it("B. decides slot_authoritative by default (B2.2 mode)", () => {
      const input = buildTemporalAuthorityRoutingInput({
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: false,
        temporalAuthorityRolloutRing: "off",
        temporalAuthorityEmergencyRollback: false,
      });

      const decision = decideScheduleAuthorityPolicy(input);

      expect(decision.mode).toBe("slot_authoritative");
      expect(decision.fallbackReason).toBe("feature_disabled");
      expect(decision.temporalAuthorityCandidate).toBe(false);
      expect(decision.diagnostics.authorityEngineUsed).toBe("slot_authoritative");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });

    it("C. indicates temporal_authoritative as candidate when all gates pass (test config)", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 10,
          tasksWithStartVariance: 0,
          tasksWithFinishVariance: 0,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        temporalAuthorityEmergencyRollback: false,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);

      expect(decision.mode).toBe("temporal_authoritative");
      expect(decision.temporalAuthorityCandidate).toBe(true);
      expect(decision.fallbackReason).toBeNull();
      expect(wasTemporalAuthorityCandidate(decision)).toBe(true);
      // CRITICAL B2.2 invariant: even though candidate, projectionApplied remains false
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });

    it("D. preserves diagnostics even when falling back", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 5,
          tasksWithStartVariance: 5,
          tasksWithFinishVariance: 5,
          tasksWithFloatVariance: 2,
          maxStartVarianceMs: 86_400_000,
          maxFinishVarianceMs: 86_400_000,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: ["T1", "T2"],
          hasUnexplainedDivergences: true,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        temporalAuthorityEmergencyRollback: false,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);

      expect(decision.mode).toBe("slot_fallback");
      expect(decision.fallbackReason).toBe("unexplained_divergence");
      expect(decision.diagnostics.tasksCompared).toBe(5);
      expect(decision.diagnostics.unexplainedDivergenceTaskIds).toContain("T1");
      expect(decision.diagnostics.maxStartVarianceMs).toBe(86_400_000);
    });

    it("E. marks emergency rollback in diagnostics", () => {
      const input = buildTemporalAuthorityRoutingInput({
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        temporalAuthorityEmergencyRollback: true,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);

      expect(decision.mode).toBe("slot_fallback");
      expect(decision.fallbackReason).toBe("emergency_rollback");
      expect(decision.diagnostics.emergencyRollbackActive).toBe(true);
    });
  });

  describe("B2.2 invariant: projectionApplied always false", () => {
    it("F. slot_authoritative path: projectionApplied always false", () => {
      const input = buildTemporalAuthorityRoutingInput({
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: false,
        temporalAuthorityRolloutRing: "off",
        temporalAuthorityEmergencyRollback: false,
      });

      const decision = decideScheduleAuthorityPolicy(input);
      expect(decision.mode).toBe("slot_authoritative");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });

    it("G. temporal_shadow_only path: projectionApplied always false", () => {
      const input = buildTemporalAuthorityRoutingInput({
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: false,
        temporalAuthorityRolloutRing: "off",
        temporalAuthorityEmergencyRollback: false,
      });

      const decision = decideScheduleAuthorityPolicy(input);
      expect(decision.mode).toBe("slot_authoritative");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });

    it("H. temporal_authoritative candidate path (still B2.2): projectionApplied always false", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 5,
          tasksWithStartVariance: 0,
          tasksWithFinishVariance: 0,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "internal_test",
        temporalAuthorityEmergencyRollback: false,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);
      expect(decision.mode).toBe("temporal_authoritative");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });

    it("I. slot_fallback path: projectionApplied always false", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 5,
          tasksWithStartVariance: 5,
          tasksWithFinishVariance: 5,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 86_400_000,
          maxFinishVarianceMs: 86_400_000,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: ["T1"],
          hasUnexplainedDivergences: true,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        temporalAuthorityEmergencyRollback: false,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);
      expect(decision.mode).toBe("slot_fallback");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });
  });

  describe("Source protection invariant", () => {
    it("J. source-protected data does not flip to temporal", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 5,
          tasksWithStartVariance: 0,
          tasksWithFinishVariance: 0,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "internal_test",
        temporalAuthorityEmergencyRollback: false,
        allowTemporalAuthorityInTests: true,
        sourceProtectionStatus: "violated", // CRITICAL: source import exists
      });

      const decision = decideScheduleAuthorityPolicy(input);

      expect(decision.mode).toBe("slot_fallback");
      expect(decision.fallbackReason).toBe("source_protection_violation");
      expect(decision.diagnostics.sourceProtectionStatus).toBe("violated");
      expect(decision.diagnostics.projectionApplied).toBe(false);
    });
  });

  describe("Diagnostic fields exposed", () => {
    it("K. all required B2.2 diagnostic fields present and correct", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 8,
          tasksWithStartVariance: 2,
          tasksWithFinishVariance: 1,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 86_400_000,
          maxFinishVarianceMs: 43_200_000,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: false,
        temporalAuthorityRolloutRing: "off",
        temporalAuthorityEmergencyRollback: false,
        unsupportedCalendarFeatureFlags: [],
        sourceProtectionStatus: "ok",
        projectEligibilityProfile: "standard",
      });

      const decision = decideScheduleAuthorityPolicy(input);
      const diag = decision.diagnostics;

      expect(diag.authorityEngineUsed).toBe("slot_authoritative");
      expect(diag.fallbackReason).toBe("feature_disabled");
      expect(diag.tasksCompared).toBe(8);
      expect(diag.maxStartVarianceMs).toBe(86_400_000);
      expect(diag.maxFinishVarianceMs).toBe(43_200_000);
      expect(diag.sourceProtectionStatus).toBe("ok");
      expect(diag.projectionApplied).toBe(false);
      expect(diag.emergencyRollbackActive).toBe(false);
      expect(diag.projectEligibilityProfile).toBe("standard");
      expect(diag.authorityDecisionVersion).toBe("w5b-b2-1");
      expect(diag.gatePassMatrix).toBeDefined();
      expect(diag.rolloutRing).toBe("off");
    });

    it("L. gate pass matrix fields present", () => {
      const input = buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 0,
          tasksWithStartVariance: 0,
          tasksWithFinishVariance: 0,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "uat",
        temporalAuthorityEmergencyRollback: false,
        realWasmValidationPassed: false,
        allowTemporalAuthorityInTests: true,
      });

      const decision = decideScheduleAuthorityPolicy(input);
      const gates = decision.diagnostics.gatePassMatrix;

      expect(gates.shadowEvidenceAvailable).toBe(true);
      expect(gates.noUnexplainedDivergences).toBe(true);
      expect(gates.sourceProtectionValid).toBe(true);
      expect(gates.realWasmValidationPassed).toBe(false);
      expect(typeof gates.performanceWithinThreshold).toBe("boolean");
    });
  });
});
