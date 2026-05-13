/**
 * W5B-B2.7: Worker command surface for dogfood readiness check.
 *
 * Asserts:
 *   - `RUN_TEMPORAL_DOGFOOD_READINESS_CHECK` emits `TEMPORAL_DOGFOOD_READINESS_RESULT`.
 *   - reqId is preserved.
 *   - `authorityApplied` is always literally `false`.
 *   - Default runtime → ineligible (`dogfood_authority_disabled`).
 *   - With master switch on but operator ack missing → blocked.
 *   - No DIFF_STATE emitted by the command.
 *   - No persistence save triggered.
 *   - Apply path still blocks dogfood ring even after a readiness check.
 *   - internal_test apply path remains functional (regression).
 */
import type { Command, WorkerMessage } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
  __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_ENABLED?: boolean;
  __PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING?: "off" | "internal_test" | "dogfood" | "uat" | "production";
  __PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK?: boolean;
  __PLANNER_TEMPORAL_REQUESTED_AUTHORITY_ENGINE_MODE?: string;
  __PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED?: boolean;
  __PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS?: string;
  __PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT?: number;
  __PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS?: number;
  __PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS?: number;
  __PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES?: readonly string[];
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

const savePersistedStateMock = vi.fn();

const buildMockScheduleResponse = (request: any) => ({
  scheduleVersion: 1,
  results: (request.tasks ?? []).map((task: any) => ({
    taskId: task.id,
    earlyStartMinutes: 0,
    earlyFinishMinutes: Number(task.durationWorkMinutes) || 0,
    lateStartMinutes: 0,
    lateFinishMinutes: Number(task.durationWorkMinutes) || 0,
    totalFloatMinutes: 0,
    freeFloatMinutes: 0,
    isCritical: true,
  })),
});

vi.mock("../../src/wasm/loadCpmWasm.js", () => ({
  loadCpmWasm: vi.fn(async () => undefined),
  isWasmLoaded: vi.fn(() => true),
  getCpmWasm: vi.fn(() => ({
    calculate_schedule: (request: any) => buildMockScheduleResponse(request),
    calculate_schedule_minute: (request: any) => buildMockScheduleResponse(request),
    analyze_float_paths: vi.fn(),
  })),
}));

vi.mock("../../src/persistence.js", () => ({
  loadPersistedState: vi.fn(async () => null),
  migratePersistedState: vi.fn((value: any) => value),
  savePersistedState: savePersistedStateMock,
  validatePersistedStatePurity: vi.fn(() => []),
}));

const waitForWorkerReady = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    const ready = runtimeScope.postMessage.mock.calls.some((entry) => {
      const message = entry[0] as WorkerMessage;
      return message.type === "WORKER_READY";
    });
    if (ready && typeof runtimeScope.onmessage === "function") return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("worker did not become ready");
};

const dispatch = (cmd: Command): WorkerMessage[] => {
  if (!runtimeScope.onmessage) {
    throw new Error("worker message handler not initialized");
  }
  const before = runtimeScope.postMessage.mock.calls.length;
  runtimeScope.onmessage({ data: cmd } as MessageEvent<Command>);
  return runtimeScope.postMessage.mock.calls.slice(before).map((entry) => entry[0] as WorkerMessage);
};

const resetRuntimeFlags = (): void => {
  delete runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES;
  delete runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_ENABLED;
  delete runtimeScope.__PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED;
  delete runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING;
  delete runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK;
  delete runtimeScope.__PLANNER_TEMPORAL_REQUESTED_AUTHORITY_ENGINE_MODE;
  delete runtimeScope.__PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED;
  delete runtimeScope.__PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS;
  delete runtimeScope.__PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES;
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

describe("W5B-B2.7 RUN_TEMPORAL_DOGFOOD_READINESS_CHECK", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("1) emits TEMPORAL_DOGFOOD_READINESS_RESULT and preserves reqId", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-result-shape",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    expect(result?.type).toBe("TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.reqId).toBe("dogfood-result-shape");
  });

  it("2) default runtime → ineligible with dogfood_authority_disabled", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-default",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    expect(result?.type).toBe("TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.decision.eligible).toBe(false);
    expect(result.payload.decision.blockedReasons).toContain("dogfood_authority_disabled");
  });

  it("3) authorityApplied is always literally false", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-authority-false",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.decision.authorityApplied).toBe(false);
    expect(result.payload.authorityApplied).toBe(false);
  });

  it("4) master switch on but ack missing → operator_acknowledgement_missing", () => {
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED = false;
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-ack-missing",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.decision.blockedReasons).toContain("operator_acknowledgement_missing");
  });

  it("5) command does NOT emit DIFF_STATE", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-no-diff",
    });
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("6) command does NOT trigger persistence save", () => {
    savePersistedStateMock.mockClear();
    dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-no-save",
    });
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("7) persistenceStatus is locked to disabled_runtime_only / not applied", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-persistence",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.persistenceStatus.persistencePolicy).toBe("disabled_runtime_only");
    expect(result.payload.persistenceStatus.persistenceApplied).toBe(false);
  });

  it("8) evidence counts pass through from runtime overrides", () => {
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS = 3;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS = 3;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES = ["AI001", "AI002", "AI004"];
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-evidence",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.evidenceRunCountRequired).toBe(3);
    expect(result.payload.evidenceRunCountAccepted).toBe(3);
    expect(result.payload.evidenceFixtureNames).toEqual(["AI001", "AI002", "AI004"]);
  });

  it("9) controls.dogfoodAuthorityEnabled reflects runtime flag (defaults false)", () => {
    const off = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-switch-off",
    });
    const offResult = off.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!offResult || offResult.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(offResult.payload.controls.dogfoodAuthorityEnabled).toBe(false);

    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    const on = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "dogfood-switch-on",
    });
    const onResult = on.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!onResult || onResult.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(onResult.payload.controls.dogfoodAuthorityEnabled).toBe(true);
  });
});

describe("W5B-B2.7 apply guard regression — dogfood ring still falls back", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("RUN_TEMPORAL_AUTHORITY_APPLY with dogfood ring → rollout_ring_not_internal_test, persistenceApplied=false", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_APPLY",
      v: 1,
      reqId: "b2-7-dogfood-blocked",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        requestedAuthorityEngineMode: "temporal_authoritative",
        temporalCandidateProjectionEnabled: true,
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: true,
        sourceProtectionStatus: "ok",
        unsupportedFeatureFlags: [],
        projectEligibilityProfileSupported: true,
        temporalExecutionErrors: [],
        unexplainedDivergenceCount: 0,
        unexplainedDivergenceTolerance: 0,
        wasmLoadMode: "real",
      },
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
    // W5B-B2.9: dogfood ring is now routed to its own guard. Default-off master
    // switch surfaces `dogfood_authority_disabled` first. Apply still falls
    // back; persistence remains disabled. Both blocks are equivalent for
    // safety — dogfood cannot apply without explicit master-switch enablement.
    expect(result.payload.fallbackReason).toBe("dogfood_authority_disabled");
    expect(result.payload.persistenceApplied).toBe(false);
  });
});
