/**
 * @module TemporalEngineAdapter
 *
 * Phases D3–D8c — Minute-native kernel adapter implementing ISchedulingEngine.
 *
 * D8c: Wraps the minute-native kernel path (MinuteEngineAdapter.prepareRequest →
 * calculate_schedule_minute → translate outputs) behind the uniform
 * ISchedulingEngine interface.
 *
 * Phase D8c: Shadow engine only. This adapter is invoked by the
 * ShadowEngineFacade asynchronously (via setTimeout) AFTER the slot
 * engine has already produced the authoritative result. The minute
 * results are used only for comparison logging — they never flow into
 * projection, persistence, or UI.
 *
 * D8c: input preparation via MinuteEngineAdapter emits ABI v2 request.
 * Output translation via TemporalScheduleTranslator produces
 * NormalizedScheduleFacts (calendar dates + working-minute floats).
 *
 * Invariants:
 *   - The returned EngineResult is ALWAYS from the slot engine (via facade).
 *   - The minute engine's result never flows into projection, persistence, or UI.
 *   - The minute engine never mutates worker state.
 *   - If the minute engine throws, the error is logged and swallowed.
 *   - calculate_schedule remains the sole authoritative WASM entrypoint.
 */

import {
    recordShadowEngineExecDuration,
    recordShadowRequestBuildDuration,
} from "./CutoverReadinessGate.js";
import type { TranslationContext } from "./IScheduleTranslator.js";
import type { EngineResult, ISchedulingEngine, SchedulingStateSnapshot } from "./ISchedulingEngine.js";
import { MinuteEngineAdapter } from "./MinuteEngineAdapter.js";
import type { NormalizedScheduleFacts } from "./NormalizedScheduleFact.js";
import type { TemporalScheduleResponseBoundary } from "./TemporalScheduleTranslator.js";
import { TemporalScheduleTranslator } from "./TemporalScheduleTranslator.js";

// ─── WASM bridge ────────────────────────────────────────────────────

type MinuteNativeWasmModule = {
  calculate_schedule_minute: (request: unknown) => unknown;
};

let wasmModule: MinuteNativeWasmModule | null = null;

/**
 * Set the WASM module reference for minute-native execution.
 * Called once during worker initialization after loadCpmWasm completes.
 * D8c: Extracts calculate_schedule_minute entrypoint (shadow path).
 */
export const setTemporalWasm = (mod: MinuteNativeWasmModule): void => {
  wasmModule = mod;
};

/** Reset WASM reference (tests only). */
export const _resetTemporalWasm = (): void => {
  wasmModule = null;
};

const getTemporalWasm = (): MinuteNativeWasmModule => {
  if (!wasmModule) {
    throw new Error("Minute-native WASM module not loaded. Call setTemporalWasm() first.");
  }
  return wasmModule;
};

// Module-level helpers — stateless, safe to reuse.
const minuteEngineAdapter = new MinuteEngineAdapter();
const temporalOutputTranslator = new TemporalScheduleTranslator();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTemporalTaskResultBoundary = (
  value: unknown,
): value is TemporalScheduleResponseBoundary["results"][number] => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.taskId === "string" &&
    isFiniteNumber(item.earlyStartMinute) &&
    isFiniteNumber(item.earlyFinishMinute) &&
    isFiniteNumber(item.lateStartMinute) &&
    isFiniteNumber(item.lateFinishMinute) &&
    isFiniteNumber(item.totalFloatMinutes) &&
    isFiniteNumber(item.freeFloatMinutes) &&
    typeof item.isCritical === "boolean"
  );
};

const isTemporalScheduleResponseBoundary = (
  value: unknown,
): value is TemporalScheduleResponseBoundary => {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!isFiniteNumber(obj.scheduleVersion)) return false;
  if (!Array.isArray(obj.results)) return false;
  return obj.results.every(isTemporalTaskResultBoundary);
};

// ─── Adapter ────────────────────────────────────────────────────────

/**
 * Minute-native engine adapter — wraps the minute-native kernel path.
 *
 * D8c: Shadow engine only. Never authoritative. Prepares minute-native
 * request (MinuteEngineAdapter) and routes to calculate_schedule_minute
 * WASM entrypoint. Output translated by TemporalScheduleTranslator.
 * Worker passes canonical state only.
 */
export class TemporalEngineAdapter implements ISchedulingEngine {
  execute(state: SchedulingStateSnapshot): EngineResult {
    // D8c: Prepare minute-native ABI v2 request
    const requestBuildStart = performance.now();
    const minuteRequest = minuteEngineAdapter.prepareRequest(state);
    recordShadowRequestBuildDuration(performance.now() - requestBuildStart);

    try {
      const wasm = getTemporalWasm();
      const engineExecStart = performance.now();
      const raw = wasm.calculate_schedule_minute(minuteRequest);
      recordShadowEngineExecDuration(performance.now() - engineExecStart);

      if (!raw || typeof raw !== "object") {
        console.warn("[D8g Shadow] Minute response shape invalid.");
        return {
          rawResult: {
            type: "ShadowMalformedResponse",
            message: "Minute shadow response failed shape validation",
          } as any,
          normalized: null,
        };
      }

      // Check for error response (discriminated union with 'type' field)
      const result = raw as Record<string, unknown>;
      if ("type" in result && typeof result.type === "string") {
        // Minute kernel returned an error — cannot translate.
        // D8c: rawResult is opaque — only normalized facts are consumed by comparator.
        return {
          rawResult: result as any,
          normalized: null,
        };
      }

      if (!isTemporalScheduleResponseBoundary(result)) {
        // Contract drift or malformed success payload. Keep shadow path
        // non-blocking but make failure explicit for parity diagnostics.
        console.warn("[D8g Shadow] Minute response shape invalid.");
        return {
          rawResult: {
            type: "ShadowMalformedResponse",
            message: "Minute shadow response failed shape validation",
          } as any,
          normalized: null,
        };
      }

      // Success — translate to normalized facts
      const outputContext: TranslationContext = {
        projectStartDate: state.projectStartDate,
        minutesPerDay: state.temporalAdapter.minutesPerDay as number,
      };
      const response = result;
      const normalized: NormalizedScheduleFacts | null =
        temporalOutputTranslator.translate(response, outputContext);

      // D8c: rawResult is opaque — only normalized facts are consumed by comparator.
      return {
        rawResult: result as any,
        normalized,
      };
    } catch (error) {
      // WASM threw — log and swallow. Shadow failure must never
      // affect the authoritative slot path.
      console.warn("[D8c Shadow] Minute kernel threw:", error);
      // D8c: rawResult is opaque — never consumed downstream.
      return {
        rawResult: {
          type: "ShadowExecutionFailed",
          message: `Minute WASM error: ${error}`,
        } as any,
        normalized: null,
      };
    }
  }
}
