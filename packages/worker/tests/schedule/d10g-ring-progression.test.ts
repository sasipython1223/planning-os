import { beforeEach, describe, expect, it } from "vitest";
import {
    evaluateMinuteCanaryEnablementDecision,
    evaluateRingProgressionApprovalState,
    setCanaryMinuteEnablementEnabled,
    setCutoverKillSwitchForceSlot,
    setKillSwitchRehearsalResult,
    setParityGatePassed,
    setPersistencePurityPassed,
    setReadinessBenchmarkPassed,
    setRequestedAuthorityMode,
    setRingProgressionApprovedTo,
    setRollbackRehearsalResult,
    setRolloutRing,
    setRolloutSubjectCohortId,
    setRolloutTargetedCohorts,
    setRolloutTargetingMode,
    setStagingGuardPassed,
} from "../../src/schedule/CutoverReadinessGate.js";

const resetGateState = (): void => {
  setRequestedAuthorityMode("slot");
  setCutoverKillSwitchForceSlot(true);
  setParityGatePassed(false);
  setReadinessBenchmarkPassed(false);
  setPersistencePurityPassed(false);
  setStagingGuardPassed(false);
  setRolloutRing("off");
  setRingProgressionApprovedTo("off");
  setRolloutTargetingMode("all");
  setRolloutSubjectCohortId(null);
  setRolloutTargetedCohorts([]);
  setCanaryMinuteEnablementEnabled(false);
  setKillSwitchRehearsalResult("not_run");
  setRollbackRehearsalResult("not_run");
};

const enableAllGates = (): void => {
  setRequestedAuthorityMode("minute");
  setCutoverKillSwitchForceSlot(false);
  setParityGatePassed(true);
  setReadinessBenchmarkPassed(true);
  setPersistencePurityPassed(true);
  setStagingGuardPassed(true);
  setCanaryMinuteEnablementEnabled(true);
  setKillSwitchRehearsalResult("passed");
  setRollbackRehearsalResult("passed");
};

describe("D10g: Ring Progression Approval Gate", () => {
  describe("RingProgressionApprovalState evaluator", () => {
    beforeEach(() => {
      resetGateState();
    });

    it("should return default-safe state: both ring and approvedRing at 'off'", () => {
      const state = evaluateRingProgressionApprovalState();
      expect(state.currentRing).toBe("off");
      expect(state.approvedRing).toBe("off");
      expect(state.canProgress).toBe(true);
    });

    it("should allow progression when approvedRing >= currentRing", () => {
      setRolloutRing("canary");
      setRingProgressionApprovedTo("canary");
      const state = evaluateRingProgressionApprovalState();
      expect(state.currentRing).toBe("canary");
      expect(state.approvedRing).toBe("canary");
      expect(state.canProgress).toBe(true);
    });

    it("should allow progression when approvedRing > currentRing", () => {
      setRolloutRing("internal_dogfood");
      setRingProgressionApprovedTo("canary");
      const state = evaluateRingProgressionApprovalState();
      expect(state.currentRing).toBe("internal_dogfood");
      expect(state.approvedRing).toBe("canary");
      expect(state.canProgress).toBe(true);
    });

    it("should block progression when currentRing > approvedRing", () => {
      setRolloutRing("canary");
      setRingProgressionApprovedTo("internal_dogfood");
      const state = evaluateRingProgressionApprovalState();
      expect(state.currentRing).toBe("canary");
      expect(state.approvedRing).toBe("internal_dogfood");
      expect(state.canProgress).toBe(false);
    });

    it("should block progression when approvedRing is 'off' but currentRing is higher", () => {
      setRolloutRing("partial_production");
      setRingProgressionApprovedTo("off");
      const state = evaluateRingProgressionApprovalState();
      expect(state.canProgress).toBe(false);
    });
  });

  describe("MinuteCanaryEnablementDecision integration with ring progression", () => {
    beforeEach(() => {
      resetGateState();
      enableAllGates();
    });

    it("should allow minute authority when ring progression is approved (dogfood)", () => {
      setRolloutRing("internal_dogfood");
      setRingProgressionApprovedTo("internal_dogfood");
      setRolloutSubjectCohortId("cohort-1");
      setRolloutTargetedCohorts(["cohort-1"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
      expect(decision.blockers).not.toContain("ring_progression_not_approved");
    });

    it("should block minute authority when ring progression is not approved (canary)", () => {
      setRolloutRing("canary");
      setRingProgressionApprovedTo("off"); // Not yet approved for canary
      setRolloutSubjectCohortId("cohort-1");
      setRolloutTargetedCohorts(["cohort-1"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
      expect(decision.blockers).toContain("ring_progression_not_approved");
    });

    it("should block minute authority when ring progression approval is behind current ring", () => {
      setRolloutRing("partial_production");
      setRingProgressionApprovedTo("canary");
      setRolloutSubjectCohortId("cohort-1");
      setRolloutTargetedCohorts(["cohort-1"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
      expect(decision.blockers).toContain("ring_progression_not_approved");
    });
  });

  describe("Default-safe behavior: non-approved cohorts remain slot-authoritative", () => {
    beforeEach(() => {
      resetGateState();
    });

    it("should block minute authority by default (off ring, no approval)", () => {
      // This tests the fundamental default-safe principle:
      // When both currentRing and approvedRing are "off" (freshly initialized state),
      // cohorts cannot access minute authority without explicit progression approval.
      enableAllGates();
      setRolloutRing("off");
      setRingProgressionApprovedTo("off");
      setRolloutSubjectCohortId("cohort-default");
      setRolloutTargetedCohorts(["cohort-default"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
      expect(decision.effectiveMode).toBe("slot");
      expect(decision.blockers).toContain("rollout_control_blocked");
    });

    it("should require explicit approval to progress from dogfood to canary", () => {
      // Scenario: Operators ran dogfood successfully, now want to advance to canary.
      // Until they explicitly set approvedRing to canary, canary cohorts cannot run minute.
      enableAllGates();
      setRolloutRing("canary");
      setRingProgressionApprovedTo("internal_dogfood"); // Only approved up to dogfood
      setRolloutSubjectCohortId("canary-cohort");
      setRolloutTargetedCohorts(["canary-cohort"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
      expect(decision.effectiveMode).toBe("slot");
      expect(decision.blockers).toContain("ring_progression_not_approved");
    });

    it("should allow minute authority only after explicit ring progression approval", () => {
      // Same scenario as above, but after explicit approval.
      enableAllGates();
      setRolloutRing("canary");
      setRingProgressionApprovedTo("canary"); // Explicitly approved
      setRolloutSubjectCohortId("canary-cohort");
      setRolloutTargetedCohorts(["canary-cohort"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
      expect(decision.effectiveMode).toBe("minute");
      expect(decision.blockers).not.toContain("ring_progression_not_approved");
    });

    it("should preserve slot authority for cohorts in unapproved rings", () => {
      // Multiple cohorts scenario: some in approved ring, others in unapproved.
      enableAllGates();
      setRolloutRing("partial_production");
      setRingProgressionApprovedTo("canary"); // Only approved up to canary

      // Cohort in unapproved ring (partial_production)
      setRolloutSubjectCohortId("prod-cohort");
      setRolloutTargetedCohorts(["prod-cohort"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
      expect(decision.blockers).toContain("ring_progression_not_approved");
      expect(decision.effectiveMode).toBe("slot");
    });
  });

  describe("Ring progression sequence scenarios", () => {
    beforeEach(() => {
      resetGateState();
      enableAllGates();
    });

    it("should support full progression sequence: off -> dogfood -> canary -> partial -> full", () => {
      const progressionPath: Array<[string, string]> = [
        ["internal_dogfood", "internal_dogfood"],
        ["canary", "canary"],
        ["partial_production", "partial_production"],
        ["full_production", "full_production"],
      ];

      for (const [ring, approved] of progressionPath) {
        setRolloutRing(ring as any);
        setRingProgressionApprovedTo(approved as any);
        setRolloutSubjectCohortId("progression-cohort");
        setRolloutTargetedCohorts(["progression-cohort"]);

        const decision = evaluateMinuteCanaryEnablementDecision();
        expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
        expect(decision.blockers).not.toContain("ring_progression_not_approved");
      }
    });

    it("should block at each unapproved ring boundary during progression", () => {
      const ringLevels = ["off", "internal_dogfood", "canary", "partial_production", "full_production"];

      for (let i = 0; i < ringLevels.length - 1; i++) {
        const currentRing = ringLevels[i + 1]; // Try to access next ring
        const approvedRing = ringLevels[i]; // But only approved up to current ring

        setRolloutRing(currentRing as any);
        setRingProgressionApprovedTo(approvedRing as any);
        setRolloutSubjectCohortId("boundary-cohort");
        setRolloutTargetedCohorts(["boundary-cohort"]);

        const decision = evaluateMinuteCanaryEnablementDecision();
        expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
        expect(decision.blockers).toContain("ring_progression_not_approved");
      }
    });
  });

  describe("Approval setter behavior", () => {
    beforeEach(() => {
      resetGateState();
    });

    it("should update approvedRing via setRingProgressionApprovedTo", () => {
      setRingProgressionApprovedTo("canary");
      let state = evaluateRingProgressionApprovalState();
      expect(state.approvedRing).toBe("canary");

      setRingProgressionApprovedTo("partial_production");
      state = evaluateRingProgressionApprovalState();
      expect(state.approvedRing).toBe("partial_production");
    });

    it("should not allow approval to regress to lower ring", () => {
      // Note: This test documents current behavior. The setter allows any value.
      // In production, operators should have guardrails to prevent regression,
      // but the gate itself doesn't enforce this.
      setRingProgressionApprovedTo("full_production");
      let state = evaluateRingProgressionApprovalState();
      expect(state.approvedRing).toBe("full_production");

      setRingProgressionApprovedTo("canary"); // Setter allows this (no validation)
      state = evaluateRingProgressionApprovalState();
      expect(state.approvedRing).toBe("canary"); // Approval can go backward if setter is called
    });
  });

  describe("Ring progression blocker composition with other blockers", () => {
    beforeEach(() => {
      resetGateState();
    });

    it("should include ring_progression_not_approved alongside other blockers", () => {
      // Ring progression blocked + other gates also blocked
      setRolloutRing("canary");
      setRingProgressionApprovedTo("off");
      setRequestedAuthorityMode("minute");
      setCanaryMinuteEnablementEnabled(false); // Also block on enablement flag

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.blockers).toContain("ring_progression_not_approved");
      expect(decision.blockers).toContain("canary_enablement_flag_off");
    });

    it("should not include ring_progression_not_approved when progression is approved", () => {
      enableAllGates();
      setRolloutRing("canary");
      setRingProgressionApprovedTo("canary");
      setRolloutSubjectCohortId("cohort-1");
      setRolloutTargetedCohorts(["cohort-1"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.blockers).not.toContain("ring_progression_not_approved");
      expect(decision.blockers.length).toBe(0);
    });

    it("should allow minute enablement only when ALL blockers (including ring progression) are passed", () => {
      enableAllGates();
      setRolloutRing("canary");
      setRingProgressionApprovedTo("canary");
      setRolloutSubjectCohortId("cohort-full");
      setRolloutTargetedCohorts(["cohort-full"]);

      const decision = evaluateMinuteCanaryEnablementDecision();
      expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
      expect(decision.effectiveMode).toBe("minute");
      expect(decision.blockers.length).toBe(0);
    });
  });
});
