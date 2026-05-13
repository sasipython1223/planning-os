import type { Command, WorkerMessage } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as State from "../../src/state.js";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
  __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_ENABLED?: boolean;
  __PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING?: "off" | "internal_test" | "dogfood" | "uat" | "production";
  __PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK?: boolean;
  __PLANNER_TEMPORAL_REQUESTED_AUTHORITY_ENGINE_MODE?:
    | "slot_authoritative"
    | "temporal_candidate_only"
    | "temporal_authoritative";
  __PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED?: boolean;
  __PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS?: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  __PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED?: boolean;
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
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

describe("W5B-B2.5B RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("returns TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT and preserves reqId", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-result-shape",
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.reqId).toBe("cutover-result-shape");
    expect(result.payload.reqId).toBe("cutover-result-shape");
    expect(result.payload.authorityApplied).toBe(false);
  });

  it("default runtime is slot_authoritative and disallows temporal_authoritative", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-default",
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.authorityEngineMode).toBe("slot_authoritative");
    expect(result.payload.decision.allowed).toBe(false);
  });

  it("missing real WASM gate blocks temporal authority", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-missing-wasm",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "internal_test",
        requestedAuthorityEngineMode: "temporal_authoritative",
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: false,
        wasmLoadMode: "unavailable",
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.blockedReasons).toContain("real_wasm_gate_not_passed");
  });

  it("missing candidate projection blocks temporal authority", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-missing-candidate",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        requestedAuthorityEngineMode: "temporal_authoritative",
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        candidateProjectionAvailable: false,
        candidateComparisonPresent: true,
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.blockedReasons).toContain("candidate_projection_unavailable");
  });

  it("missing comparison blocks temporal authority", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-missing-comparison",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "dogfood",
        requestedAuthorityEngineMode: "temporal_authoritative",
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        candidateProjectionAvailable: true,
        candidateComparisonPresent: false,
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.blockedReasons).toContain("candidate_comparison_missing");
  });

  it("internalOnly overrides can produce gate-allowed diagnostic decision", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-overrides-allow",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "production",
        requestedAuthorityEngineMode: "temporal_authoritative",
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
        unexplainedDivergenceCount: 0,
        unexplainedDivergenceTolerance: 0,
        lifecycleSafetyPassed: true,
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.authorityEngineMode).toBe("temporal_authoritative");
    expect(result.payload.decision.allowed).toBe(true);
    expect(result.payload.decision.authorityApplied).toBe(false);
  });

  it("emergency rollback wins even when all other gates pass", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-emergency-wins",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "production",
        requestedAuthorityEngineMode: "temporal_authoritative",
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
        temporalAuthorityEmergencyRollback: true,
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.authorityEngineMode).toBe("slot_fallback");
    expect(result.payload.decision.fallbackReason).toBe("emergency_rollback_active");
  });

  it("emits no DIFF_STATE", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-no-diff",
    });

    expect(messages.some((message) => message.type === "DIFF_STATE")).toBe(false);
  });

  it("triggers no persistence save", () => {
    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-no-persist",
    });

    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("keeps source/import lifecycle state untouched", () => {
    const beforeLifecycle = State.getScheduleLifecycle();
    const beforeSourceRecord = State.getSourceImportRecord();
    const beforeSourceDates = State.getSourceDatesByTaskId();

    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-no-source-mutation",
    });

    expect(State.getScheduleLifecycle()).toBe(beforeLifecycle);
    expect(State.getSourceImportRecord()).toEqual(beforeSourceRecord);
    expect(State.getSourceDatesByTaskId()).toEqual(beforeSourceDates);
  });

  it("keeps rollout ring and requested authority mode as separate fields", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-ring-mode-separate",
      internalOnly: true,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalAuthorityRolloutRing: "off",
        requestedAuthorityEngineMode: "temporal_authoritative",
        temporalCandidateProjectionEnabled: true,
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.rolloutRing).toBe("off");
    expect(result.payload.decision.requestedAuthorityEngineMode).toBe("temporal_authoritative");
    expect(result.payload.decision.authorityEngineMode).toBe("slot_authoritative");
  });

  it("non-internal request cannot bypass gates with overrides", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "cutover-no-bypass",
      internalOnly: false,
      inputOverrides: {
        temporalAuthorityEnabled: true,
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "production",
        requestedAuthorityEngineMode: "temporal_authoritative",
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        projectEligibilityProfileSupported: true,
        unsupportedFeatureFlags: [],
      },
    });

    const result = messages.find((message) => message.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;

    expect(result.payload.decision.authorityEngineMode).toBe("slot_authoritative");
    expect(result.payload.decision.allowed).toBe(false);
    expect(result.payload.decision.blockedReasons).toContain("rollout_ring_off");
  });
});
