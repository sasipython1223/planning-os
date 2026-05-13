import { beforeEach, describe, expect, it } from "vitest";
import {
    _resetCutoverReadinessGate,
    evaluateAuthorityFlipGate,
    evaluateCutoverReadiness,
    getCutoverTelemetrySnapshot,
    recordMismatchCategories,
    recordPrimaryDuration,
    recordPrimaryEngineExecDuration,
    recordPrimaryProjectionDuration,
    recordPrimaryRequestBuildDuration,
    recordShadowDuration,
    recordShadowEngineExecDuration,
    recordShadowFailure,
    recordShadowRequestBuildDuration,
    setCutoverKillSwitchForceSlot,
    setParityGatePassed,
    setPersistencePurityPassed,
    setReadinessBenchmarkPassed,
    setRequestedAuthorityMode,
    setStagingGuardPassed,
} from "../../src/schedule/CutoverReadinessGate.js";

describe("D9 CutoverReadinessGate", () => {
  beforeEach(() => {
    _resetCutoverReadinessGate();
  });

  it("forces slot authority when kill switch is enabled", () => {
    setRequestedAuthorityMode("minute");
    setParityGatePassed(true);
    setCutoverKillSwitchForceSlot(true);

    const decision = evaluateCutoverReadiness();

    expect(decision.effectiveMode).toBe("slot");
    expect(decision.reason).toBe("kill_switch_forced_slot");
  });

  it("rolls back to slot when parity gate is not passed", () => {
    setRequestedAuthorityMode("minute");
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(false);

    const decision = evaluateCutoverReadiness();

    expect(decision.effectiveMode).toBe("slot");
    expect(decision.reason).toBe("parity_gate_not_passed");
  });

  it("allows minute only when requested, kill switch is off, and parity passed", () => {
    setRequestedAuthorityMode("minute");
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(true);

    const decision = evaluateCutoverReadiness();

    expect(decision.effectiveMode).toBe("minute");
    expect(decision.reason).toBe("minute_mode_allowed");
  });

  it("aggregates perf and mismatch telemetry", () => {
    recordPrimaryDuration(10);
    recordPrimaryDuration(20);
    recordPrimaryRequestBuildDuration(3);
    recordPrimaryEngineExecDuration(7);
    recordPrimaryProjectionDuration(5);
    recordShadowDuration(30);
    recordShadowRequestBuildDuration(11);
    recordShadowEngineExecDuration(13);
    recordShadowFailure();
    recordMismatchCategories({
      true_regression: 1,
      expected_precision_improvement: 2,
      known_slot_minute_divergence: 3,
      comparator_tolerance_policy_gap: 4,
    });

    const snapshot = getCutoverTelemetrySnapshot();

    expect(snapshot.primaryRuns).toBe(2);
    expect(snapshot.shadowRuns).toBe(1);
    expect(snapshot.shadowFailures).toBe(1);
    expect(snapshot.primaryP95Ms).toBe(20);
    expect(snapshot.shadowP95Ms).toBe(30);
    expect(snapshot.primaryRequestBuildP95Ms).toBe(3);
    expect(snapshot.primaryEngineExecP95Ms).toBe(7);
    expect(snapshot.primaryProjectionP95Ms).toBe(5);
    expect(snapshot.shadowRequestBuildP95Ms).toBe(11);
    expect(snapshot.shadowEngineExecP95Ms).toBe(13);
    expect(snapshot.primaryRequestBuildRuns).toBe(1);
    expect(snapshot.primaryEngineExecRuns).toBe(1);
    expect(snapshot.primaryProjectionRuns).toBe(1);
    expect(snapshot.shadowRequestBuildRuns).toBe(1);
    expect(snapshot.shadowEngineExecRuns).toBe(1);
    expect(snapshot.mismatchCategories).toEqual({
      true_regression: 1,
      expected_precision_improvement: 2,
      known_slot_minute_divergence: 3,
      comparator_tolerance_policy_gap: 4,
    });
  });

  it("formal authority-flip gate blocks when requested mode is not minute", () => {
    setRequestedAuthorityMode("slot");
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(true);
    setReadinessBenchmarkPassed(true);
    setPersistencePurityPassed(true);
    setStagingGuardPassed(true);

    const report = evaluateAuthorityFlipGate();

    expect(report.eligible).toBe(false);
    expect(report.blockers).toContain("requested_mode_not_minute");
  });

  it("formal authority-flip gate blocks on unmet staging preconditions", () => {
    setRequestedAuthorityMode("minute");
    setCutoverKillSwitchForceSlot(true);
    setParityGatePassed(false);
    setReadinessBenchmarkPassed(false);
    setPersistencePurityPassed(false);
    setStagingGuardPassed(false);

    const report = evaluateAuthorityFlipGate();

    expect(report.eligible).toBe(false);
    expect(report.blockers).toEqual([
      "kill_switch_forced_slot",
      "parity_gate_not_passed",
      "readiness_benchmark_not_passed",
      "persistence_purity_not_passed",
      "staging_guard_not_passed",
    ]);
  });

  it("formal authority-flip gate becomes eligible only when all preconditions pass", () => {
    setRequestedAuthorityMode("minute");
    setCutoverKillSwitchForceSlot(false);
    setParityGatePassed(true);
    setReadinessBenchmarkPassed(true);
    setPersistencePurityPassed(true);
    setStagingGuardPassed(true);

    const report = evaluateAuthorityFlipGate();

    expect(report.eligible).toBe(true);
    expect(report.blockers).toEqual([]);
  });
});
