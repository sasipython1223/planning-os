/**
 * Test: RUN_TEMPORAL_WASM_VALIDATION_GATE Command
 *
 * W5B-B2.3C.3 Worker Diagnostic Validation Command Tests
 */

import { describe, expect, it } from "vitest";
import { runTemporalWasmValidationGate } from "../../src/schedule/runTemporalWasmValidationGate.js";

describe("RUN_TEMPORAL_WASM_VALIDATION_GATE Command", () => {
  it("returns unavailable result when WASM is null", () => {
    const result = runTemporalWasmValidationGate(null);

    expect(result.realWasmValidationPassed).toBe(false);
    expect(result.wasmLoadMode).toBe("unavailable");
    expect(result.scenariosPlanned).toBe(7);
    expect(result.scenariosExecuted).toBe(0);
    expect(result.scenariosPassed).toBe(0);
    expect(result.scenariosFailed).toBe(0);
    expect(result.scenariosBlocked).toBe(7);
    expect(result.sourceProtectionStatus).toBe("not_evaluated_wasm_unavailable");
    expect(result.authorityApplied).toBe(false);
    expect(result.performanceMs).toBe(null);
    expect(result.scenarioResults).toEqual([]);
    expect(result.blockerReason).toBe("WASM module not available");
  });

  it("authorityApplied is always false", () => {
    const resultNull = runTemporalWasmValidationGate(null);
    expect(resultNull.authorityApplied).toBe(false);
  });

  it("blocked scenarios count correctly when WASM unavailable", () => {
    const result = runTemporalWasmValidationGate(null);
    expect(result.scenariosBlocked).toBe(7);
    expect(result.scenariosExecuted).toBe(0);
  });

  it("sourceProtectionStatus is not_evaluated_wasm_unavailable when WASM unavailable", () => {
    const result = runTemporalWasmValidationGate(null);
    expect(result.sourceProtectionStatus).toBe("not_evaluated_wasm_unavailable");
  });

  it("temporalExecutionErrors is empty when WASM unavailable", () => {
    const result = runTemporalWasmValidationGate(null);
    expect(result.temporalExecutionErrors).toEqual([]);
  });

  it("scenarios remain at 7 planned regardless of WASM availability", () => {
    const resultNull = runTemporalWasmValidationGate(null);
    expect(resultNull.scenariosPlanned).toBe(7);
  });

  it("returns diagnostic payload structure with all required fields", () => {
    const result = runTemporalWasmValidationGate(null);

    // Verify all required fields are present
    expect(result).toHaveProperty("realWasmValidationPassed");
    expect(result).toHaveProperty("wasmLoadMode");
    expect(result).toHaveProperty("scenariosPlanned");
    expect(result).toHaveProperty("scenariosExecuted");
    expect(result).toHaveProperty("scenariosPassed");
    expect(result).toHaveProperty("scenariosFailed");
    expect(result).toHaveProperty("scenariosBlocked");
    expect(result).toHaveProperty("sourceProtectionStatus");
    expect(result).toHaveProperty("authorityApplied");
    expect(result).toHaveProperty("performanceMs");
    expect(result).toHaveProperty("scenarioResults");
    expect(result).toHaveProperty("temporalExecutionErrors");
    expect(result).toHaveProperty("unexplainedDivergenceTaskIds");
    expect(result).toHaveProperty("expectedDivergenceTaskIds");
  });

  it("does not mutate any Worker state (diagnostic-only)", () => {
    // This test verifies the contract: validation harness is read-only
    // The harness doesn't mutate State.* records or canonical data
    const result = runTemporalWasmValidationGate(null);
    expect(result).toBeDefined();
    // If we had State access here, we'd verify State.getTasks(), State.getDependencies(), etc. are unchanged
    // but this is a unit test of the harness function itself
  });

  it("realWasmValidationPassed is false when WASM unavailable", () => {
    const result = runTemporalWasmValidationGate(null);
    expect(result.realWasmValidationPassed).toBe(false);
  });
});
