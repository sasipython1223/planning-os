import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    _resetCutoverReadinessGate,
    evaluateMinuteCanaryEnablementDecision,
} from "../src/schedule/CutoverReadinessGate.js";

type RuntimeTestScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: unknown;
  __PLANNER_REQUESTED_AUTHORITY_MODE?: "slot" | "minute";
  __PLANNER_FORCE_SLOT_AUTHORITY?: boolean;
  __PLANNER_PARITY_GATE_PASSED?: boolean;
  __PLANNER_READINESS_BENCHMARK_PASSED?: boolean;
  __PLANNER_PERSISTENCE_PURITY_PASSED?: boolean;
  __PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY?: boolean;
  __PLANNER_RING_PROGRESSION_APPROVED_TO?:
    | "off"
    | "internal_dogfood"
    | "canary"
    | "partial_production"
    | "full_production";
  __PLANNER_ROLLOUT_RING?:
    | "off"
    | "internal_dogfood"
    | "canary"
    | "partial_production"
    | "full_production";
  __PLANNER_ROLLOUT_TARGETING_MODE?: "all" | "cohort_allowlist";
  __PLANNER_ROLLOUT_SUBJECT_COHORT_ID?: string;
  __PLANNER_ROLLOUT_TARGET_COHORTS?: readonly string[] | string;
  __PLANNER_KILL_SWITCH_REHEARSAL_RESULT?: "not_run" | "passed" | "failed";
  __PLANNER_ROLLBACK_REHEARSAL_RESULT?: "not_run" | "passed" | "failed";
  __PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY?: boolean;
};

const runtimeScope: RuntimeTestScope = {
  postMessage: vi.fn(),
};

let syncRuntimeFlags: (() => void) | null = null;

const resetRuntimeFlags = (): void => {
  delete runtimeScope.__PLANNER_REQUESTED_AUTHORITY_MODE;
  delete runtimeScope.__PLANNER_FORCE_SLOT_AUTHORITY;
  delete runtimeScope.__PLANNER_PARITY_GATE_PASSED;
  delete runtimeScope.__PLANNER_READINESS_BENCHMARK_PASSED;
  delete runtimeScope.__PLANNER_PERSISTENCE_PURITY_PASSED;
  delete runtimeScope.__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY;
  delete runtimeScope.__PLANNER_RING_PROGRESSION_APPROVED_TO;
  delete runtimeScope.__PLANNER_ROLLOUT_RING;
  delete runtimeScope.__PLANNER_ROLLOUT_TARGETING_MODE;
  delete runtimeScope.__PLANNER_ROLLOUT_SUBJECT_COHORT_ID;
  delete runtimeScope.__PLANNER_ROLLOUT_TARGET_COHORTS;
  delete runtimeScope.__PLANNER_KILL_SWITCH_REHEARSAL_RESULT;
  delete runtimeScope.__PLANNER_ROLLBACK_REHEARSAL_RESULT;
  delete runtimeScope.__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY;
};

describe("worker runtime ring progression flag wiring", () => {
  beforeAll(async () => {
    (globalThis as any).self = runtimeScope;
    const workerModule = await import("../src/worker.js");
    syncRuntimeFlags = workerModule.__test__syncCutoverFlagsFromRuntime as () => void;
  });

  beforeEach(() => {
    _resetCutoverReadinessGate();
    resetRuntimeFlags();
  });

  it("keeps default-safe blocked behavior when approval flag is absent", () => {
    if (!syncRuntimeFlags) {
      throw new Error("worker runtime sync helper was not initialized");
    }

    runtimeScope.__PLANNER_REQUESTED_AUTHORITY_MODE = "minute";
    runtimeScope.__PLANNER_FORCE_SLOT_AUTHORITY = false;
    runtimeScope.__PLANNER_PARITY_GATE_PASSED = true;
    runtimeScope.__PLANNER_READINESS_BENCHMARK_PASSED = true;
    runtimeScope.__PLANNER_PERSISTENCE_PURITY_PASSED = true;
    runtimeScope.__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY = true;
    runtimeScope.__PLANNER_ROLLOUT_RING = "internal_dogfood";
    runtimeScope.__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY = true;
    runtimeScope.__PLANNER_KILL_SWITCH_REHEARSAL_RESULT = "passed";
    runtimeScope.__PLANNER_ROLLBACK_REHEARSAL_RESULT = "passed";

    syncRuntimeFlags();
    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.canEnableMinuteAuthorityForCohort).toBe(false);
    expect(decision.blockers).toContain("ring_progression_not_approved");
  });

  it("clears ring progression blocker with internal_dogfood approval when other gates are green", () => {
    if (!syncRuntimeFlags) {
      throw new Error("worker runtime sync helper was not initialized");
    }

    runtimeScope.__PLANNER_REQUESTED_AUTHORITY_MODE = "minute";
    runtimeScope.__PLANNER_FORCE_SLOT_AUTHORITY = false;
    runtimeScope.__PLANNER_PARITY_GATE_PASSED = true;
    runtimeScope.__PLANNER_READINESS_BENCHMARK_PASSED = true;
    runtimeScope.__PLANNER_PERSISTENCE_PURITY_PASSED = true;
    runtimeScope.__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY = true;
    runtimeScope.__PLANNER_ROLLOUT_RING = "internal_dogfood";
    runtimeScope.__PLANNER_RING_PROGRESSION_APPROVED_TO = "internal_dogfood";
    runtimeScope.__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY = true;
    runtimeScope.__PLANNER_KILL_SWITCH_REHEARSAL_RESULT = "passed";
    runtimeScope.__PLANNER_ROLLBACK_REHEARSAL_RESULT = "passed";

    syncRuntimeFlags();
    const decision = evaluateMinuteCanaryEnablementDecision();

    expect(decision.canEnableMinuteAuthorityForCohort).toBe(true);
    expect(decision.blockers).not.toContain("ring_progression_not_approved");
  });
});
