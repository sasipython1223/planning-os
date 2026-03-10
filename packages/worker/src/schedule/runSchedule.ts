import type { ScheduleError, ScheduleRequest, ScheduleResponse } from "protocol/kernel";
import { getCpmWasm } from "../wasm/loadCpmWasm.js";

/**
 * Execute schedule calculation via WASM bridge.
 * Returns either ScheduleResponse or ScheduleError.
 * No direct worker event handling - just pure input/output.
 */

export const runSchedule = (
  request: ScheduleRequest
): ScheduleResponse | ScheduleError => {
  const wasm = getCpmWasm();

  if (typeof wasm.calculate_schedule !== "function") {
    return {
      type: "CycleDetected",
      message: "WASM module loaded but calculate_schedule is not available. Was init() called?",
    };
  }

  try {
    // Call WASM calculate_schedule
    const result = wasm.calculate_schedule(request);

    // Result can be either ScheduleResponse or ScheduleError
    // Both are valid return types from the WASM boundary
    const typedResult = result as ScheduleResponse | ScheduleError;

    // Check if it's an error by looking for the discriminated union 'type' field
    if ("type" in typedResult && typeof typedResult.type === "string") {
      // It's a ScheduleError
      return typedResult as ScheduleError;
    }

    // It's a ScheduleResponse
    return typedResult as ScheduleResponse;
  } catch (error) {
    // WASM threw an exception - convert to error format
    return {
      type: "CycleDetected",
      message: `WASM error: ${error}`,
    };
  }
};
