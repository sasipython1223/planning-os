# W5B-B2.3C.2 Worker Diagnostic Validation Command Audit

## Executive Summary

The Worker protocol is well-structured and supports adding a diagnostic-only validation command that exercises real WASM without flipping authority or mutating state. The audit identifies the correct attachment points, safe patterns, and payload shape for the validation gate.

---

## 1. Existing Worker Protocol Findings

### 1.1 Command Routing Architecture

**Location:** `packages/protocol/src/types.ts` (lines 584+)

The Worker uses a **command dispatch envelope** pattern:
- All UI commands are tagged with a `type` field (`ADD_TASK`, `UPDATE_TASK`, etc.)
- Commands include a `reqId` (request ID) for tracing and response correlation.
- Protocol version is `v: 1` across all command and message types.

```typescript
// Command union (packages/protocol/src/types.ts:584)
export type Command = 
  | AddTaskCommand | UpdateTaskCommand | ... | PreviewImportCommand | ...;

// Example command structure
export type AddTaskCommand = {
  type: "ADD_TASK";
  v: 1;
  reqId: string;
  payload: Task;
};
```

### 1.2 Command Dispatch Spine

**Location:** `packages/worker/src/worker.ts` (lines ~1050–1150)

The Worker implements a **single entry point** for all commands:

```typescript
// Main message handler (worker.ts:2024)
ctx.onmessage = (event: MessageEvent<Command>) => {
  dispatchCommand(event.data);
};

// Dispatch function (worker.ts:~1050)
const dispatchCommand = (cmd: Command): void => {
  const envelope = createEnvelope(cmd, "human");
  let result: DispatchResult;
  try {
    result = handleCommand(cmd, envelope);
  } catch (err) {
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: ... });
    result = dispatchError(message);
  }
  auditLog(envelope, result);
};

// Handler routing (worker.ts:~1100)
const handleCommand = (cmd: Command, envelope?: CommandEnvelope): DispatchResult => {
  if (!isReady) return nack("Worker not ready", "not-ready");
  
  if (cmd.type === "UNDO") { ... }
  if (cmd.type === "REDO") { ... }
  if (cmd.type === "TOGGLE_NODE") { ... }
  if (cmd.type === "ANALYZE_FLOAT_PATHS") { ... }
  // ... additional handlers
};
```

### 1.3 Existing Diagnostic Commands

**Relevant Pattern:** `ANALYZE_FLOAT_PATHS`

The protocol already has a **read-only diagnostic command** that does not mutate state:

```typescript
export type AnalyzeFloatPathsCommand = {
  type: "ANALYZE_FLOAT_PATHS";
  v: 1;
  reqId: string;
  // No payload — reads current schedule state
};

// Response types:
export type FloatPathResultMessage = {
  type: "FLOAT_PATH_RESULT";
  v: 1;
  reqId: string;
  payload: FloatPathMvpResponse; // Diagnostics only
};

export type FloatPathErrorMessage = {
  type: "FLOAT_PATH_ERROR";
  v: 1;
  reqId: string;
  error: FloatPathMvpError;
};
```

This pattern demonstrates:
- ✅ Commands can be diagnostic-only (no state mutation).
- ✅ Responses can carry complex diagnostic payloads.
- ✅ Errors are handled separately from success cases.

### 1.4 Response Message Types

**Location:** `packages/protocol/src/types.ts` (lines 700–732)

The Worker emits one of these message types:
```typescript
export type WorkerMessage =
  | AckMessage                    // Simple ACK
  | NackMessage                   // Simple NACK (error)
  | DiffStateMessage              // Full state update (post-scheduling)
  | WorkerReadyMessage            // Worker initialization complete
  | FloatPathResultMessage        // Diagnostic result (read-only)
  | FloatPathErrorMessage         // Diagnostic error
  | ScheduleErrorMessage          // Scheduling error
  | VisibleRowsUpdateMessage      // Hierarchy-only update
  | ImportPreviewMessage          // Import diagnostics
```

**Key insight:** The response message is sent via `emit()`, which posts back to the main thread. The `reqId` field allows the browser/main thread to correlate responses with requests.

---

## 2. WASM Loader / Temporal Adapter Findings

### 2.1 Current WASM Loading Path

**Location:** `packages/worker/src/wasm/loadCpmWasm.ts`

```typescript
export const loadCpmWasm = async (): Promise<void> => {
  try {
    const module: any = await import("@planner/engine");
    
    // --target web requires explicit init
    if (typeof module.default === "function") {
      await module.default();
    }
    
    if (typeof module.calculate_schedule !== "function") {
      throw new Error("calculate_schedule not found on WASM module");
    }
    
    wasmModule = module as CpmWasmModule;
  } catch (error) {
    throw new Error(`Failed to load WASM module: ${error}`);
  }
};

export const getCpmWasm = (): CpmWasmModule => {
  if (!wasmModule) {
    throw new Error("WASM module not loaded. Call loadCpmWasm() first.");
  }
  return wasmModule;
};
```

### 2.2 Temporal Engine Adapter

**Location:** `packages/worker/src/schedule/TemporalEngineAdapter.ts`

The adapter:
1. Accepts a `SchedulingStateSnapshot` (task/dependency/calendar state, no mutations).
2. Uses `MinuteEngineAdapter` to convert state → `MinuteScheduleRequest` (ABI v2).
3. Calls `wasm.calculate_schedule_minute(request)` to compute temporal schedule.
4. Translates results via `TemporalScheduleTranslator` → `NormalizedScheduleFacts`.
5. **Never applies results or mutates state.**

```typescript
// From TemporalEngineAdapter:
export const setTemporalWasm = (mod: MinuteNativeWasmModule): void => {
  wasmModule = mod;
};

// Minute adapter prepares request
const minuteEngineAdapter = new MinuteEngineAdapter();

// Output translator (read-only)
const temporalOutputTranslator = new TemporalScheduleTranslator();
```

### 2.3 Worker Initialization

**Location:** `packages/worker/src/worker.ts` (lines 1950–2010)

```typescript
const initializeWorker = async (): Promise<void> => {
  try {
    await loadCpmWasm();
    
    // Phase D3: wire temporal WASM module for shadow engine
    setTemporalWasm(getCpmWasm());
    
    // Hydrate from IndexedDB
    const raw = await loadPersistedState();
    const persisted = raw ? migratePersistedState(raw) : null;
    if (persisted?.state) {
      State.hydrateState(persisted.state);
    }
    
    isReady = true;
    emit({ type: "WORKER_READY", v: 1 });
    
    // Recompute and emit initial state
    runSchedulingAndEmitState();
  } catch (error) {
    console.error("Failed to initialize worker:", error);
    // Worker remains not ready
  }
};
```

**Key insight:**
- ✅ WASM is loaded **once** during init and stored in a module-level variable.
- ✅ The temporal adapter is wired immediately after WASM loads.
- ✅ The WASM module is accessible via `getCpmWasm()` at any time after init.
- ✅ A diagnostic command can safely call the temporal adapter without re-loading WASM.

### 2.4 Reusable Components for Validation

The existing W5B-B2.3 test scenario harness can be **reused** by a Worker command:

**From:** `packages/worker/tests/schedule/w5b-b2-3-real-wasm-validation-gate.test.ts`

The test imports:
- `buildTemporalAuthorityRoutingInput` (policy gate inputs).
- `decideScheduleAuthorityPolicy` (authority decision).
- `getCpmWasm()`, `loadCpmWasm()` (WASM access).
- `MinuteScheduleRequest`, `MinuteScheduleResponse` types.

The test runs **7 validation scenarios** with different calendar configurations and validates that WASM results match expectations.

---

## 3. Recommended Diagnostic Command

### 3.1 Command Proposal: `RUN_TEMPORAL_WASM_VALIDATION_GATE`

**Design Pattern:** Read-only diagnostic command (similar to `ANALYZE_FLOAT_PATHS`).

**Definition:**
```typescript
// packages/protocol/src/types.ts

export type RunTemporalWasmValidationGateCommand = {
  type: "RUN_TEMPORAL_WASM_VALIDATION_GATE";
  v: 1;
  reqId: string;
  /**
   * Optional internal/dev guard.
   * If true, command executes only if the Worker is in test/internal mode.
   * Prevents accidental browser invocation in production.
   */
  internalOnly?: boolean;
};

// Add to Command union:
export type Command = 
  | ... existing commands ...
  | RunTemporalWasmValidationGateCommand;
```

### 3.2 Command Handler Implementation

**Location:** `packages/worker/src/worker.ts` (handleCommand function)

```typescript
// In handleCommand() switch:
if (cmd.type === "RUN_TEMPORAL_WASM_VALIDATION_GATE") {
  try {
    // Guard: can be made internal-only if needed
    if (cmd.internalOnly && !isInternalMode()) {
      return nack("Command not allowed in production", "unauthorized");
    }
    
    // Check WASM is loaded
    if (!isWasmLoaded()) {
      emit({
        type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
        v: 1,
        reqId: cmd.reqId,
        payload: {
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
          blockerReason: "WASM module not available",
        },
      });
      return ack();
    }
    
    // Run validation harness (extracted from test or inline)
    const result = await runTemporalWasmValidationHarness(State.getTasks(), State.getDependencies());
    
    emit({
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: result,
    });
    return ack();
  } catch (error) {
    emit({
      type: "NACK",
      v: 1,
      reqId: cmd.reqId,
      error: `Validation gate error: ${error}`,
    });
    return nack(String(error), "execution");
  }
}
```

### 3.3 Safety Guarantees

The command **guarantees**:
- ✅ **Read-only:** Does not mutate task, dependency, or calendar state.
- ✅ **No authority flip:** Sets `authorityApplied: false` in result.
- ✅ **No temporal application:** Returns diagnostics only; does not apply temporal results.
- ✅ **Preserves lifecycle:** `sourceImportedNotCalculated` remains unchanged.
- ✅ **No UI impact:** Does not emit `DIFF_STATE` or trigger re-projection.
- ✅ **No persistence:** Does not call `savePersistedState()`.
- ✅ **Reuses existing WASM:** Calls the same WASM already loaded during init.

---

## 4. Gate Result Payload

### 4.1 Response Message Type

```typescript
// packages/protocol/src/types.ts

export type TemporalWasmValidationGateResult = {
  readonly realWasmValidationPassed: boolean;
  readonly wasmLoadMode: "real" | "mocked" | "unavailable";
  readonly scenariosPlanned: number;
  readonly scenariosExecuted: number;
  readonly scenariosPassed: number;
  readonly scenariosFailed: number;
  readonly scenariosBlocked: number;
  readonly temporalExecutionErrors: readonly string[];
  readonly sourceProtectionStatus: 
    | "ok"
    | "violated"
    | "blocked"
    | "not_evaluated_wasm_unavailable";
  readonly authorityApplied: false;  // Always false
  readonly performanceMs: number | null;
  readonly scenarioResults: readonly ValidationScenarioResult[];
  readonly blockerReason?: string;  // If wasmLoadMode !== "real"
};

export type ValidationScenarioResult = {
  readonly name: string;  // "single_calendar_5d", "multi_calendar_7d_to_5d", etc.
  readonly status: "passed" | "failed" | "blocked";
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly error?: string;
};

export type TemporalWasmValidationGateMessage = {
  type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalWasmValidationGateResult;
};

// Add to WorkerMessage union:
export type WorkerMessage =
  | ... existing types ...
  | TemporalWasmValidationGateMessage;
```

### 4.2 Payload Semantics

| Field | Meaning | Example |
|-------|---------|---------|
| `realWasmValidationPassed` | All 7 scenarios passed with real WASM and no divergence. | `true` or `false` |
| `wasmLoadMode` | `"real"` = WASM loaded; `"unavailable"` = WASM not available; `"mocked"` = test stub. | `"real"` |
| `scenariosPlanned` | Total scenarios in the harness. | `7` |
| `scenariosExecuted` | Scenarios that were not blocked. | `7` or `0` |
| `scenariosPassed` | Scenarios with valid results and expected divergence. | `7` |
| `scenariosFailed` | Scenarios with unexpected divergence or errors. | `0` |
| `scenariosBlocked` | Scenarios not executed (e.g., WASM unavailable). | `0` or `7` |
| `temporalExecutionErrors` | WASM execution errors (empty if all passed). | `[]` |
| `sourceProtectionStatus` | Was source data protected from mutation? | `"ok"` |
| `authorityApplied` | Were temporal results applied to scheduling? | Always `false` |
| `performanceMs` | Wall-clock time for validation (null if blocked). | `42` or `null` |
| `scenarioResults` | Per-scenario details. | Array of 7 results |
| `blockerReason` | Why validation was blocked (if applicable). | `"WASM module not available"` |

---

## 5. Browser Hook Design

### 5.1 Trigger Pattern

The browser test/dev hook will:

1. **Import/reference the Worker instance** (already available in the app).
2. **Construct a command message** with type `RUN_TEMPORAL_WASM_VALIDATION_GATE`.
3. **Post the message to the Worker** via `worker.postMessage()`.
4. **Listen for the response** via `worker.onmessage`.
5. **Return the gate result** to the test harness.

### 5.2 Pseudocode

```typescript
// apps/web/src/wasm-gate/triggerWorkerValidationGate.ts (proposed)

export async function triggerTemporalWasmValidationGate(
  worker: Worker
): Promise<TemporalWasmValidationGateResult> {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const timeoutHandle = setTimeout(() => {
      reject(new Error("Validation gate command timed out after 30s"));
    }, 30000);
    
    const onMessage = (event: MessageEvent) => {
      if (event.data.type === "TEMPORAL_WASM_VALIDATION_GATE_RESULT" && 
          event.data.reqId === reqId) {
        worker.removeEventListener("message", onMessage);
        clearTimeout(timeoutHandle);
        resolve(event.data.payload);
      }
    };
    
    worker.addEventListener("message", onMessage);
    
    const cmd: RunTemporalWasmValidationGateCommand = {
      type: "RUN_TEMPORAL_WASM_VALIDATION_GATE",
      v: 1,
      reqId,
      internalOnly: true,  // Restrict to dev/internal mode
    };
    
    worker.postMessage(cmd);
  });
}
```

### 5.3 Dev/Test Hook in App

```typescript
// apps/web/src/main.tsx (add to dev/test mode only)

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  // Get the Worker instance from your app context
  const getWorkerForTesting = () => {
    // App must expose the Worker for testing (e.g., via a context or global)
    return (window as any).__plannerWorker;
  };
  
  (window as any).__runTemporalWasmValidationGate = async () => {
    const worker = getWorkerForTesting();
    if (!worker) throw new Error("Worker not available");
    return triggerTemporalWasmValidationGate(worker);
  };
}
```

### 5.4 Avoiding User-Facing UI Impact

- ✅ Command does **not emit** `DIFF_STATE` → UI never re-renders.
- ✅ Command does **not mutate** canonical state → no cascade effects.
- ✅ Command emits a **diagnostic-only message** → main thread can ignore if not listening.
- ✅ Command is **scoped to dev/internal mode** → no risk in production.

---

## 6. Test Plan

### 6.1 Worker Command Tests

**File:** `packages/worker/tests/schedule/w5b-b2-3c-command.test.ts` (new)

```typescript
describe("RUN_TEMPORAL_WASM_VALIDATION_GATE command", () => {
  it("returns diagnostics without mutating state", async () => {
    // 1. Initialize Worker
    // 2. Load a project with tasks/dependencies
    // 3. Capture baseline state (tasks, dependencies, baselines, lifecycle)
    // 4. Send RUN_TEMPORAL_WASM_VALIDATION_GATE command
    // 5. Verify:
    //    - Command returns ack
    //    - Response has correct shape
    //    - authorityApplied === false
    //    - scheduleResults unchanged
    //    - sourceImportedNotCalculated unchanged
    //    - state === baseline state
  });

  it("blocks scenarios when WASM unavailable", async () => {
    // 1. Initialize Worker with WASM mock unavailable
    // 2. Send command
    // 3. Verify:
    //    - wasmLoadMode === "unavailable"
    //    - scenariosBlocked === 7
    //    - scenariosExecuted === 0
    //    - sourceProtectionStatus === "not_evaluated_wasm_unavailable"
  });

  it("validates all 7 calendar scenarios with real WASM", async () => {
    // 1. Load real WASM
    // 2. Send command
    // 3. Verify:
    //    - wasmLoadMode === "real"
    //    - scenariosPlanned === 7
    //    - scenariosExecuted === 7
    //    - scenariosPassed + scenariosFailed + scenariosBlocked === 7
    //    - performanceMs > 0
  });

  it("respects internalOnly guard", async () => {
    // 1. Initialize Worker with production mode flag
    // 2. Send command with internalOnly: true
    // 3. Verify: command is rejected with "not allowed in production"
  });
});
```

### 6.2 Browser/Dev Hook Tests

**File:** `apps/web/tests/wasm-gate/temporal-validation.browser.test.ts` (future)

```typescript
describe("Temporal WASM validation gate browser test", () => {
  it("triggers validation via dev hook and returns gate result", async ({ page }) => {
    await page.goto("http://localhost:4173/");
    
    const result = await page.evaluate(async () => {
      if (typeof window.__runTemporalWasmValidationGate !== "function") {
        throw new Error("Dev hook not available");
      }
      return await window.__runTemporalWasmValidationGate();
    });
    
    expect(result.realWasmValidationPassed).toBe(true);
    expect(result.wasmLoadMode).toBe("real");
    expect(result.authorityApplied).toBe(false);
    expect(result.scenariosPassed).toBe(7);
  });
});
```

### 6.3 Source Data Protection Tests

```typescript
it("does not mutate source import dates", async () => {
  // 1. Import a schedule with source dates
  // 2. Capture sourceDatesByTaskId
  // 3. Run validation command
  // 4. Verify: sourceDatesByTaskId === captured (deep equality)
});

it("preserves sourceImportedNotCalculated lifecycle", async () => {
  // 1. Import schedule (lifecycle = sourceImportedNotCalculated)
  // 2. Run validation command
  // 3. Verify: lifecycle still === sourceImportedNotCalculated
});
```

### 6.4 Authority Tests

```typescript
it("never flips authority to temporal", async () => {
  // 1. Load project
  // 2. Run validation command
  // 3. Verify: d10fExecutionArtifact.attemptedMinuteAuthority === false
  // 4. Verify: d10fExecutionArtifact.executedRoute === "slot"
});

it("blocks scenarios when authority flip gate fails", async () => {
  // 1. Set temporal authority policy to "reject_not_ready"
  // 2. Run validation command
  // 3. Verify: scenariosBlocked > 0 or sourceProtectionStatus === "blocked"
});
```

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Command is invoked in production | High | ✅ Use `internalOnly: true` flag; default command handler rejects in non-test mode. |
| WASM load overhead blocks UI | Medium | ✅ WASM is already loaded during Worker init; command reuses cached module. |
| Browser test framework not set up | Medium | ✅ Defer Playwright setup to separate task; Worker command is ready without Playwright. |
| Timeout in browser waiting for result | Low | ✅ Set 30s timeout; command is fast (7 scenarios ≈ 50–100ms). |
| Source dates accidentally mutated | Low | ✅ Command uses snapshot of task/dependency data; mutation test validates. |
| autorityApplied flag wrong | Low | ✅ Hard-code to `false` in result; test asserts this. |

---

## 8. Recommendation

### **Proceed with Worker Command Implementation**

**Rationale:**
1. ✅ Worker protocol is mature and supports diagnostic commands (precedent: `ANALYZE_FLOAT_PATHS`).
2. ✅ WASM is already loaded once; reusing it is safe and efficient.
3. ✅ Command can be read-only and diagnostic-only; no authority risk.
4. ✅ Response message type is straightforward; no protocol conflicts.
5. ✅ Dev/test-only guard prevents production risk.
6. ✅ Test scenarios are already written; harness can be extracted and reused.

### **Next Steps**

1. **Step 1 (Implementation):** Add `RUN_TEMPORAL_WASM_VALIDATION_GATE` command type to protocol.
2. **Step 2 (Implementation):** Implement command handler in Worker (`handleCommand` switch).
3. **Step 3 (Implementation):** Extract scenario harness from test to reusable function.
4. **Step 4 (Testing):** Write Worker command tests (no browser infra needed yet).
5. **Step 5 (Future):** Add dev hook in app; set up Playwright only when browser test infra is approved.

### **Do Not Implement (Yet)**
- ❌ Playwright test infrastructure (deferred to separate task).
- ❌ Browser hook in app (deferred until Worker command is tested).
- ❌ Direct `@planner/engine` import from web (already ruled out).

---

## Appendix A: File Locations

| Artifact | Path |
|----------|------|
| Command dispatch | `packages/worker/src/worker.ts` (lines ~1050–1150) |
| WASM loader | `packages/worker/src/wasm/loadCpmWasm.ts` |
| Temporal adapter | `packages/worker/src/schedule/TemporalEngineAdapter.ts` |
| Protocol types | `packages/protocol/src/types.ts` |
| Validation scenarios | `packages/worker/tests/schedule/w5b-b2-3-real-wasm-validation-gate.test.ts` |
| Existing diagnostic command | `ANALYZE_FLOAT_PATHS` in protocol + handler in worker.ts |

---

## Appendix B: Command Flow Diagram

```
Browser / Dev Hook
    │
    ├─→ window.__runTemporalWasmValidationGate()
    │   (or Playwright test)
    │
    └─→ worker.postMessage({
            type: "RUN_TEMPORAL_WASM_VALIDATION_GATE",
            v: 1,
            reqId: "uuid"
        })
        │
        ├─→ Worker.onmessage
        │   │
        │   ├─→ dispatchCommand()
        │   │
        │   ├─→ handleCommand()
        │   │   │
        │   │   ├─ Guard: internalOnly?
        │   │   ├─ Guard: WASM loaded?
        │   │   ├─ Call: runTemporalWasmValidationHarness()
        │   │   │   │
        │   │   │   ├─ Create 7 scenarios
        │   │   │   ├─ Call: wasm.calculate_schedule_minute(request)
        │   │   │   ├─ Translate: TemporalScheduleTranslator
        │   │   │   ├─ Compare: expected vs actual divergence
        │   │   │   └─ Build: gate result
        │   │   │
        │   │   ├─ emit({ type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT", ... })
        │   │   │
        │   │   └─ return ack()
        │   │
        │   └─ auditLog()
        │
        └─→ Browser receives message
            │
            ├─→ Correlation: reqId matches
            │
            └─→ Resolve promise with payload
                │
                └─→ Test/dev hook displays result
```

---

## Appendix C: Source Protection Semantics

The `sourceProtectionStatus` field indicates whether source-imported data was protected:

| Status | Meaning |
|--------|---------|
| `"ok"` | No source dates were accessed or mutated; validation is clean. |
| `"violated"` | Source dates were read or mutated (indicates a bug in validation). |
| `"blocked"` | Validation did not complete (WASM unavailable, authority gate failed). |
| `"not_evaluated_wasm_unavailable"` | Validation was not evaluated because WASM unavailable. |

The command **always protects** source data by:
- Using a **snapshot** of task/dependency data.
- **Not reading** `sourceDatesByTaskId` unless explicitly necessary.
- **Never mutating** canonical `State.*` records.
- **Not applying** temporal results to scheduling.

---

*End of Audit Report*
