import type {
    RunTemporalAuthorityApplyCommand,
    RunTemporalAuthorityDiagnosticsCommand,
    RunTemporalAuthorityRollbackCommand,
    RunTemporalCandidateProjectionCommand,
    RunTemporalWasmValidationGateCommand,
    TemporalAuthorityApplyResultMessage,
    TemporalAuthorityApplyResultPayload,
    TemporalAuthorityDiagnosticsMessage,
    TemporalAuthorityDiagnosticsPayload,
    TemporalAuthorityRollbackResultMessage,
    TemporalAuthorityRollbackResultPayload,
    TemporalCandidateProjectionResultMessage,
    TemporalCandidateProjectionResultPayload,
    TemporalWasmValidationGateMessage,
    TemporalWasmValidationGatePayload,
} from "@planner/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    installWorkerDevHooks,
    isDevOrTestMode,
    runTemporalAuthorityApply,
    runTemporalAuthorityDiagnostics,
    runTemporalAuthorityRollback,
    runTemporalCandidateProjection,
    runTemporalWasmValidationGate,
    uninstallWorkerDevHooks,
} from "./workerDevHooks";

/**
 * Dev/test-only Worker diagnostic hooks — unit tests
 *
 * Tests validate the browser hook infrastructure without requiring a real Worker.
 * Uses a mock Worker-like object to simulate command sending and response handling.
 */

describe("workerDevHooks", () => {
  let mockWorker: any;
  let messageListeners: ((event: MessageEvent) => void)[] = [];

  beforeEach(() => {
    messageListeners = [];
    delete (globalThis as any).__runTemporalWasmValidationGate;
    delete (globalThis as any).__runTemporalCandidateProjection;
    delete (globalThis as any).__runTemporalAuthorityApply;
    delete (globalThis as any).__runTemporalAuthorityRollback;
    delete (globalThis as any).__getTemporalAuthorityDiagnostics;

    // Create a mock Worker with addEventListener and postMessage
    mockWorker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") {
          messageListeners.push(listener);
        }
      }),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    uninstallWorkerDevHooks(mockWorker);
  });

  it("isDevOrTestMode supports dev and test guards", () => {
    expect(isDevOrTestMode({ DEV: true, MODE: "production" })).toBe(true);
    expect(isDevOrTestMode({ DEV: false, MODE: "test" })).toBe(true);
    expect(isDevOrTestMode({ DEV: false, MODE: "production" })).toBe(false);
  });

  it("installs hook in test mode", () => {
    installWorkerDevHooks(mockWorker);
    expect(typeof (globalThis as any).__runTemporalWasmValidationGate).toBe("function");
    expect(typeof (globalThis as any).__runTemporalCandidateProjection).toBe("function");
    expect(typeof (globalThis as any).__runTemporalAuthorityApply).toBe("function");
    expect(typeof (globalThis as any).__runTemporalAuthorityRollback).toBe("function");
    expect(typeof (globalThis as any).__getTemporalAuthorityDiagnostics).toBe("function");
  });

  it("does not install hooks outside dev/test mode", () => {
    installWorkerDevHooks(mockWorker, { DEV: false, MODE: "production" });
    expect((globalThis as any).__runTemporalWasmValidationGate).toBeUndefined();
    expect((globalThis as any).__runTemporalCandidateProjection).toBeUndefined();
    expect((globalThis as any).__runTemporalAuthorityApply).toBeUndefined();
    expect((globalThis as any).__runTemporalAuthorityRollback).toBeUndefined();
    expect((globalThis as any).__getTemporalAuthorityDiagnostics).toBeUndefined();
  });

  it("sends RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS command and resolves by matching reqId", async () => {
    const payload: TemporalAuthorityDiagnosticsPayload = {
      currentAuthorityEngineMode: "slot_authoritative",
      previousAuthorityEngineMode: "slot_authoritative",
      appliedEngine: "unknown",
      applyMode: "unknown",
      rolloutRing: "unknown",
      authorityApplied: false,
      fallbackReason: null,
      lastTemporalAuthorityRunId: null,
      lastTemporalAuthorityDecision: null,
      lastTemporalAuthorityAuditPreview: null,
      lastTemporalCandidateRunId: null,
      candidateProjectionAvailable: false,
      comparisonPresent: false,
      unexplainedDivergenceCount: null,
      realWasmValidationPassed: null,
      wasmLoadMode: "unknown",
      sourceProtectionStatus: "unknown",
      persistenceApplied: false,
    };

    const promise = runTemporalAuthorityDiagnostics(mockWorker);
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);

    const sent = mockWorker.postMessage.mock.calls[0][0] as RunTemporalAuthorityDiagnosticsCommand;
    expect(sent.type).toBe("RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS");
    expect(sent.internalOnly).toBe(true);

    const wrongResponse: TemporalAuthorityDiagnosticsMessage = {
      type: "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT",
      v: 1,
      reqId: "wrong-id",
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: wrongResponse })));

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    const correctResponse: TemporalAuthorityDiagnosticsMessage = {
      type: "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT",
      v: 1,
      reqId: sent.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: correctResponse })));

    await expect(promise).resolves.toEqual(payload);
  });

  it("sends RUN_TEMPORAL_AUTHORITY_APPLY command with reqId and internalOnly", async () => {
    const payload: TemporalAuthorityApplyResultPayload = {
      decision: {
        authorityEngineMode: "temporal_authoritative",
        requestedAuthorityEngineMode: "temporal_authoritative",
        rolloutRing: "internal_test",
        allowed: true,
        fallbackRequired: false,
        fallbackReason: null,
        blockedReasons: [],
        gatePassMatrix: {
          rolloutRingEnabled: true,
          temporalAuthorityEnabled: true,
          emergencyRollbackClear: true,
          realWasmGate: true,
          candidateProjectionAvailable: true,
          candidateComparisonPresent: true,
          candidateAuthorityPrecondition: true,
          temporalExecutionErrorFree: true,
          unexplainedDivergenceWithinTolerance: true,
          sourceProtectionValid: true,
          unsupportedFeatureFlagsAllowed: true,
          projectEligibilityProfileSupported: true,
          resourceCalendarRequirementSupported: true,
          lagCalendarRequirementSupported: true,
          p6SemanticsRequirementSupported: true,
          performanceWithinThreshold: true,
          lifecycleSafetyValid: true,
        },
        emergencyRollbackActive: false,
        sourceProtectionStatus: "ok",
        realWasmGateStatus: {
          required: true,
          passed: true,
          wasmLoadMode: "real",
        },
        candidateProjectionStatus: {
          candidateProjectionEnabled: true,
          available: true,
        },
        comparisonStatus: {
          required: true,
          present: true,
        },
        unsupportedFeatureFlags: [],
        unexplainedDivergenceCount: 0,
        performanceMs: 3,
        authorityApplied: false,
      },
      evaluatedAt: Date.now(),
      authorityApplied: true,
      appliedEngine: "temporal",
      fallbackReason: null,
      applyMode: "internal_runtime_temporal_authoritative",
      persistenceApplied: false,
      auditPreview: {
        authorityRunId: "run-1",
        timestamp: Date.now(),
        previousAuthorityEngine: "slot_authoritative",
        requestedAuthorityEngine: "temporal_authoritative",
        effectiveAuthorityEngine: "temporal_authoritative",
        rolloutRing: "internal_test",
        realWasmGateReference: null,
        candidateRunId: "cand-1",
        comparisonSummary: null,
        appliedTaskCount: 1,
        fallbackReason: null,
        sourceProtectionStatus: "ok",
        unsupportedFeatureFlags: [],
        unexplainedDivergenceCount: 0,
        performanceMs: 3,
        authorityApplied: false,
        persistenceApplied: false,
      },
      rolloutRing: "internal_test",
      dogfoodAuthorityEnabled: false,
      operatorAcknowledgementStatus: {
        required: true,
        provided: false,
        acknowledgementTextVersion: 1,
      },
    };

    const promise = runTemporalAuthorityApply(mockWorker, {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      requestedAuthorityEngineMode: "temporal_authoritative",
    });

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sent = mockWorker.postMessage.mock.calls[0][0] as RunTemporalAuthorityApplyCommand;
    expect(sent.type).toBe("RUN_TEMPORAL_AUTHORITY_APPLY");
    expect(sent.reqId).toBeTruthy();
    expect(sent.internalOnly).toBe(true);
    expect(sent.inputOverrides?.temporalAuthorityEnabled).toBe(true);

    const response: TemporalAuthorityApplyResultMessage = {
      type: "TEMPORAL_AUTHORITY_APPLY_RESULT",
      v: 1,
      reqId: sent.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: response })));

    await expect(promise).resolves.toEqual(payload);
  });

  it("W5B-B2.10A: forwards dogfoodAuthorityEnabled and dogfoodAcknowledgement to the worker command, and keeps them off inputOverrides", async () => {
    const ackPayload = {
      acknowledged: true,
      operatorId: "internal-dogfood-operator",
      acknowledgedAt: 1715000000000,
      acknowledgementTextVersion: 1 as const,
    };

    void runTemporalAuthorityApply(mockWorker, {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      requestedAuthorityEngineMode: "temporal_authoritative",
      temporalCandidateProjectionEnabled: true,
      dogfoodAuthorityEnabled: true,
      dogfoodAcknowledgement: ackPayload,
    });

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sent = mockWorker.postMessage.mock.calls[0][0] as RunTemporalAuthorityApplyCommand;
    expect(sent.type).toBe("RUN_TEMPORAL_AUTHORITY_APPLY");
    expect(sent.internalOnly).toBe(true);
    // Dogfood-specific fields live at the command top level, not in inputOverrides.
    expect(sent.dogfoodAuthorityEnabled).toBe(true);
    expect(sent.dogfoodAcknowledgement).toEqual(ackPayload);
    expect((sent.inputOverrides as Record<string, unknown> | undefined)?.dogfoodAuthorityEnabled).toBeUndefined();
    expect((sent.inputOverrides as Record<string, unknown> | undefined)?.dogfoodAcknowledgement).toBeUndefined();
    // Gate input fields still pass through inputOverrides.
    expect(sent.inputOverrides?.temporalAuthorityRolloutRing).toBe("dogfood");
    expect(sent.inputOverrides?.temporalAuthorityEnabled).toBe(true);
    expect(sent.inputOverrides?.requestedAuthorityEngineMode).toBe("temporal_authoritative");
  });

  it("W5B-B2.10A: omits dogfood fields from the worker command when not supplied", async () => {
    void runTemporalAuthorityApply(mockWorker, {
      temporalAuthorityEnabled: true,
      temporalAuthorityRolloutRing: "dogfood",
      requestedAuthorityEngineMode: "temporal_authoritative",
    });

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sent = mockWorker.postMessage.mock.calls[0][0] as RunTemporalAuthorityApplyCommand;
    expect(sent.dogfoodAuthorityEnabled).toBeUndefined();
    expect(sent.dogfoodAcknowledgement).toBeUndefined();
  });

  it("sends RUN_TEMPORAL_AUTHORITY_ROLLBACK command and resolves by matching reqId", async () => {
    const payload: TemporalAuthorityRollbackResultPayload = {
      authorityRunId: "rollback-1",
      rolledBack: true,
      restoredEngine: "slot_authoritative",
      restoredTaskCount: 3,
      fallbackReason: null,
      authorityApplied: false,
      persistenceApplied: false,
    };

    const promise = runTemporalAuthorityRollback(mockWorker);
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);

    const sent = mockWorker.postMessage.mock.calls[0][0] as RunTemporalAuthorityRollbackCommand;
    expect(sent.type).toBe("RUN_TEMPORAL_AUTHORITY_ROLLBACK");
    expect(sent.internalOnly).toBe(true);

    const wrongResponse: TemporalAuthorityRollbackResultMessage = {
      type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT",
      v: 1,
      reqId: "wrong-id",
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: wrongResponse })));

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    const correctResponse: TemporalAuthorityRollbackResultMessage = {
      type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT",
      v: 1,
      reqId: sent.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: correctResponse })));

    await expect(promise).resolves.toEqual(payload);
  });

  it("sends RUN_TEMPORAL_CANDIDATE_PROJECTION command with reqId", async () => {
    const payload: TemporalCandidateProjectionResultPayload = {
      projection: {
        candidateRunId: "cand-1",
        engine: "temporal",
        calculatedAt: Date.now(),
        performanceMs: 12,
        realWasmGateReference: {
          gateReqId: null,
          gateVersion: 1,
          realWasmValidationPassedAtRun: true,
          wasmLoadModeAtRun: "real",
        },
        candidateTasks: [],
        candidateSummary: null,
        diagnostics: {
          candidateProjectionAvailable: true,
          candidateProjectionBlockedReason: null,
          unsupportedFeatureFlags: [],
          temporalExecutionErrors: [],
          unexplainedDivergenceTaskIds: [],
          expectedDivergenceTaskIds: [],
        },
        comparison: {
          comparedTaskCount: 0,
          identicalTaskCount: 0,
          expectedCalendarDivergenceCount: 0,
          unsupportedFeatureDivergenceCount: 0,
          expectedSummaryCriticalRollupDivergenceCount: 0,
          unexplainedDivergenceCount: 0,
          criticalFlagVarianceCount: 0,
          maxAbsStartVarianceMinutes: 0 as any,
          maxAbsFinishVarianceMinutes: 0 as any,
          maxAbsTotalFloatVarianceMinutes: 0 as any,
          taskComparisons: [],
        },
      },
      gateDecision: {
        allowed: true,
        blockedReason: null,
        rolloutRingAllowed: true,
      },
      authorityApplied: false,
    };

    const promise = runTemporalCandidateProjection(mockWorker);

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalCandidateProjectionCommand;
    expect(sentCmd.type).toBe("RUN_TEMPORAL_CANDIDATE_PROJECTION");
    expect(sentCmd.v).toBe(1);
    expect(sentCmd.reqId).toBeTruthy();
    expect(sentCmd.internalOnly).toBe(true);
    expect(sentCmd.devOverrides).toEqual({
      temporalCandidateProjectionEnabled: undefined,
      temporalAuthorityRolloutRing: undefined,
      useLastSuccessfulWasmGate: undefined,
    });

    const response: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload,
    };

    const event = new MessageEvent("message", { data: response });
    messageListeners.forEach((listener) => listener(event));

    const result = await promise;
    expect(result).toEqual(payload);
    expect(result.authorityApplied).toBe(false);
  });

  it("includes devOverrides when candidate options are provided", async () => {
    const payload: TemporalCandidateProjectionResultPayload = {
      projection: {
        candidateRunId: "cand-opt",
        engine: "temporal",
        calculatedAt: Date.now(),
        performanceMs: 5,
        realWasmGateReference: {
          gateReqId: null,
          gateVersion: 1,
          realWasmValidationPassedAtRun: true,
          wasmLoadModeAtRun: "real",
        },
        candidateTasks: [],
        candidateSummary: null,
        diagnostics: {
          candidateProjectionAvailable: true,
          candidateProjectionBlockedReason: null,
          unsupportedFeatureFlags: [],
          temporalExecutionErrors: [],
          unexplainedDivergenceTaskIds: [],
          expectedDivergenceTaskIds: [],
        },
        comparison: {
          comparedTaskCount: 0,
          identicalTaskCount: 0,
          expectedCalendarDivergenceCount: 0,
          unsupportedFeatureDivergenceCount: 0,
          expectedSummaryCriticalRollupDivergenceCount: 0,
          unexplainedDivergenceCount: 0,
          criticalFlagVarianceCount: 0,
          maxAbsStartVarianceMinutes: 0 as any,
          maxAbsFinishVarianceMinutes: 0 as any,
          maxAbsTotalFloatVarianceMinutes: 0 as any,
          taskComparisons: [],
        },
      },
      gateDecision: {
        allowed: true,
        blockedReason: null,
        rolloutRingAllowed: true,
      },
      authorityApplied: false,
    };

    const promise = runTemporalCandidateProjection(mockWorker, {
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      useLastSuccessfulWasmGate: true,
    });

    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalCandidateProjectionCommand;
    expect(sentCmd.devOverrides).toEqual({
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      useLastSuccessfulWasmGate: true,
    });

    const response: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: response })));
    await expect(promise).resolves.toEqual(payload);
  });

  it("supports runWasmGateFirst flow before candidate command", async () => {
    const wasmPayload: TemporalWasmValidationGatePayload = {
      realWasmValidationPassed: true,
      wasmLoadMode: "real",
      scenariosPlanned: 7,
      scenariosExecuted: 7,
      scenariosPassed: 7,
      scenariosFailed: 0,
      scenariosBlocked: 0,
      sourceProtectionStatus: "ok",
      authorityApplied: false,
      performanceMs: 5,
      scenarioResults: [],
      temporalExecutionErrors: [],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };

    const candidatePayload: TemporalCandidateProjectionResultPayload = {
      projection: {
        candidateRunId: "cand-run-first",
        engine: "temporal",
        calculatedAt: Date.now(),
        performanceMs: 6,
        realWasmGateReference: {
          gateReqId: "gate-1",
          gateVersion: 1,
          realWasmValidationPassedAtRun: true,
          wasmLoadModeAtRun: "real",
        },
        candidateTasks: [],
        candidateSummary: null,
        diagnostics: {
          candidateProjectionAvailable: true,
          candidateProjectionBlockedReason: null,
          unsupportedFeatureFlags: [],
          temporalExecutionErrors: [],
          unexplainedDivergenceTaskIds: [],
          expectedDivergenceTaskIds: [],
        },
        comparison: {
          comparedTaskCount: 0,
          identicalTaskCount: 0,
          expectedCalendarDivergenceCount: 0,
          unsupportedFeatureDivergenceCount: 0,
          expectedSummaryCriticalRollupDivergenceCount: 0,
          unexplainedDivergenceCount: 0,
          criticalFlagVarianceCount: 0,
          maxAbsStartVarianceMinutes: 0 as any,
          maxAbsFinishVarianceMinutes: 0 as any,
          maxAbsTotalFloatVarianceMinutes: 0 as any,
          taskComparisons: [],
        },
      },
      gateDecision: {
        allowed: true,
        blockedReason: null,
        rolloutRingAllowed: true,
      },
      authorityApplied: false,
    };

    const promise = runTemporalCandidateProjection(mockWorker, {
      runWasmGateFirst: true,
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      useLastSuccessfulWasmGate: true,
    });

    // First message is validation gate command.
    const firstCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalWasmValidationGateCommand;
    expect(firstCmd.type).toBe("RUN_TEMPORAL_WASM_VALIDATION_GATE");

    const gateResponse: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: firstCmd.reqId,
      payload: wasmPayload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: gateResponse })));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // After gate resolves, candidate command is sent.
    const secondCmd = mockWorker.postMessage.mock.calls[1][0] as RunTemporalCandidateProjectionCommand;
    expect(secondCmd.type).toBe("RUN_TEMPORAL_CANDIDATE_PROJECTION");
    expect(secondCmd.devOverrides).toEqual({
      temporalCandidateProjectionEnabled: true,
      temporalAuthorityRolloutRing: "internal_test",
      useLastSuccessfulWasmGate: true,
    });

    const candidateResponse: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: secondCmd.reqId,
      payload: candidatePayload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: candidateResponse })));

    await expect(promise).resolves.toEqual(candidatePayload);
  });

  it("resolves candidate projection only for matching reqId", async () => {
    const payload: TemporalCandidateProjectionResultPayload = {
      projection: {
        candidateRunId: "cand-2",
        engine: "temporal",
        calculatedAt: Date.now(),
        performanceMs: 10,
        realWasmGateReference: {
          gateReqId: null,
          gateVersion: 1,
          realWasmValidationPassedAtRun: true,
          wasmLoadModeAtRun: "real",
        },
        candidateTasks: [],
        candidateSummary: null,
        diagnostics: {
          candidateProjectionAvailable: true,
          candidateProjectionBlockedReason: null,
          unsupportedFeatureFlags: [],
          temporalExecutionErrors: [],
          unexplainedDivergenceTaskIds: [],
          expectedDivergenceTaskIds: [],
        },
        comparison: {
          comparedTaskCount: 0,
          identicalTaskCount: 0,
          expectedCalendarDivergenceCount: 0,
          unsupportedFeatureDivergenceCount: 0,
          expectedSummaryCriticalRollupDivergenceCount: 0,
          unexplainedDivergenceCount: 0,
          criticalFlagVarianceCount: 0,
          maxAbsStartVarianceMinutes: 0 as any,
          maxAbsFinishVarianceMinutes: 0 as any,
          maxAbsTotalFloatVarianceMinutes: 0 as any,
          taskComparisons: [],
        },
      },
      gateDecision: {
        allowed: true,
        blockedReason: null,
        rolloutRingAllowed: true,
      },
      authorityApplied: false,
    };

    const promise = runTemporalCandidateProjection(mockWorker);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalCandidateProjectionCommand;

    const wrongResponse: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: "wrong-id",
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: wrongResponse })));

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    const correctResponse: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: correctResponse })));

    const result = await promise;
    expect(result).toEqual(payload);
  });

  it("candidate projection hook times out safely", async () => {
    vi.useFakeTimers();
    const promise = runTemporalCandidateProjection(mockWorker);
    vi.advanceTimersByTime(5001);
    await expect(promise).rejects.toThrow("Worker response timeout");
    vi.useRealTimers();
  });

  it("candidate projection hook is diagnostic-only and preserves authorityApplied=false", async () => {
    const payload: TemporalCandidateProjectionResultPayload = {
      projection: {
        candidateRunId: "cand-3",
        engine: "temporal",
        calculatedAt: Date.now(),
        performanceMs: 7,
        realWasmGateReference: {
          gateReqId: null,
          gateVersion: 1,
          realWasmValidationPassedAtRun: true,
          wasmLoadModeAtRun: "real",
        },
        candidateTasks: [],
        candidateSummary: null,
        diagnostics: {
          candidateProjectionAvailable: true,
          candidateProjectionBlockedReason: null,
          unsupportedFeatureFlags: [],
          temporalExecutionErrors: [],
          unexplainedDivergenceTaskIds: [],
          expectedDivergenceTaskIds: [],
        },
        comparison: {
          comparedTaskCount: 0,
          identicalTaskCount: 0,
          expectedCalendarDivergenceCount: 0,
          unsupportedFeatureDivergenceCount: 0,
          expectedSummaryCriticalRollupDivergenceCount: 0,
          unexplainedDivergenceCount: 0,
          criticalFlagVarianceCount: 0,
          maxAbsStartVarianceMinutes: 0 as any,
          maxAbsFinishVarianceMinutes: 0 as any,
          maxAbsTotalFloatVarianceMinutes: 0 as any,
          taskComparisons: [],
        },
      },
      gateDecision: {
        allowed: true,
        blockedReason: null,
        rolloutRingAllowed: true,
      },
      authorityApplied: false,
    };

    const promise = runTemporalCandidateProjection(mockWorker);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalCandidateProjectionCommand;

    const response: TemporalCandidateProjectionResultMessage = {
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload,
    };
    messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: response })));

    const result = await promise;
    expect(result.authorityApplied).toBe(false);
  });

  it("sends RUN_TEMPORAL_WASM_VALIDATION_GATE command with unique reqId", async () => {
    const responsePayload: TemporalWasmValidationGatePayload = {
      realWasmValidationPassed: false,
      wasmLoadMode: "unavailable",
      scenariosPlanned: 7,
      scenariosExecuted: 0,
      scenariosPassed: 0,
      scenariosFailed: 0,
      scenariosBlocked: 7,
      sourceProtectionStatus: "not_evaluated_wasm_unavailable",
      authorityApplied: false,
      performanceMs: null,
      scenarioResults: [],
      temporalExecutionErrors: [],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };

    const promise = runTemporalWasmValidationGate(mockWorker);

    // Verify postMessage was called with correct command
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalWasmValidationGateCommand;
    expect(sentCmd.type).toBe("RUN_TEMPORAL_WASM_VALIDATION_GATE");
    expect(sentCmd.v).toBe(1);
    expect(sentCmd.reqId).toBeTruthy();
    expect(sentCmd.internalOnly).toBe(true);

    // Simulate Worker response with matching reqId
    const reqId = sentCmd.reqId;
    const response: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId,
      payload: responsePayload,
    };

    // Dispatch response to listeners
    const event = new MessageEvent("message", { data: response });
    messageListeners.forEach((listener) => listener(event));

    // Verify promise resolves with payload
    const result = await promise;
    expect(result).toEqual(responsePayload);
  });

  it("resolves only matching TEMPORAL_WASM_VALIDATION_GATE_RESULT with correct reqId", async () => {
    const payload1: TemporalWasmValidationGatePayload = {
      realWasmValidationPassed: false,
      wasmLoadMode: "unavailable",
      scenariosPlanned: 7,
      scenariosExecuted: 0,
      scenariosPassed: 0,
      scenariosFailed: 0,
      scenariosBlocked: 7,
      sourceProtectionStatus: "not_evaluated_wasm_unavailable",
      authorityApplied: false,
      performanceMs: null,
      scenarioResults: [],
      temporalExecutionErrors: [],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };

    const promise = runTemporalWasmValidationGate(mockWorker);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalWasmValidationGateCommand;

    // Send response with non-matching reqId first
    const wrongResponse: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: "different-req-id",
      payload: payload1,
    };
    const wrongEvent = new MessageEvent("message", { data: wrongResponse });
    messageListeners.forEach((listener) => listener(wrongEvent));

    // Promise should still be pending
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Send response with matching reqId
    const correctResponse: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload: payload1,
    };
    const correctEvent = new MessageEvent("message", { data: correctResponse });
    messageListeners.forEach((listener) => listener(correctEvent));

    const result = await promise;
    expect(result).toEqual(payload1);
  });

  it("rejects with timeout error if Worker does not respond", async () => {
    vi.useFakeTimers();

    const promise = runTemporalWasmValidationGate(mockWorker);

    // Fast-forward past timeout
    vi.advanceTimersByTime(5001);

    await expect(promise).rejects.toThrow("Worker response timeout");

    vi.useRealTimers();
  });

  it("rejects with error if Worker is null", async () => {
    await expect(runTemporalWasmValidationGate(null)).rejects.toThrow("Worker not available");
  });

  it("does not apply result or mutate app state", async () => {
    // This is a structural test — the function only returns the payload
    // It does not dispatch schedule mutations or state changes

    const responsePayload: TemporalWasmValidationGatePayload = {
      realWasmValidationPassed: false,
      wasmLoadMode: "unavailable",
      scenariosPlanned: 7,
      scenariosExecuted: 0,
      scenariosPassed: 0,
      scenariosFailed: 0,
      scenariosBlocked: 7,
      sourceProtectionStatus: "not_evaluated_wasm_unavailable",
      authorityApplied: false,
      performanceMs: null,
      scenarioResults: [],
      temporalExecutionErrors: [],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };

    const promise = runTemporalWasmValidationGate(mockWorker);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalWasmValidationGateCommand;

    const response: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload: responsePayload,
    };

    const event = new MessageEvent("message", { data: response });
    messageListeners.forEach((listener) => listener(event));

    const result = await promise;

    // Verify result is returned as-is (diagnostic payload only, no application)
    expect(result).toEqual(responsePayload);
    expect(result.authorityApplied).toBe(false);
  });

  it("handles blocked/unavailable WASM semantics correctly", async () => {
    // Verify that unavailable WASM returns blocked semantics, not failed
    const blockedPayload: TemporalWasmValidationGatePayload = {
      realWasmValidationPassed: false,
      wasmLoadMode: "unavailable",
      scenariosPlanned: 7,
      scenariosExecuted: 0,
      scenariosPassed: 0,
      scenariosFailed: 0,
      scenariosBlocked: 7, // Key: blocked, not failed
      sourceProtectionStatus: "not_evaluated_wasm_unavailable", // Key: not evaluated, not violated
      authorityApplied: false,
      performanceMs: null,
      scenarioResults: [],
      temporalExecutionErrors: [],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };

    const promise = runTemporalWasmValidationGate(mockWorker);
    const sentCmd = mockWorker.postMessage.mock.calls[0][0] as RunTemporalWasmValidationGateCommand;

    const response: TemporalWasmValidationGateMessage = {
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: sentCmd.reqId,
      payload: blockedPayload,
    };

    const event = new MessageEvent("message", { data: response });
    messageListeners.forEach((listener) => listener(event));

    const result = await promise;

    // Verify blocked semantics
    expect(result.scenariosBlocked).toBe(7);
    expect(result.scenariosFailed).toBe(0);
    expect(result.sourceProtectionStatus).toBe("not_evaluated_wasm_unavailable");
    expect(result.realWasmValidationPassed).toBe(false);
  });

  it("hook helper does not reference direct wasm engine APIs", () => {
    // This test verifies structurally that the hook does not import or use the WASM module directly
    // It only sends commands and receives responses via Worker messaging

    // The function signature accepts only Worker and returns only the payload
    // No WASM module is passed or available
    const fnString = runTemporalWasmValidationGate.toString();

    // Verify no direct WASM references
    expect(fnString).not.toContain("@planner/engine");
    expect(fnString).not.toContain("getCpmWasm");
    expect(fnString).not.toContain("calculate_schedule_minute");
  });

  it("candidate projection hook helper does not reference direct engine APIs", () => {
    const fnString = runTemporalCandidateProjection.toString();
    expect(fnString).not.toContain("@planner/engine");
    expect(fnString).not.toContain("getCpmWasm");
    expect(fnString).not.toContain("calculate_schedule_minute");
  });
});
