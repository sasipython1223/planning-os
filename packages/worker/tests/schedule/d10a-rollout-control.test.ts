import { beforeEach, describe, expect, it } from "vitest";
import {
    _resetCutoverReadinessGate,
    evaluateRolloutControlState,
    setRolloutRing,
    setRolloutSubjectCohortId,
    setRolloutTargetedCohorts,
    setRolloutTargetingMode,
} from "../../src/schedule/CutoverReadinessGate.js";

describe("D10a rollout control state", () => {
  beforeEach(() => {
    _resetCutoverReadinessGate();
  });

  it("defaults to off ring and blocks rollout eligibility", () => {
    const state = evaluateRolloutControlState();

    expect(state.ring).toBe("off");
    expect(state.targetingMode).toBe("all");
    expect(state.eligible).toBe(false);
    expect(state.blockers).toContain("ring_not_enabled");
  });

  it("becomes eligible when ring is enabled and targeting is all", () => {
    setRolloutRing("internal_dogfood");
    setRolloutTargetingMode("all");

    const state = evaluateRolloutControlState();

    expect(state.eligible).toBe(true);
    expect(state.cohortMatched).toBe(true);
    expect(state.blockers).toEqual([]);
  });

  it("blocks when cohort allowlist is empty", () => {
    setRolloutRing("canary");
    setRolloutTargetingMode("cohort_allowlist");
    setRolloutTargetedCohorts([]);

    const state = evaluateRolloutControlState();

    expect(state.eligible).toBe(false);
    expect(state.cohortMatched).toBe(false);
    expect(state.blockers).toContain("cohort_allowlist_empty");
  });

  it("blocks when subject cohort is not in allowlist", () => {
    setRolloutRing("canary");
    setRolloutTargetingMode("cohort_allowlist");
    setRolloutTargetedCohorts(["alpha", "beta"]);
    setRolloutSubjectCohortId("gamma");

    const state = evaluateRolloutControlState();

    expect(state.eligible).toBe(false);
    expect(state.cohortMatched).toBe(false);
    expect(state.blockers).toContain("cohort_not_targeted");
  });

  it("allows targeted subject cohort in allowlist", () => {
    setRolloutRing("partial_production");
    setRolloutTargetingMode("cohort_allowlist");
    setRolloutTargetedCohorts(["alpha", "beta"]);
    setRolloutSubjectCohortId("beta");

    const state = evaluateRolloutControlState();

    expect(state.eligible).toBe(true);
    expect(state.cohortMatched).toBe(true);
    expect(state.blockers).toEqual([]);
  });
});