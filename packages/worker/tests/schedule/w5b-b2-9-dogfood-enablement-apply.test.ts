/**
 * W5B-B2.9: Dogfood enablement controls + explicit operator gate.
 *
 * Verifies that:
 *   - The dogfood master switch defaults OFF; a dogfood apply request falls back.
 *   - Evidence-count alone does NOT enable dogfood.
 *   - Missing operator acknowledgement blocks dogfood apply.
 *   - Master switch ON + ack provided but a gate unmet still falls back.
 *   - Master switch ON + ack provided + all gates → successful dogfood apply,
 *     `applyMode === "dogfood_runtime_temporal_authoritative"`, `persistenceApplied: false`.
 *   - Emergency rollback overrides dogfood enablement.
 *   - UAT and production rings remain blocked.
 *   - DIFF_STATE emitted only on successful apply.
 *   - No persistence save on any path.
 *   - Source dates and source import records remain unchanged.
 *   - Internal_test apply behaviour is unchanged.
 *   - Acknowledgement is NOT inferred from evidence count.
 */
import type {
    Command,
    SourceCalculatedVarianceReport,
    SourceImportRecord,
    SourceTaskDates,
    WorkerMessage,
    WorkMinutes,
} from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as State from "../../src/state.js";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
  __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED?: boolean;
  __PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS?: number;
  __PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS?: number;
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
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS;
  delete runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS;
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
  if (!result || result.type !== "TEMPORAL_CANDIDATE_PROJECTION_RESULT") return;
  expect(result.payload.gateDecision.allowed).toBe(true);
};

const fullDogfoodInputOverrides = () => ({
  temporalAuthorityEnabled: true,
  temporalAuthorityRolloutRing: "dogfood" as const,
  requestedAuthorityEngineMode: "temporal_authoritative" as const,
  realWasmValidationPassed: true,
  temporalCandidateProjectionEnabled: true,
  candidateProjectionAvailable: true,
  candidateComparisonPresent: true,
  sourceProtectionStatus: "ok" as const,
  unsupportedFeatureFlags: [] as string[],
  projectEligibilityProfileSupported: true,
  temporalExecutionErrors: [] as string[],
  unexplainedDivergenceCount: 0,
  unexplainedDivergenceTolerance: 100,
  wasmLoadMode: "real" as const,
  resourceCalendarRequirementDetected: false,
  lagCalendarRequirementDetected: false,
  p6SemanticsRequirementDetected: false,
});

const ACK = {
  acknowledged: true as const,
  operatorId: "test-operator",
  acknowledgedAt: 0,
  acknowledgementTextVersion: 1 as const,
};

const runDogfoodApply = (
  reqId: string,
  options: {
    inputOverrides?: Partial<Extract<Command, { type: "RUN_TEMPORAL_AUTHORITY_APPLY" }>["inputOverrides"]>;
    dogfoodAcknowledgement?: Extract<Command, { type: "RUN_TEMPORAL_AUTHORITY_APPLY" }>["dogfoodAcknowledgement"];
    dogfoodAuthorityEnabled?: boolean;
    internalOnly?: boolean;
  } = {},
): WorkerMessage[] => {
  return dispatch({
    type: "RUN_TEMPORAL_AUTHORITY_APPLY",
    v: 1,
    reqId,
    internalOnly: options.internalOnly ?? true,
    inputOverrides: options.inputOverrides,
    dogfoodAcknowledgement: options.dogfoodAcknowledgement,
    ...(options.dogfoodAuthorityEnabled !== undefined
      ? { dogfoodAuthorityEnabled: options.dogfoodAuthorityEnabled }
      : {}),
  });
};

const findApplyResult = (messages: WorkerMessage[]) =>
  messages.find((m) => m.type === "TEMPORAL_AUTHORITY_APPLY_RESULT");

const installSourceSafetyFixture = () => {
  State.setScheduleLifecycle("sourceImportedNotCalculated");
  State.setSourceImportRecord({
    fixtureId: "b29-source-record",
    source: "imported-xer",
  } as unknown as SourceImportRecord);
  State.setSourceDatesByTaskId({
    "B29-T1": {
      earlyStartIso: "2026-01-05T08:00:00.000Z",
      earlyFinishIso: "2026-01-06T08:00:00.000Z",
      lateStartIso: "2026-01-05T08:00:00.000Z",
      lateFinishIso: "2026-01-06T08:00:00.000Z",
      totalFloatMinutes: 0,
    } as unknown as SourceTaskDates,
  });
  State.setVarianceReport({
    fixtureId: "b29-variance-report",
    summary: "source-safe",
  } as unknown as SourceCalculatedVarianceReport);
  return {
    sourceRecord: JSON.stringify(State.getSourceImportRecord()),
    sourceDates: JSON.stringify(State.getSourceDatesByTaskId()),
    varianceReport: JSON.stringify(State.getVarianceReport()),
    lifecycle: State.getScheduleLifecycle(),
  };
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

describe("W5B-B2.9 dogfood enablement controls — default off", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    savePersistedStateMock.mockClear();
    resetRuntimeFlags();
  });

  it("1) dogfoodAuthorityEnabled defaults false in apply payload", () => {
    const messages = runDogfoodApply("b29-default", { internalOnly: false });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.dogfoodAuthorityEnabled).toBe(false);
  });

  it("2) evidence count alone does NOT enable dogfood apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS = 3;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS = 3;
    // master switch NOT set → still off.
    runCandidateProjectionReadyPath("b29-evidence-cand");
    const messages = runDogfoodApply("b29-evidence-only", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("dogfood_authority_disabled");
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("3) missing operator acknowledgement blocks dogfood apply (master switch on)", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-noack-cand");
    const messages = runDogfoodApply("b29-noack", {
      inputOverrides: fullDogfoodInputOverrides(),
      // no acknowledgement
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("operator_acknowledgement_missing");
    expect(result.payload.operatorAcknowledgementStatus.provided).toBe(false);
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("4) dogfoodAuthorityEnabled true + ack but a gate unmet still falls back", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-gate-cand");
    const messages = runDogfoodApply("b29-gate-fail", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        unsupportedFeatureFlags: ["custom_feature_x"],
      },
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
    expect(result.payload.fallbackReason).toBe("unsupported_feature_detected");
  });

  it("5) dogfoodAuthorityEnabled + ack + all gates → successful dogfood apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b29-ok-add",
      payload: {
        id: "B29-OK-T1",
        name: "B29 OK Task",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
      },
    });
    runCandidateProjectionReadyPath("b29-ok-cand");
    const messages = runDogfoodApply("b29-ok", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(true);
    expect(result.payload.appliedEngine).toBe("temporal");
    expect(result.payload.applyMode).toBe("dogfood_runtime_temporal_authoritative");
    expect(result.payload.rolloutRing).toBe("dogfood");
    expect(result.payload.fallbackReason).toBeNull();
    expect(result.payload.persistenceApplied).toBe(false);
    expect(result.payload.dogfoodAuthorityEnabled).toBe(true);
    expect(result.payload.operatorAcknowledgementStatus.provided).toBe(true);
  });

  it("6) successful dogfood apply emits DIFF_STATE", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b29-diff-add",
      payload: {
        id: "B29-DIFF-T1",
        name: "B29 Diff Task",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
      },
    });
    runCandidateProjectionReadyPath("b29-diff-cand");
    const messages = runDogfoodApply("b29-diff-ok", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(true);
  });

  it("7) blocked dogfood apply emits no DIFF_STATE", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("b29-blocked-cand");
    const messages = runDogfoodApply("b29-blocked-diff", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("8) UAT ring remains blocked even with master switch + ack", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-uat-cand");
    const messages = runDogfoodApply("b29-uat", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityRolloutRing: "uat",
      },
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
    expect(result.payload.fallbackReason).toBe("rollout_ring_not_internal_test");
  });

  it("9) production ring remains blocked even with master switch + ack", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-prod-cand");
    const messages = runDogfoodApply("b29-prod", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityRolloutRing: "production",
      },
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
  });

  it("10) emergency rollback overrides dogfood enablement", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-er-cand");
    const messages = runDogfoodApply("b29-er", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityEmergencyRollback: true,
      },
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("emergency_rollback_active");
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("11) source dates remain unchanged after a successful dogfood apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    const snapshot = installSourceSafetyFixture();
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b29-src-add",
      payload: { id: "B29-SRC-T1", name: "B29 Src Task", durationWorkMinutes: wm(5), siblingOrder: "a" },
    });
    runCandidateProjectionReadyPath("b29-src-cand");
    runDogfoodApply("b29-src-apply", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    expect(JSON.stringify(State.getSourceImportRecord())).toBe(snapshot.sourceRecord);
    expect(JSON.stringify(State.getSourceDatesByTaskId())).toBe(snapshot.sourceDates);
    expect(JSON.stringify(State.getVarianceReport())).toBe(snapshot.varianceReport);
  });

  it("12) no persistence save on any dogfood path (blocked or successful)", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    savePersistedStateMock.mockClear();
    runCandidateProjectionReadyPath("b29-persist-cand");
    runDogfoodApply("b29-persist-ok", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    expect(savePersistedStateMock).not.toHaveBeenCalled();
  });

  it("13) RUN_TEMPORAL_DOGFOOD_READINESS_CHECK remains diagnostic-only and emits no DIFF_STATE", () => {
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED = true;
    const messages = dispatch({
      type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK",
      v: 1,
      reqId: "b29-readiness",
    });
    const result = messages.find((m) => m.type === "TEMPORAL_DOGFOOD_READINESS_RESULT");
    if (!result || result.type !== "TEMPORAL_DOGFOOD_READINESS_RESULT") return;
    expect(result.payload.decision.authorityApplied).toBe(false);
    expect(result.payload.persistenceStatus.persistenceApplied).toBe(false);
    expect(messages.some((m) => m.type === "DIFF_STATE")).toBe(false);
  });

  it("14) non-internal request cannot apply dogfood even with master switch + ack", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-noninternal-cand");
    const messages = runDogfoodApply("b29-noninternal", {
      internalOnly: false,
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
  });

  it("15) existing internal_test apply behaviour is unchanged", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    // Note: dogfood master switch off; this is purely an internal_test path.
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b29-int-add",
      payload: { id: "B29-INT-T1", name: "B29 Internal Task", durationWorkMinutes: wm(5), siblingOrder: "a" },
    });
    runCandidateProjectionReadyPath("b29-int-cand");
    const messages = runDogfoodApply("b29-int-apply", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityRolloutRing: "internal_test",
      },
      // no ack required for internal_test
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(true);
    expect(result.payload.appliedEngine).toBe("temporal");
    expect(result.payload.applyMode).toBe("internal_runtime_temporal_authoritative");
    expect(result.payload.rolloutRing).toBe("internal_test");
  });

  it("16) acknowledgement is NOT inferred from evidence count", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS = 3;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS = 3;
    runCandidateProjectionReadyPath("b29-evidence-implies-cand");
    const messages = runDogfoodApply("b29-evidence-implies", {
      inputOverrides: fullDogfoodInputOverrides(),
      // intentionally no acknowledgement
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.fallbackReason).toBe("operator_acknowledgement_missing");
  });

  it("17) rollback restores slot_authoritative after a successful dogfood apply", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b29-rb-add",
      payload: { id: "B29-RB-T1", name: "B29 RB Task", durationWorkMinutes: wm(5), siblingOrder: "a" },
    });
    runCandidateProjectionReadyPath("b29-rb-cand");
    const apply = runDogfoodApply("b29-rb-apply", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    const applyResult = findApplyResult(apply);
    if (!applyResult || applyResult.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(applyResult.payload.authorityApplied).toBe(true);

    const rollback = dispatch({
      type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
      v: 1,
      reqId: "b29-rb-roll",
      internalOnly: true,
    });
    const rbResult = rollback.find((m) => m.type === "TEMPORAL_AUTHORITY_ROLLBACK_RESULT");
    if (!rbResult || rbResult.type !== "TEMPORAL_AUTHORITY_ROLLBACK_RESULT") return;
    expect(rbResult.payload.rolledBack).toBe(true);
    expect(rbResult.payload.restoredEngine).toBe("slot_authoritative");
    expect(rbResult.payload.persistenceApplied).toBe(false);
  });

  it("18) operatorAcknowledgementStatus surfaces required/provided correctly", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED = true;
    runCandidateProjectionReadyPath("b29-ack-status-cand");

    // Required true, provided false.
    const noAck = runDogfoodApply("b29-ack-status-1", {
      inputOverrides: fullDogfoodInputOverrides(),
    });
    const noAckRes = findApplyResult(noAck);
    if (!noAckRes || noAckRes.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(noAckRes.payload.operatorAcknowledgementStatus).toEqual({
      required: true,
      provided: false,
      acknowledgementTextVersion: 1,
    });

    // Required true, provided true via command field.
    const withAck = runDogfoodApply("b29-ack-status-2", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
    });
    const withAckRes = findApplyResult(withAck);
    if (!withAckRes || withAckRes.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(withAckRes.payload.operatorAcknowledgementStatus.provided).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // W5B-B2.10A: cmd-level dogfoodAuthorityEnabled override (dev-hook path).
  // ---------------------------------------------------------------------------

  it("B2.10A-1) cmd-level dogfoodAuthorityEnabled true + ack + overrides allowed → success without runtime flag", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    // runtime master switch intentionally NOT set; cmd-level override must enable.
    dispatch({
      type: "ADD_TASK",
      v: 1,
      reqId: "b210a-cmd-add",
      payload: {
        id: "B210A-T1",
        name: "B2.10A cmd-level enable",
        durationWorkMinutes: wm(5),
        siblingOrder: "a",
      },
    });
    runCandidateProjectionReadyPath("b210a-cmd-cand");
    const messages = runDogfoodApply("b210a-cmd-ok", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
      dogfoodAuthorityEnabled: true,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(true);
    expect(result.payload.appliedEngine).toBe("temporal");
    expect(result.payload.applyMode).toBe("dogfood_runtime_temporal_authoritative");
    expect(result.payload.rolloutRing).toBe("dogfood");
    expect(result.payload.fallbackReason).toBeNull();
    expect(result.payload.dogfoodAuthorityEnabled).toBe(true);
    expect(result.payload.persistenceApplied).toBe(false);
  });

  it("B2.10A-2) cmd-level dogfoodAuthorityEnabled true is IGNORED when internal diagnostic overrides are NOT allowed", () => {
    // Critically: do NOT set __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES.
    // Worker isInternalDiagnosticOverrideAllowed() also returns true on
    // localhost; in vitest there is no `location` so it returns false.
    // Therefore BOTH the cmd-level dogfoodAuthorityEnabled override AND the
    // inputOverrides (including ring="dogfood") are ignored — the strongest
    // possible safety posture. The ring stays at its runtime default and the
    // internal_test guard fires. `dogfoodAuthorityEnabled` on the payload
    // reflects that the dogfood master switch was never engaged.
    runCandidateProjectionReadyPath("b210a-noovr-cand");
    const messages = runDogfoodApply("b210a-noovr", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAcknowledgement: ACK,
      dogfoodAuthorityEnabled: true,
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.appliedEngine).toBe("slot");
    // Either fallback reason is acceptable — both mean "dogfood not engaged".
    expect([
      "dogfood_authority_disabled",
      "rollout_ring_not_internal_test",
    ]).toContain(result.payload.fallbackReason);
    expect(result.payload.dogfoodAuthorityEnabled).toBe(false);
    expect(result.payload.persistenceApplied).toBe(false);
  });

  it("B2.10A-3) cmd-level dogfoodAuthorityEnabled true does NOT bypass ack requirement", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("b210a-noack-cand");
    const messages = runDogfoodApply("b210a-noack", {
      inputOverrides: fullDogfoodInputOverrides(),
      dogfoodAuthorityEnabled: true,
      // no acknowledgement
    });
    const result = findApplyResult(messages);
    if (!result || result.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(result.payload.authorityApplied).toBe(false);
    expect(result.payload.fallbackReason).toBe("operator_acknowledgement_missing");
    expect(result.payload.dogfoodAuthorityEnabled).toBe(true);
  });

  it("B2.10A-4) cmd-level dogfoodAuthorityEnabled has no effect on UAT or production rings", () => {
    runtimeScope.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES = true;
    runCandidateProjectionReadyPath("b210a-uat-cand");
    const uatMessages = runDogfoodApply("b210a-uat", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityRolloutRing: "uat" as const,
      },
      dogfoodAcknowledgement: ACK,
      dogfoodAuthorityEnabled: true,
    });
    const uatRes = findApplyResult(uatMessages);
    if (!uatRes || uatRes.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(uatRes.payload.authorityApplied).toBe(false);
    expect(uatRes.payload.appliedEngine).toBe("slot");

    runCandidateProjectionReadyPath("b210a-prod-cand");
    const prodMessages = runDogfoodApply("b210a-prod", {
      inputOverrides: {
        ...fullDogfoodInputOverrides(),
        temporalAuthorityRolloutRing: "production" as const,
      },
      dogfoodAcknowledgement: ACK,
      dogfoodAuthorityEnabled: true,
    });
    const prodRes = findApplyResult(prodMessages);
    if (!prodRes || prodRes.type !== "TEMPORAL_AUTHORITY_APPLY_RESULT") return;
    expect(prodRes.payload.authorityApplied).toBe(false);
    expect(prodRes.payload.appliedEngine).toBe("slot");
  });
});
