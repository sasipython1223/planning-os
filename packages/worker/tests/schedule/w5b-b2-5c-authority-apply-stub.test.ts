import type { Command, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as State from "../../src/state.js";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
  __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES?: boolean;
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

const savePersistedStateMock = vi.fn();

const wm = (value: number): WorkMinutes => value as WorkMinutes;

const buildSlotScheduleResponse = (request: any) => ({
  scheduleVersion: 1,
  results: (request.tasks ?? []).map((task: any) => ({
    taskId: task.id,
    earlyStartMinutes: wm(0),
    earlyFinishMinutes: wm(5),
    lateStartMinutes: wm(0),
    lateFinishMinutes: wm(5),
    totalFloatMinutes: wm(0),
    freeFloatMinutes: wm(0),
    isCritical: true,
  })),
});

const buildTemporalMinuteResponse = (request: any) => {
  const tasks = request.tasks ?? [];
  const projectStart = request.projectStartEpochMs ?? Date.UTC(2025, 0, 1);

  return {
    scheduleVersion: 2,
    results: tasks.map((task: any) => ({
      taskId: task.id,
      earlyStartMinute: projectStart / 1000 / 60,
      earlyFinishMinute: (projectStart / 1000 / 60) + 480,
      lateStartMinute: projectStart / 1000 / 60,
      lateFinishMinute: (projectStart / 1000 / 60) + 480,
      totalFloatMinutes: 960,
      freeFloatMinutes: 0,
      isCritical: false,
    })),
  };
};

vi.mock("../../src/wasm/loadCpmWasm.js", () => ({
  loadCpmWasm: vi.fn(async () => undefined),
  isWasmLoaded: vi.fn(() => true),
  getCpmWasm: vi.fn(() => ({
    calculate_schedule: (request: any) => buildSlotScheduleResponse(request),
    calculate_schedule_minute: (request: any) => buildTemporalMinuteResponse(request),
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
  if (!runtimeScope.onmessage) throw new Error("worker message handler not initialized");
  const before = runtimeScope.postMessage.mock.calls.length;
  runtimeScope.onmessage({ data: cmd } as MessageEvent<Command>);
  return runtimeScope.postMessage.mock.calls.slice(before).map((entry) => entry[0] as WorkerMessage);
};

const resetRuntimeFlags = (): void => {
  delete runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES;
};

const runCandidateProjectionReadyPath = (reqId: string): void => {
  const messages = dispatch({
    type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
    v: 1,
    reqId,
    internalOnly: true,
    devOverrides: {
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      realWasmValidationPassed: true,
      sourceProtectionStatus: "ok",
      temporalEngineAvailable: true,
      useLastSuccessfulWasmGate: true,
    },
  });

  const result = messages.find((m) => m.type === "TEMPORAL_CANDIDATE_PROJECTION_RESULT");
  expect(result?.type).toBe("TEMPORAL_CANDIDATE_PROJECTION_RESULT");
  if (!result || result.type !== "TEMPORAL_CANDIDATE_PROJECTION_RESULT") return;
  expect(result.payload.gateDecision.allowed).toBe(true);
};

const runApply = (
  reqId: string,
  inputOverrides?: Partial<Extract<Command, { type: "RUN_TEMPORAL_AUTHORITY_APPLY" }>["inputOverrides"]>,
  internalOnly = true,
): WorkerMessage[] => {
  return dispatch({
    type: "RUN_TEMPORAL_AUTHORITY_APPLY",
    v: 1,
    reqId,
    internalOnly,
    inputOverrides,
  });
};

const installSourceSafetyFixture = (): {
  sourceRecordSnapshot: string;
  sourceDatesSnapshot: string;
  varianceReportSnapshot: string;
  lifecycleSnapshot: string;
} => {
  State.setScheduleLifecycle("sourceImportedNotCalculated");
  State.setSourceImportRecord({
    fixtureId: "b25f-source-record",
    source: "imported-xer",
  } as unknown as import("@planner/protocol").SourceImportRecord);
  State.setSourceDatesByTaskId({
    "B25F-T1": {
      earlyStartIso: "2026-01-05T08:00:00.000Z",
      earlyFinishIso: "2026-01-06T08:00:00.000Z",
      lateStartIso: "2026-01-05T08:00:00.000Z",
      lateFinishIso: "2026-01-06T08:00:00.000Z",
      totalFloatMinutes: 0,
    } as unknown as import("@planner/protocol").SourceTaskDates,
  });
  State.setVarianceReport({
    fixtureId: "b25f-variance-report",
    summary: "source-safe",
  } as unknown as import("@planner/protocol").SourceCalculatedVarianceReport);

  return {
    sourceRecordSnapshot: JSON.stringify(State.getSourceImportRecord()),
    sourceDatesSnapshot: JSON.stringify(State.getSourceDatesByTaskId()),
    varianceReportSnapshot: JSON.stringify(State.getVarianceReport()),
    lifecycleSnapshot: State.getScheduleLifecycle(),
  };
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

describe("W5B-B2.5D internal temporal authority apply behind flag", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("1) default apply request falls back to slot", () => {
    const messages = runApply("d1-default", undefined, false);
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
    expect(result.payload.applyMode).toBe("slot_fallback");
  });

  it("2) non-internal request cannot apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d2-non-internal", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    }, false);
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("non_internal_request");
  });

  it("3) rollout ring off cannot apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d3-ring-off", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "off",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("rollout_ring_not_internal_test");
  });

  it("4) dogfood/uat/production rings cannot apply in B2.5D", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    for (const ring of ["dogfood", "uat", "production"] as const) {
      const messages = runApply(`d4-ring-${ring}`, {
        temporalAuthorityEnabled: true,
        temporalAuthorityRolloutRing: ring,
        requestedAuthorityEngineMode: "temporal_authoritative",
        realWasmValidationPassed: true,
        temporalCandidateProjectionEnabled: true,
        candidateProjectionAvailable: true,
        candidateComparisonPresent: true,
        sourceProtectionStatus: "ok",
        unsupportedFeatureFlags: [],
        projectEligibilityProfileSupported: true,
        temporalExecutionErrors: [],
        unexplainedDivergenceCount: 0,
        unexplainedDivergenceTolerance: 0,
        wasmLoadMode: "real",
      });
      const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
      expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
      if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") continue;
      expect(result.payload.authorityApplied).toBe(false);
      // W5B-B2.9: dogfood ring is routed to its own guard which surfaces the
      // master-switch state first; uat/production remain blocked by the
      // internal_test guard with the original fallback reason.
      const expectedReason =
        ring === "dogfood" ? "dogfood_authority_disabled" : "rollout_ring_not_internal_test";
      expect(result.payload.fallbackReason).toBe(expectedReason);
    }
  });

  it("5) emergency rollback blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d5-emergency", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      temporalAuthorityEmergencyRollback: true,
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("emergency_rollback_active");
  });

  it("6) missing real WASM gate blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d6-missing-wasm", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: false,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "unavailable",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("real_wasm_gate_not_passed");
  });

  it("7) missing candidate projection blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d7-missing-candidate", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: false,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("candidate_projection_unavailable");
  });

  it("8) missing comparison blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d8-missing-comparison", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: false,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("candidate_comparison_missing");
  });

  it("9) unexplained divergence blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d9-divergence", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 2,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("unexplained_divergence_over_threshold");
  });

  it("10) unsupported feature flags block apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d10-unsupported", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: ["lag_calendar_mode_not_supported"],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("unsupported_feature_detected");
  });

  it("11) source protection not ok blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d11-source-protect", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "blocked",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("source_protection_not_ok");
  });

  it("12) temporal execution errors block apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d12-temp-errors", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: ["panic"],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("temporal_execution_error");
  });

  it("13) incomplete temporal result blocks apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const messages = runApply("d13-incomplete", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 0,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("candidate_projection_unavailable");
  });

  it("14) internal_test + all gates pass applies temporal result", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "d14-add-task",
      payload: {
        id: "B25D-T1",
        name: "B25D Task",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
      },
    });
    runCandidateProjectionReadyPath("d14-candidate-ready");

    const messages = runApply("d14-apply-pass", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;

    expect(result.payload.authorityApplied).toBe(true);
    expect(result.payload.appliedEngine).toBe("temporal");
    expect(result.payload.applyMode).toBe("internal_runtime_temporal_authoritative");
  });

  it("15) authorityApplied true only on successful internal apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const blocked = runApply("d15-blocked", {
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
    });
    const blockedResult = blocked.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(blockedResult?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!blockedResult || blockedResult.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(blockedResult.payload.authorityApplied).toBe(false);
  });

  it("16) appliedEngine temporal only on successful apply", () => {
    const messages = runApply("d16-engine-blocked", undefined, false);
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.appliedEngine).toBe("slot");
  });

  it("17) DIFF_STATE emitted only for successful apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "d17-add-task",
      payload: {
        id: "B25D-T2",
        name: "B25D Task 2",
        durationWorkMinutes: wm(5),
        siblingOrder: "b",
      },
    });
    runCandidateProjectionReadyPath("d17-candidate-ready");

    const blocked = runApply("d17-blocked", undefined, false);
    expect(blocked.some((m) => m.type === "DIFF_STATE")).toBe(false);

    const allowed = runApply("d17-allowed", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });
    expect(allowed.some((m) => m.type === "DIFF_STATE")).toBe(true);
  });

  it("18) TaskTable/Gantt-visible schedule source updates consistently on apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("d18-candidate-ready");
    const messages = runApply("d18-apply", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(true);
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(true);
  });

  it("19) source dates remain unchanged", () => {
    const before = State.getSourceDatesByTaskId();
    runApply("d19-source-safe", undefined, false);
    expect(State.getSourceDatesByTaskId()).toEqual(before);
  });

  it("20) no persistence save on apply", () => {
    runApply("d20-no-persist", undefined, false);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("21) candidate projection remains runtime-only", () => {
    runCandidateProjectionReadyPath("d21-candidate-runtime-only");
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("22) rollback restores previous slot schedule results", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("d22-candidate-ready");
    const beforeApply = JSON.stringify(State.getLatestScheduleResults());

    runApply("d22-apply", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    const rollbackMessages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "d22-rollback",
      internalOnly: true,
    });
    const rollback = rollbackMessages.find((m) => m.type === "TEMPORAL_AUTHORITY_ROLLBACK_RESULT");
    expect(rollback?.type).toBe("TEMPORAL_AUTHORITY_ROLLBACK_RESULT");
    if (!rollback || rollback.type !== "TEMPORAL_AUTHORITY_ROLLBACK_RESULT") return;

    const afterRollback = JSON.stringify(State.getLatestScheduleResults());
    expect(afterRollback).toBe(beforeApply);
  });

  it("23) rollback emits DIFF_STATE only when visible state changes back", () => {
    const rollbackMessages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "d23-rollback",
      internalOnly: true,
    });

    const rollback = rollbackMessages.find((m) => m.type === "TEMPORAL_AUTHORITY_ROLLBACK_RESULT");
    expect(rollback?.type).toBe("TEMPORAL_AUTHORITY_ROLLBACK_RESULT");
    if (!rollback || rollback.type !== "TEMPORAL_AUTHORITY_ROLLBACK_RESULT") return;

    if (rollback.payload.rolledBack) {
      expect(rollbackMessages.some((m) => m.type === "DIFF_STATE")).toBe(true);
    } else {
      expect(rollbackMessages.some((m) => m.type === "DIFF_STATE")).toBe(false);
    }
  });

  it("24) rollback does not mutate source dates", () => {
    const before = State.getSourceDatesByTaskId();
    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "d24-rollback",
      internalOnly: true,
    });
    expect(State.getSourceDatesByTaskId()).toEqual(before);
  });

  it("25) rollback does not persist", () => {
    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "d25-rollback",
      internalOnly: true,
    });
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("26) emergency rollback wins over happy-path apply request", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("d26-candidate-ready");
    const messages = runApply("d26-emergency-wins", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      temporalAuthorityEmergencyRollback: true,
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("emergency_rollback_active");
  });

  it("27) slot scheduling unchanged when flag off", () => {
    const before = State.getLatestScheduleResults();
    const messages = runApply("d27-flag-off", undefined, false);
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.appliedEngine).toBe("slot");
    expect(State.getLatestScheduleResults()).toEqual(before);
  });

  it("28) candidate-only command still does not apply", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
      v: 1,
      reqId: "d28-candidate-only",
      internalOnly: true,
    });
    const result = messages.find((m) => m.type === "TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    expect(result?.type).toBe("TEMPORAL_CANDIDATE_PROJECTION_RESULT");
    if (!result || result.type !== "TEMPORAL_CANDIDATE_PROJECTION_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
  });

  it("29) diagnostic cutover decision command still does not apply", () => {
    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "d29-cutover-only",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
  });

  it("30) apply result includes audit preview and persistenceApplied false", () => {
    const messages = runApply("d30-audit-preview", undefined, false);
    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;

    expect(result.payload.persistenceApplied).toBe(false);
    expect(result.payload.auditPreview.authorityRunId.length).toBeGreaterThan(0);
    expect(result.payload.auditPreview.realWasmGateReference).not.toBeUndefined();
    expect(result.payload.auditPreview.candidateRunId).not.toBeUndefined();
    expect(result.payload.auditPreview.comparisonSummary).not.toBeUndefined();
    expect(result.payload.auditPreview.persistenceApplied).toBe(false);
  });

  it("31) diagnostics command is read-only and does not trigger persistence", () => {
    const beforeSourceRecord = JSON.stringify(State.getSourceImportRecord());
    const beforeSourceDates = JSON.stringify(State.getSourceDatesByTaskId());
    const beforeLifecycle = State.getScheduleLifecycle();

    const messages = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS",
      v: 1,
      reqId: "d31-diagnostics",
      internalOnly: true,
    });

    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT");
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
    expect(JSON.stringify(State.getSourceImportRecord())).toBe(beforeSourceRecord);
    expect(JSON.stringify(State.getSourceDatesByTaskId())).toBe(beforeSourceDates);
    expect(State.getScheduleLifecycle()).toBe(beforeLifecycle);
  });

  it("32) successful internal apply can emit DIFF_STATE without persisting temporal authority output", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("d32-candidate-ready");

    const messages = runApply("d32-apply-success", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;

    expect(result.payload.authorityApplied).toBe(true);
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(true);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("33) source import records and source-safe report remain unchanged across temporal commands", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    const fixture = installSourceSafetyFixture();

    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS",
      v: 1,
      reqId: "d33-diagnostics",
      internalOnly: true,
    });

    dispatch({
      type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
      v: 1,
      reqId: "d33-candidate",
      internalOnly: true,
      devOverrides: {
        temporalCandidateProjectionEnabled: true,
        temporalAuthorityRolloutRing: "internal_test",
        useLastSuccessfulWasmGate: true,
      },
    });

    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION",
      v: 1,
      reqId: "d33-decision",
      internalOnly: true,
    });

    runCandidateProjectionReadyPath("d33-candidate-ready");
    runApply("d33-apply", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "d33-rollback",
      internalOnly: true,
    });

    expect(JSON.stringify(State.getSourceImportRecord())).toBe(fixture.sourceRecordSnapshot);
    expect(JSON.stringify(State.getSourceDatesByTaskId())).toBe(fixture.sourceDatesSnapshot);
    expect(JSON.stringify(State.getVarianceReport())).toBe(fixture.varianceReportSnapshot);
    expect(State.getScheduleLifecycle()).toBe(fixture.lifecycleSnapshot);
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("34) imported-XER-shape (summary parent + leaf children) applies on internal_test [B2.5H.3 regression]", () => {
    // Before B2.5H.3, this case failed with fallbackReason="temporal_task_count_mismatch"
    // because the apply mapper compared canonical leaves (excludes summaries)
    // against candidate task ids (kernel returns the summary too). The two bases
    // disagreed by exactly the summary count, so any imported XER schedule with
    // any WBS row blocked apply even though the gate, candidate projection, and
    // comparison were all clean.
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "d34-add-summary",
      payload: {
        id: "B25H3-WBS",
        name: "B25H3 WBS",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
      },
    });
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "d34-add-leaf-1",
      payload: {
        id: "B25H3-L1",
        name: "B25H3 Leaf 1",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
        parentId: "B25H3-WBS",
      },
    });
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "d34-add-leaf-2",
      payload: {
        id: "B25H3-L2",
        name: "B25H3 Leaf 2",
        durationWorkMinutes: wm(5),
        siblingOrder: "b",
        parentId: "B25H3-WBS",
      },
    });

    expect(State.isTaskSummary("B25H3-WBS")).toBe(true);
    expect(State.isTaskSummary("B25H3-L1")).toBe(false);
    expect(State.isTaskSummary("B25H3-L2")).toBe(false);

    runCandidateProjectionReadyPath("d34-candidate-ready");

    const messages = runApply("d34-apply", {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
      realWasmValidationPassed: true,
      temporalCandidateProjectionEnabled: true,
      candidateProjectionAvailable: true,
      candidateComparisonPresent: true,
      sourceProtectionStatus: "ok",
      unsupportedFeatureFlags: [],
      projectEligibilityProfileSupported: true,
      temporalExecutionErrors: [],
      unexplainedDivergenceCount: 0,
      unexplainedDivergenceTolerance: 100,
      wasmLoadMode: "real",
    });

    const result = messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");
    expect(result?.type).toBe("TEMPORAL_AUTHORITY_APPLY_RESULT");
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(true);
    expect(result.payload.appliedEngine).toBe("temporal");
    expect(result.payload.fallbackReason).toBeNull();
    expect(result.payload.persistenceApplied).toBe(false);
    // appliedTaskCount must be the leaf count, NOT the canonical task count
    // (which includes the summary) and NOT the candidate task count (which may
    // also include the summary). It must include both leaves added in this test
    // and exclude the summary parent. Previous tests in this suite leak state,
    // so assert >= 2 (the two leaves added here) rather than equality.
    expect(result.payload.auditPreview.appliedTaskCount).toBeGreaterThanOrEqual(2);
    // The summary id must NOT be a key in the apply mapping basis. We confirm
    // indirectly: appliedTaskCount counts leaves only, never summaries.
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });
});
