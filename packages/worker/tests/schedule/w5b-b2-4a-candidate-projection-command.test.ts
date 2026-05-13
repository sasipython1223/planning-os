import type { Command, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
  __PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK?: boolean;
  __PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING?: "off" | "internal_test" | "dogfood" | "uat" | "production";
  __PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED?: boolean;
  __PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS?: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  __PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS?: readonly string[];
  __PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS?: readonly string[];
  __PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED?: boolean;
  __PLANNER_TEMPORAL_ENGINE_AVAILABLE?: boolean;
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

const wm = (value: number) => value as WorkMinutes;

const savePersistedStateMock = vi.fn();

const buildMockScheduleResponse = (request: any) => ({
  scheduleVersion: 1,
  results: (request.tasks ?? []).map((task: any) => ({
    taskId: task.id,
    earlyStartMinutes: wm(0),
    earlyFinishMinutes: wm(Number(task.durationWorkMinutes) || 0),
    lateStartMinutes: wm(0),
    lateFinishMinutes: wm(Number(task.durationWorkMinutes) || 0),
    totalFloatMinutes: wm(0),
    freeFloatMinutes: wm(0),
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
  delete runtimeScope.__PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED;
  delete runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK;
  delete runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING;
  delete runtimeScope.__PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED;
  delete runtimeScope.__PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS;
  delete runtimeScope.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS;
  delete runtimeScope.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS;
  delete runtimeScope.__PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED;
  delete runtimeScope.__PLANNER_TEMPORAL_ENGINE_AVAILABLE;
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

describe("W5B-B2.4A RUN_TEMPORAL_CANDIDATE_PROJECTION command", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("returns blocked result by default and emits no DIFF_STATE", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
      v: 1,
      reqId: "cand-default",
      internalOnly: true,
    });

    const result = messages.find((message) => message.type === "TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    expect(result?.type).toBe("TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    if (!result || result.type !== "TEMPORAL_CANDIDATE_PROJECTION_RESULT") {
      return;
    }

    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.gateDecision.allowed).toBe(false);
    expect(result.payload.gateDecision.blockedReason).toBe("candidate_projection_flag_disabled");
    expect(result.payload.projection.diagnostics.candidateProjectionAvailable).toBe(false);
    expect(result.payload.projection.diagnostics.candidateProjectionBlockedReason).toBe("candidate_projection_flag_disabled");
    expect(messages.some((message) => message.type === "DIFF_STATE")).toBe(false);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("keeps authority false when gates pass and execution runs diagnostically", () => {
    runtimeScope.__PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED = true;
    runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK = false;
    runtimeScope.__PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING = "dogfood";
    runtimeScope.__PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED = true;
    runtimeScope.__PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS = "ok";
    runtimeScope.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS = [];
    runtimeScope.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS = [];
    runtimeScope.__PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED = true;
    runtimeScope.__PLANNER_TEMPORAL_ENGINE_AVAILABLE = true;

    const messages = dispatch({
      type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
      v: 1,
      reqId: "cand-safe-executed",
      internalOnly: true,
    });

    const result = messages.find((message) => message.type === "TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    expect(result?.type).toBe("TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    if (!result || result.type !== "TEMPORAL_CANDIDATE_PROJECTION_RESULT") {
      return;
    }

    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.gateDecision.allowed).toBe(true);
    expect(result.payload.gateDecision.blockedReason).toBeNull();
    expect(result.payload.projection.diagnostics.candidateProjectionAvailable).toBe(true);
    expect(result.payload.projection.diagnostics.candidateProjectionBlockedReason).toBeNull();
    expect(messages.some((message) => message.type === "DIFF_STATE")).toBe(false);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });
});
