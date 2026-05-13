# W5B-B2.3C.3 Worker Diagnostic Validation Command Report

## 1. Summary

Implemented the Worker-side diagnostic validation command (`RUN_TEMPORAL_WASM_VALIDATION_GATE`) following the W5B-B2.3C.2 audit design. The command:

- ✅ Executes real WASM validation harness (7 controlled scenarios)
- ✅ Returns diagnostic-only result; never mutates canonical state
- ✅ Never applies temporal results or flips authority
- ✅ Sets `authorityApplied = false` always
- ✅ Classifies unavailable-WASM path as blocked, not failed
- ✅ Preserves sourceImportedNotCalculated lifecycle
- ✅ Does not emit DIFF_STATE or trigger UI re-renders
- ✅ Ready for browser-side invocation via Worker.postMessage()

## 2. Protocol Changes

### 2.1 New Command Type

**File:** `packages/protocol/src/types.ts`

```typescript
export type RunTemporalWasmValidationGateCommand = {
  type: "RUN_TEMPORAL_WASM_VALIDATION_GATE";
  v: 1;
  reqId: string;
  internalOnly?: boolean;
};
```

- Added to `Command` union
- Follows existing command style (v: 1, reqId, payload-less for diagnostics)

### 2.2 New Response Message Type

**File:** `packages/protocol/src/types.ts`

```typescript
export type TemporalWasmValidationScenarioResult = {
  readonly name: string;
  readonly status: "passed" | "failed" | "blocked";
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly error?: string;
};

export type TemporalWasmValidationGatePayload = {
  readonly realWasmValidationPassed: boolean;
  readonly wasmLoadMode: "real" | "unavailable" | "mocked";
  readonly scenariosPlanned: number;
  readonly scenariosExecuted: number;
  readonly scenariosPassed: number;
  readonly scenariosFailed: number;
  readonly scenariosBlocked: number;
  readonly blockerReason?: string;
  readonly temporalExecutionErrors: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  readonly authorityApplied: false;
  readonly performanceMs: number | null;
  readonly scenarioResults: readonly TemporalWasmValidationScenarioResult[];
};

export type TemporalWasmValidationGateMessage = {
  type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalWasmValidationGatePayload;
};
```

- Added to `WorkerMessage` union
- Response correlates with request via `reqId`

### 2.3 Protocol Exports

**File:** `packages/protocol/src/index.ts`

Added to exports:
- `RunTemporalWasmValidationGateCommand`
- `TemporalWasmValidationGateMessage`
- `TemporalWasmValidationGatePayload`
- `TemporalWasmValidationScenarioResult`

## 3. Validation Harness

### 3.1 Location & Purpose

**File:** `packages/worker/src/schedule/runTemporalWasmValidationGate.ts`

Extracted reusable harness function:
```typescript
export const runTemporalWasmValidationGate = (
  wasm: MinuteWasmModule | null
): TemporalWasmValidationGatePayload => { ... }
```

### 3.2 Scenario Execution

Runs 7 controlled scenarios:

1. **single_calendar_5d** — 6-day task on 5-day calendar
   - Expected: finishes at day 8

2. **single_calendar_6d** — 6-day task on 6-day calendar
   - Expected: finishes at day 6

3. **single_calendar_7d** — 7-day task on 7-day calendar
   - Expected: finishes at day 7

4. **multi_calendar_5d_to_7d** — 5d predecessor → 7d successor (FS link)
   - Expected: successor starts at day 5 (predecessor finishes)

5. **multi_calendar_7d_to_5d** — 7d predecessor → 5d successor (FS link)
   - Expected: successor starts at day 7 (predecessor finishes)

6. **invalid_calendar_fallback** — Invalid calendar ID on task
   - Expected: falls back to project calendar and matches baseline

7. **source_date_protection** — Validate source dates not mutated
   - Expected: sourceDatesByTaskId unchanged before/after WASM call

### 3.3 Unavailable-WASM Path

When WASM is null:
```typescript
{
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
  temporalExecutionErrors: [],
  unexplainedDivergenceTaskIds: [],
  expectedDivergenceTaskIds: [],
}
```

**Key semantics:**
- ✅ `scenariosBlocked = 7` (not failed)
- ✅ `scenariosFailed = 0`
- ✅ `sourceProtectionStatus = "not_evaluated_wasm_unavailable"` (not violated)

### 3.4 Real-WASM Path

When WASM is available and scenarios execute:
```typescript
{
  realWasmValidationPassed: (all scenarios passed),
  wasmLoadMode: "real",
  scenariosPlanned: 7,
  scenariosExecuted: 7,
  scenariosPassed: number,
  scenariosFailed: number,
  scenariosBlocked: 0,
  sourceProtectionStatus: (pass ? "ok" : "blocked"),
  authorityApplied: false,
  performanceMs: number,
  scenarioResults: [7 result objects],
  temporalExecutionErrors: [],
  unexplainedDivergenceTaskIds: [],
  expectedDivergenceTaskIds: [],
}
```

## 4. Worker Wiring

### 4.1 Command Handler

**File:** `packages/worker/src/worker.ts`

Command handler added in `handleCommand()`:

```typescript
if (cmd.type === "RUN_TEMPORAL_WASM_VALIDATION_GATE") {
  try {
    // Get cached WASM if available
    let wasmModule = null;
    try {
      if (isWasmLoaded()) {
        wasmModule = getCpmWasm() as unknown as { calculate_schedule_minute: ... } | null;
      }
    } catch {
      wasmModule = null;
    }

    // Run validation harness (diagnostic-only)
    const result = runTemporalWasmValidationGate(wasmModule);

    // Emit result with matching reqId
    emit({
      type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: result,
    });
    return ack();
  } catch (error) {
    // Emit NACK on exception (safety net)
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
    return nack(reason, "logical");
  }
}
```

### 4.2 Safety Guarantees

**State protection:**
- ✅ No call to `State.updateTask()`, `State.addDependency()`, etc.
- ✅ No call to `State.setScheduleLifecycle()` or lifecycle mutations
- ✅ No call to `emit({ type: "DIFF_STATE", ... })`
- ✅ No call to `savePersistedState()`

**Authority protection:**
- ✅ `authorityApplied` always false in result
- ✅ No call to `engineFacade.execute()` or scheduling engine
- ✅ No path to flip `d10eExecutionRoute` or `d10fExecutionArtifact`

**WASM usage:**
- ✅ Reuses cached WASM loaded at Worker init
- ✅ No re-loading or dynamic import
- ✅ Graceful handling when WASM unavailable

### 4.3 Imports Added

```typescript
import { runTemporalWasmValidationGate } from "./schedule/runTemporalWasmValidationGate.js";
import { getCpmWasm, isWasmLoaded, loadCpmWasm } from "./wasm/loadCpmWasm.js";
```

## 5. Gate Result Semantics

### 5.1 WASM Unavailable Path

```typescript
wasmLoadMode: "unavailable"
scenariosBlocked: 7
scenariosExecuted: 0
scenariosFailed: 0
sourceProtectionStatus: "not_evaluated_wasm_unavailable"
```

**Semantics:**
- Scenarios are **blocked**, not failed (Node/Vitest limitation)
- Source protection cannot be evaluated (WASM unavailable)
- Authority remains unaffected (no execution attempt)

### 5.2 WASM Real Path - All Pass

```typescript
wasmLoadMode: "real"
scenariosPassed: 7
scenariosFailed: 0
scenariosBlocked: 0
sourceProtectionStatus: "ok"
realWasmValidationPassed: true
```

**Semantics:**
- ✅ WASM executed successfully
- ✅ All scenarios produced expected results
- ✅ Source dates protected (not mutated)
- ✅ Validation passed; ready for authority flip gate

### 5.3 WASM Real Path - Divergence

```typescript
wasmLoadMode: "real"
unexplainedDivergenceTaskIds: ["taskId1", "taskId2"]
sourceProtectionStatus: "blocked"
realWasmValidationPassed: false
```

**Semantics:**
- WASM executed but results diverged from expectations
- Divergence is unexplained (not expected per calendar config)
- Authority flip gate must reject this scenario

## 6. Tests Added/Updated

### 6.1 New Test File

**File:** `packages/worker/tests/schedule/w5b-b2-3c-command-harness.test.ts`

9 tests added covering:

1. **Returns unavailable result when WASM is null**
   - Validates all fields for unavailable path

2. **authorityApplied is always false**
   - Validates safety contract

3. **Blocked scenarios count correctly when WASM unavailable**
   - Verifies semantics (7 blocked, 0 executed, 0 failed)

4. **sourceProtectionStatus is not_evaluated_wasm_unavailable when WASM unavailable**
   - Validates protection status

5. **temporalExecutionErrors is empty when WASM unavailable**
   - Validates error list when no execution

6. **Scenarios remain at 7 planned regardless of WASM availability**
   - Validates consistent planning count

7. **Returns diagnostic payload structure with all required fields**
   - Validates payload shape matches protocol

8. **Does not mutate any Worker state (diagnostic-only)**
   - Validates read-only contract

9. **realWasmValidationPassed is false when WASM unavailable**
   - Validates gate result flag

### 6.2 Existing Test Status

✅ **All existing tests pass:**
- `packages/worker/tests/schedule/w5b-b2-3-real-wasm-validation-gate.test.ts` — 1 test (unchanged)
- All 1095 worker tests pass
- All 478 web app tests pass

## 7. Validation Results

### 7.1 Typecheck

```bash
pnpm --filter @planner/protocol run typecheck
✅ PASS

pnpm --filter @planner/worker run typecheck
✅ PASS

pnpm --filter @planner/web run typecheck
✅ PASS
```

### 7.2 Unit Tests

```bash
cd packages/worker && npx vitest run --reporter=dot
✓ Test Files  54 passed (54)
✓ Tests  1095 passed (1095)
✓ w5b-b2-3c-command-harness.test.ts  9 tests
```

```bash
cd apps/web && npx vitest run --reporter=dot
✓ Test Files  38 passed (38)
✓ Tests  478 passed (478)
```

### 7.3 Validation Checklist

- ✅ Command returns `TEMPORAL_WASM_VALIDATION_GATE_RESULT`
- ✅ `reqId` preserved in response
- ✅ `authorityApplied` always `false`
- ✅ Node/Vitest unavailable-WASM classified as blocked, not failed
- ✅ `sourceProtectionStatus` is `not_evaluated_wasm_unavailable` when WASM unavailable
- ✅ `scenariosBlocked` is 7, `scenariosFailed` is 0 when WASM unavailable
- ✅ Command does not mutate Worker state
- ✅ Command does not emit DIFF_STATE or schedule mutations
- ✅ Authority remains blocked when validation fails
- ✅ W5B-B2.3A blocked-gate test remains valid (not altered)

## 8. Remaining Work

### 8.1 Deferred Tasks

- ⏳ **Browser hook not implemented** — Deferred to separate task
  - App will expose `window.__runTemporalWasmValidationGate()` for dev/test
  - Will trigger command via `worker.postMessage()`

- ⏳ **Playwright/browser infra not set up** — Deferred to separate task
  - No browser-based test framework added
  - Node/Vitest path remains the test harness base

- ⏳ **Real browser-WASM validation not passed** — Deferred until browser trigger exists
  - Worker command ready; browser-side integration pending

- ⏳ **Authority cutover** — Separate phase (D10+)
  - Validation gate result informs authority flip policy
  - No authority changes made by this implementation

### 8.2 What Was NOT Done (Per Requirements)

- ❌ No Playwright or browser test infrastructure
- ❌ No direct `@planner/engine` import in web app
- ❌ No authority flip or temporal application
- ❌ No resource calendars or full lag-calendar parity
- ❌ No P6 constraint semantics
- ❌ No removal or bypass of slot engine

## 9. Next Steps

**W5B-B2.3C.4 (Future):**
1. Add browser hook in app to expose diagnostic command
2. Trigger Worker command from dev/test-only window function
3. Collect result and return to browser test/diagnostics

**W5B-B2.3C.5 (Future):**
1. Integrate Playwright browser test infrastructure (if approved)
2. Run real browser-WASM validation end-to-end
3. Validate real WASM loads and executes in browser context

**D10+ (Authority Cutover):**
1. Use validation gate result to inform authority policy gate
2. Connect `realWasmValidationPassed` to authority flip decision
3. Enable minute/temporal authority when all gates pass

---

## Files Modified

| File | Change |
|------|--------|
| `packages/protocol/src/types.ts` | Added command & response types |
| `packages/protocol/src/index.ts` | Added exports for new types |
| `packages/worker/src/schedule/runTemporalWasmValidationGate.ts` | Created (new harness) |
| `packages/worker/src/worker.ts` | Added command handler + imports |
| `packages/worker/tests/schedule/w5b-b2-3c-command-harness.test.ts` | Created (9 tests) |

---

**Status:** ✅ **READY FOR BROWSER INTEGRATION**

The Worker diagnostic validation command is complete, tested, and ready for browser-side invocation. No authority flip occurred. No canonical state was mutated. The blocked semantics for unavailable-WASM are correct.

*Implementation date: 2026-05-10*
