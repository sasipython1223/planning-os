import { beforeEach, describe, expect, it } from "vitest";
import {
    _resetCutoverReadinessGate,
    evaluateMinuteCanaryEnablementDecision,
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

describe("D10d minute canary enablement decision", () => {
  beforeEach(() => {
    _resetCutoverReadinessGate();
  });

  it("defaults to slot authority with default-off blocker", () => {
    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.effectiveMode).toBe("slot");
    expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
    expect(decision.blockers).toContain("canary_enablement_flag_off");
  });

  it("remains blocked when only canary flag is enabled", () => {
    setCanaryMinuteEnablementEnabled(true);

    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.effectiveMode).toBe("slot");
    expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
    expect(decision.blockers).toContain("authority_flip_gate_blocked");
    expect(decision.blockers).toContain("rollout_control_blocked");
    expect(decision.blockers).toContain("rehearsal_verification_not_passed");
  });

  it("becomes minute-eligible only when requested mode, authority gate, rollout, and rehearsals all pass", () => {
    setRequestedAuthorityMode("minute");
    setCanaryMinuteEnablementEnabled(true);
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(true);
    setReadinessBenchmarkPassed(true);
    setPersistencePurityPassed(true);
    setStagingGuardPassed(true);

    setRolloutRing("canary");
     setRingProgressionApprovedTo("canary");
    setRolloutTargetingMode("cohort_allowlist");
    setRolloutTargetedCohorts(["cohort-a", "cohort-b"]);
    setRolloutSubjectCohortId("cohort-a");

    setKillSwitchRehearsalResult("passed", 1_700_000_000_100, "canary", "kill-switch done");
    setRollbackRehearsalResult("passed", 1_700_000_000_200, "canary", "rollback done");

    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.effectiveMode).toBe("minute");
    expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.ring).toBe("canary");
    expect(decision.subjectCohortId).toBe("cohort-a");
  });

  it("returns to slot when rollout eligibility is lost", () => {
    setRequestedAuthorityMode("minute");
    setCanaryMinuteEnablementEnabled(true);
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(true);
    setReadinessBenchmarkPassed(true);
    setPersistencePurityPassed(true);
    setStagingGuardPassed(true);

    setRolloutRing("canary");
    setRolloutTargetingMode("cohort_allowlist");
    setRolloutTargetedCohorts(["cohort-a"]);
    setRolloutSubjectCohortId("cohort-z");

    setKillSwitchRehearsalResult("passed", 1_700_000_000_100, "canary", "kill-switch done");
    setRollbackRehearsalResult("passed", 1_700_000_000_200, "canary", "rollback done");

    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.effectiveMode).toBe("slot");
    expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
    expect(decision.blockers).toContain("rollout_control_blocked");
  });
});
