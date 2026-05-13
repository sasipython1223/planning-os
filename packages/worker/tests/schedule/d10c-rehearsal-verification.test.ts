import { beforeEach, describe, expect, it } from "vitest";
import {
    _resetCutoverReadinessGate,
    evaluateRehearsalVerificationState,
    setKillSwitchRehearsalResult,
    setRollbackRehearsalResult,
} from "../../src/schedule/CutoverReadinessGate.js";

describe("D10c rehearsal verification state", () => {
  beforeEach(() => {
    _resetCutoverReadinessGate();
  });

  it("defaults to not_run and not passed", () => {
    const state = evaluateRehearsalVerificationState();

    expect(state.killSwitch).toEqual({
      result: "not_run",
      recordedAt: null,
      ring: null,
      notes: null,
    });
    expect(state.rollback).toEqual({
      result: "not_run",
      recordedAt: null,
      ring: null,
      notes: null,
    });
    expect(state.bothPassed).toBe(false);
  });

  it("captures explicit kill-switch rehearsal evidence", () => {
    setKillSwitchRehearsalResult(
      "passed",
      1_700_000_000_000,
      "internal_dogfood",
      "operator drill complete",
    );

    const state = evaluateRehearsalVerificationState();

    expect(state.killSwitch).toEqual({
      result: "passed",
      recordedAt: 1_700_000_000_000,
      ring: "internal_dogfood",
      notes: "operator drill complete",
    });
    expect(state.rollback.result).toBe("not_run");
    expect(state.bothPassed).toBe(false);
  });

  it("requires both rehearsals to pass", () => {
    setKillSwitchRehearsalResult("passed", 1_700_000_000_001, "canary", "kill switch ok");
    setRollbackRehearsalResult("passed", 1_700_000_000_002, "canary", "rollback ok");

    const state = evaluateRehearsalVerificationState();

    expect(state.killSwitch.result).toBe("passed");
    expect(state.rollback.result).toBe("passed");
    expect(state.bothPassed).toBe(true);
  });

  it("reset clears rehearsal evidence", () => {
    setKillSwitchRehearsalResult("failed", 1_700_000_000_010, "canary", "timeout");
    setRollbackRehearsalResult("passed", 1_700_000_000_011, "canary", "ok");

    _resetCutoverReadinessGate();
    const state = evaluateRehearsalVerificationState();

    expect(state.killSwitch.result).toBe("not_run");
    expect(state.killSwitch.recordedAt).toBeNull();
    expect(state.rollback.result).toBe("not_run");
    expect(state.rollback.recordedAt).toBeNull();
    expect(state.bothPassed).toBe(false);
  });
});
