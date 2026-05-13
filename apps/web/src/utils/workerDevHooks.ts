/**
 * Dev/test-only Worker diagnostic hooks
 *
 * This module exposes diagnostic commands to the browser for development and testing.
 * Functions here are ONLY intended for dev/test mode and have no production purpose.
 *
 * Safety guarantees:
 * - No state mutation or application of results
 * - No authority flip or temporal scheduling
 * - Diagnostic-only execution with blocked WASM semantics in Node
 * - Never changes visible UI or production behavior
 */

import type {
    RunTemporalAuthorityApplyCommand,
    RunTemporalAuthorityDiagnosticsCommand,
    RunTemporalAuthorityRollbackCommand,
    RunTemporalCandidateProjectionCommand,
    RunTemporalWasmValidationGateCommand,
    TemporalAuthorityApplyResultPayload,
    TemporalAuthorityCutoverGateInput,
    TemporalAuthorityDiagnosticsPayload,
    TemporalAuthorityRollbackResultPayload,
    TemporalAuthorityRolloutRing,
    TemporalCandidateProjectionResultPayload,
    TemporalDogfoodOperatorAcknowledgement,
    TemporalWasmValidationGatePayload,
    WorkerMessage,
} from "@planner/protocol";

declare global {
  interface Window {
    __runTemporalWasmValidationGate?: () => Promise<TemporalWasmValidationGatePayload>;
    __runTemporalCandidateProjection?: (
      options?: RunTemporalCandidateProjectionHookOptions,
    ) => Promise<TemporalCandidateProjectionResultPayload>;
    __runTemporalAuthorityApply?: (
      options?: RunTemporalAuthorityApplyHookOptions,
    ) => Promise<TemporalAuthorityApplyResultPayload>;
    __runTemporalAuthorityRollback?: (
      options?: RunTemporalAuthorityRollbackHookOptions,
    ) => Promise<TemporalAuthorityRollbackResultPayload>;
    __getTemporalAuthorityDiagnostics?: () => Promise<TemporalAuthorityDiagnosticsPayload>;
  }
}

type DevHookHost = {
  __runTemporalWasmValidationGate?: () => Promise<TemporalWasmValidationGatePayload>;
  __runTemporalCandidateProjection?: (
    options?: RunTemporalCandidateProjectionHookOptions,
  ) => Promise<TemporalCandidateProjectionResultPayload>;
  __runTemporalAuthorityApply?: (
    options?: RunTemporalAuthorityApplyHookOptions,
  ) => Promise<TemporalAuthorityApplyResultPayload>;
  __runTemporalAuthorityRollback?: (
    options?: RunTemporalAuthorityRollbackHookOptions,
  ) => Promise<TemporalAuthorityRollbackResultPayload>;
  __getTemporalAuthorityDiagnostics?: () => Promise<TemporalAuthorityDiagnosticsPayload>;
};

export type RunTemporalCandidateProjectionHookOptions = {
  temporalCandidateProjectionEnabled?: boolean;
  temporalAuthorityRolloutRing?: TemporalAuthorityRolloutRing;
  useLastSuccessfulWasmGate?: boolean;
  runWasmGateFirst?: boolean;
};

export type RunTemporalAuthorityApplyHookOptions = Partial<TemporalAuthorityCutoverGateInput> & {
  runWasmGateFirst?: boolean;
  runCandidateProjectionFirst?: boolean;
  useLastSuccessfulWasmGate?: boolean;
  /**
   * W5B-B2.10A: Optional cmd-level dogfood master-switch override.
   * Forwarded as `dogfoodAuthorityEnabled` on the worker command. Honoured by
   * the worker only when internal diagnostic overrides are allowed. Defaults
   * `undefined` → dogfood remains OFF.
   */
  dogfoodAuthorityEnabled?: boolean;
  /**
   * W5B-B2.10A: Explicit operator acknowledgement payload for the dogfood
   * ring. Forwarded as `dogfoodAcknowledgement` on the worker command.
   */
  dogfoodAcknowledgement?: TemporalDogfoodOperatorAcknowledgement;
};

export type RunTemporalAuthorityRollbackHookOptions = {
  internalOnly?: boolean;
};

const getHost = (): DevHookHost => globalThis as DevHookHost;

/**
 * Timeout for Worker responses (ms)
 * Prevents indefinite waiting if Worker fails to respond
 */
const WORKER_RESPONSE_TIMEOUT_MS = 5000;

/**
 * Request/response correlation entry for dev hooks
 */
interface PendingWorkerRequest {
  reqId: string;
  resolve: (result: TemporalWasmValidationGatePayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingCandidateProjectionRequest {
  reqId: string;
  resolve: (result: TemporalCandidateProjectionResultPayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingAuthorityApplyRequest {
  reqId: string;
  resolve: (result: TemporalAuthorityApplyResultPayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingAuthorityRollbackRequest {
  reqId: string;
  resolve: (result: TemporalAuthorityRollbackResultPayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingAuthorityDiagnosticsRequest {
  reqId: string;
  resolve: (result: TemporalAuthorityDiagnosticsPayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Map of pending requests keyed by reqId
 * Allows correlation of responses to requests even with multiple concurrent calls
 */
const pendingRequests = new Map<string, PendingWorkerRequest>();
const pendingCandidateProjectionRequests = new Map<string, PendingCandidateProjectionRequest>();
const pendingAuthorityApplyRequests = new Map<string, PendingAuthorityApplyRequest>();
const pendingAuthorityRollbackRequests = new Map<string, PendingAuthorityRollbackRequest>();
const pendingAuthorityDiagnosticsRequests = new Map<string, PendingAuthorityDiagnosticsRequest>();
const hookedWorkers = new WeakSet<Worker>();

/**
 * Message listener function for dev hooks
 * Uses addEventListener to avoid interfering with onmessage
 */
function devHookMessageListener(event: MessageEvent<WorkerMessage>) {
  const msg = event.data;

  // Route TEMPORAL_WASM_VALIDATION_GATE_RESULT to pending request
  if (msg.type === "TEMPORAL_WASM_VALIDATION_GATE_RESULT") {
    const pending = pendingRequests.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(msg.reqId);
      pending.resolve(msg.payload);
    }
  }

  if (msg.type === "TEMPORAL_CANDIDATE_PROJECTION_RESULT") {
    const pending = pendingCandidateProjectionRequests.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingCandidateProjectionRequests.delete(msg.reqId);
      pending.resolve(msg.payload);
    }
  }

  if (msg.type === "TEMPORAL_AUTHORITY_APPLY_RESULT") {
    const pending = pendingAuthorityApplyRequests.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingAuthorityApplyRequests.delete(msg.reqId);
      pending.resolve(msg.payload);
    }
  }

  if (msg.type === "TEMPORAL_AUTHORITY_ROLLBACK_RESULT") {
    const pending = pendingAuthorityRollbackRequests.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingAuthorityRollbackRequests.delete(msg.reqId);
      pending.resolve(msg.payload);
    }
  }

  if (msg.type === "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT") {
    const pending = pendingAuthorityDiagnosticsRequests.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingAuthorityDiagnosticsRequests.delete(msg.reqId);
      pending.resolve(msg.payload);
    }
  }
}

/**
 * Attach the message listener to Worker via addEventListener
 * This approach preserves the existing onmessage handler
 */
function attachMessageListener(worker: Worker) {
  if (hookedWorkers.has(worker)) return;
  if (typeof worker.addEventListener !== "function") return;
  worker.addEventListener("message", devHookMessageListener);
  hookedWorkers.add(worker);
}

function detachMessageListener(worker: Worker) {
  if (!hookedWorkers.has(worker)) return;
  if (typeof worker.removeEventListener === "function") {
    worker.removeEventListener("message", devHookMessageListener);
  }
  hookedWorkers.delete(worker);
}

export const isDevOrTestMode = (
  env: { DEV?: boolean; MODE?: string } = import.meta.env,
): boolean => env.DEV === true || env.MODE === "test";

/**
 * Generate a unique request ID (same pattern as App.tsx makeId)
 */
function makeDevHookId(): string {
  return crypto.randomUUID();
}

/**
 * Browser hook: Run temporal WASM validation gate diagnostic
 *
 * Sends RUN_TEMPORAL_WASM_VALIDATION_GATE command to Worker and waits for result.
 * Returns payload with diagnostics (validation status, scenarios, etc.).
 *
 * Usage (dev/test console):
 *   const result = await window.__runTemporalWasmValidationGate();
 *   console.log(result);
 *
 * Safety:
 * - Does NOT apply results or change schedule
 * - Does NOT flip authority or apply temporal scheduling
 * - Does NOT mutate imported source dates
 * - Returns blocked result if Worker unavailable
 *
 * @param worker - The App Worker instance
 * @returns Promise resolving to validation gate payload with diagnostics
 * @throws Error if Worker not ready or request times out
 */
export async function runTemporalWasmValidationGate(
  worker: Worker | null
): Promise<TemporalWasmValidationGatePayload> {
  if (!worker) {
    throw new Error("Worker not available");
  }

  // Ensure message listener is attached
  attachMessageListener(worker);

  const reqId = makeDevHookId();

  return new Promise((resolve, reject) => {
    // Set up timeout to prevent indefinite waiting
    const timeout = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error(`Worker response timeout after ${WORKER_RESPONSE_TIMEOUT_MS}ms`));
    }, WORKER_RESPONSE_TIMEOUT_MS);

    // Register pending request
    pendingRequests.set(reqId, { reqId, resolve, reject, timeout });

    // Send command to Worker
    try {
      const cmd: RunTemporalWasmValidationGateCommand = {
        type: "RUN_TEMPORAL_WASM_VALIDATION_GATE",
        v: 1,
        reqId,
        internalOnly: true,
      };
      worker.postMessage(cmd);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(reqId);
      reject(new Error(`Failed to post message to Worker: ${error}`));
    }
  });
}

/**
 * Browser hook: Run temporal candidate projection diagnostic
 *
 * Sends RUN_TEMPORAL_CANDIDATE_PROJECTION command to Worker and waits for
 * TEMPORAL_CANDIDATE_PROJECTION_RESULT with matching reqId.
 *
 * Safety:
 * - Does NOT apply temporal results to canonical state
 * - Does NOT trigger recalculation
 * - Does NOT mutate visible app state
 * - Returns diagnostic payload only
 */
export async function runTemporalCandidateProjection(
  worker: Worker | null,
  options?: RunTemporalCandidateProjectionHookOptions,
): Promise<TemporalCandidateProjectionResultPayload> {
  if (!worker) {
    throw new Error("Worker not available");
  }

  attachMessageListener(worker);

  if (options?.runWasmGateFirst) {
    await runTemporalWasmValidationGate(worker);
  }

  const reqId = makeDevHookId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCandidateProjectionRequests.delete(reqId);
      reject(new Error(`Worker response timeout after ${WORKER_RESPONSE_TIMEOUT_MS}ms`));
    }, WORKER_RESPONSE_TIMEOUT_MS);

    pendingCandidateProjectionRequests.set(reqId, { reqId, resolve, reject, timeout });

    try {
      const cmd: RunTemporalCandidateProjectionCommand = {
        type: "RUN_TEMPORAL_CANDIDATE_PROJECTION",
        v: 1,
        reqId,
        internalOnly: true,
        devOverrides: {
          temporalCandidateProjectionEnabled: options?.temporalCandidateProjectionEnabled,
          temporalAuthorityRolloutRing: options?.temporalAuthorityRolloutRing,
          useLastSuccessfulWasmGate: options?.useLastSuccessfulWasmGate,
        },
      };
      worker.postMessage(cmd);
    } catch (error) {
      clearTimeout(timeout);
      pendingCandidateProjectionRequests.delete(reqId);
      reject(new Error(`Failed to post message to Worker: ${error}`));
    }
  });
}

function buildAuthorityApplyInputOverrides(
  options?: RunTemporalAuthorityApplyHookOptions,
): Partial<TemporalAuthorityCutoverGateInput> | undefined {
  if (!options) return undefined;

  const {
    runWasmGateFirst,
    runCandidateProjectionFirst,
    useLastSuccessfulWasmGate,
    dogfoodAuthorityEnabled,
    dogfoodAcknowledgement,
    ...inputOverrides
  } = options;

  void runWasmGateFirst;
  void runCandidateProjectionFirst;
  void useLastSuccessfulWasmGate;
  void dogfoodAuthorityEnabled;
  void dogfoodAcknowledgement;

  return inputOverrides;
}

export async function runTemporalAuthorityApply(
  worker: Worker | null,
  options?: RunTemporalAuthorityApplyHookOptions,
): Promise<TemporalAuthorityApplyResultPayload> {
  if (!worker) {
    throw new Error("Worker not available");
  }

  attachMessageListener(worker);

  if (options?.runWasmGateFirst) {
    await runTemporalWasmValidationGate(worker);
  }

  if (options?.runCandidateProjectionFirst || options?.useLastSuccessfulWasmGate) {
    await runTemporalCandidateProjection(worker, {
      runWasmGateFirst: false,
      temporalCandidateProjectionEnabled: options.temporalCandidateProjectionEnabled,
      temporalAuthorityRolloutRing: options.temporalAuthorityRolloutRing,
      useLastSuccessfulWasmGate: options.useLastSuccessfulWasmGate,
    });
  }

  const reqId = makeDevHookId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAuthorityApplyRequests.delete(reqId);
      reject(new Error(`Worker response timeout after ${WORKER_RESPONSE_TIMEOUT_MS}ms`));
    }, WORKER_RESPONSE_TIMEOUT_MS);

    pendingAuthorityApplyRequests.set(reqId, { reqId, resolve, reject, timeout });

    try {
      const cmd: RunTemporalAuthorityApplyCommand = {
        type: "RUN_TEMPORAL_AUTHORITY_APPLY",
        v: 1,
        reqId,
        internalOnly: true,
        inputOverrides: buildAuthorityApplyInputOverrides(options),
        ...(options?.dogfoodAuthorityEnabled !== undefined
          ? { dogfoodAuthorityEnabled: options.dogfoodAuthorityEnabled }
          : {}),
        ...(options?.dogfoodAcknowledgement !== undefined
          ? { dogfoodAcknowledgement: options.dogfoodAcknowledgement }
          : {}),
      };
      worker.postMessage(cmd);
    } catch (error) {
      clearTimeout(timeout);
      pendingAuthorityApplyRequests.delete(reqId);
      reject(new Error(`Failed to post message to Worker: ${error}`));
    }
  });
}

export async function runTemporalAuthorityRollback(
  worker: Worker | null,
  options?: RunTemporalAuthorityRollbackHookOptions,
): Promise<TemporalAuthorityRollbackResultPayload> {
  if (!worker) {
    throw new Error("Worker not available");
  }

  attachMessageListener(worker);
  const reqId = makeDevHookId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAuthorityRollbackRequests.delete(reqId);
      reject(new Error(`Worker response timeout after ${WORKER_RESPONSE_TIMEOUT_MS}ms`));
    }, WORKER_RESPONSE_TIMEOUT_MS);

    pendingAuthorityRollbackRequests.set(reqId, { reqId, resolve, reject, timeout });

    try {
      const cmd: RunTemporalAuthorityRollbackCommand = {
        type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK",
        v: 1,
        reqId,
        internalOnly: options?.internalOnly ?? true,
      };
      worker.postMessage(cmd);
    } catch (error) {
      clearTimeout(timeout);
      pendingAuthorityRollbackRequests.delete(reqId);
      reject(new Error(`Failed to post message to Worker: ${error}`));
    }
  });
}

export async function runTemporalAuthorityDiagnostics(
  worker: Worker | null,
): Promise<TemporalAuthorityDiagnosticsPayload> {
  if (!worker) {
    throw new Error("Worker not available");
  }

  attachMessageListener(worker);
  const reqId = makeDevHookId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAuthorityDiagnosticsRequests.delete(reqId);
      reject(new Error(`Worker response timeout after ${WORKER_RESPONSE_TIMEOUT_MS}ms`));
    }, WORKER_RESPONSE_TIMEOUT_MS);

    pendingAuthorityDiagnosticsRequests.set(reqId, { reqId, resolve, reject, timeout });

    try {
      const cmd: RunTemporalAuthorityDiagnosticsCommand = {
        type: "RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS",
        v: 1,
        reqId,
        internalOnly: true,
      };
      worker.postMessage(cmd);
    } catch (error) {
      clearTimeout(timeout);
      pendingAuthorityDiagnosticsRequests.delete(reqId);
      reject(new Error(`Failed to post message to Worker: ${error}`));
    }
  });
}

/**
 * Install dev hooks on window (dev/test mode only)
 *
 * Exposes diagnostic functions for browser console/test access.
 * Only installs when import.meta.env.DEV is true.
 *
 * @param worker - The App Worker instance to use for commands
 */
export function installWorkerDevHooks(
  worker: Worker | null,
  env: { DEV?: boolean; MODE?: string } = import.meta.env,
): void {
  // Only install in dev/test mode
  if (!isDevOrTestMode(env)) {
    return;
  }

  if (!worker) {
    console.warn("[DevHooks] Worker not ready; dev hooks not installed");
    return;
  }

  // Attach listener on Worker
  attachMessageListener(worker);

  // Install hook on window (type-safe with globalThis)
  const host = getHost();
  host.__runTemporalWasmValidationGate = async function () {
    try {
      return await runTemporalWasmValidationGate(worker);
    } catch (error) {
      console.error("[DevHooks] runTemporalWasmValidationGate error:", error);
      throw error;
    }
  };

  host.__runTemporalCandidateProjection = async function (options) {
    try {
      return await runTemporalCandidateProjection(worker, options);
    } catch (error) {
      console.error("[DevHooks] runTemporalCandidateProjection error:", error);
      throw error;
    }
  };

  host.__runTemporalAuthorityApply = async function (options) {
    try {
      return await runTemporalAuthorityApply(worker, options);
    } catch (error) {
      console.error("[DevHooks] runTemporalAuthorityApply error:", error);
      throw error;
    }
  };

  host.__runTemporalAuthorityRollback = async function (options) {
    try {
      return await runTemporalAuthorityRollback(worker, options);
    } catch (error) {
      console.error("[DevHooks] runTemporalAuthorityRollback error:", error);
      throw error;
    }
  };

  host.__getTemporalAuthorityDiagnostics = async function () {
    try {
      return await runTemporalAuthorityDiagnostics(worker);
    } catch (error) {
      console.error("[DevHooks] runTemporalAuthorityDiagnostics error:", error);
      throw error;
    }
  };

  if (isDevOrTestMode(env)) {
    console.log("[DevHooks] Browser dev hooks installed. Use window.__runTemporalWasmValidationGate(), window.__runTemporalCandidateProjection(), window.__runTemporalAuthorityApply(), window.__runTemporalAuthorityRollback(), or window.__getTemporalAuthorityDiagnostics() for diagnostics.");
  }
}

export function uninstallWorkerDevHooks(worker: Worker | null): void {
  if (worker) {
    detachMessageListener(worker);
  }
  const host = getHost();
  if (host.__runTemporalWasmValidationGate) {
    delete host.__runTemporalWasmValidationGate;
  }
  if (host.__runTemporalCandidateProjection) {
    delete host.__runTemporalCandidateProjection;
  }
  if (host.__runTemporalAuthorityApply) {
    delete host.__runTemporalAuthorityApply;
  }
  if (host.__runTemporalAuthorityRollback) {
    delete host.__runTemporalAuthorityRollback;
  }
  if (host.__getTemporalAuthorityDiagnostics) {
    delete host.__getTemporalAuthorityDiagnostics;
  }
}
