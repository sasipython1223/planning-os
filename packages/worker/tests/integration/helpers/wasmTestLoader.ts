/**
 * TEST-ONLY WASM HARNESS HELPER — DO NOT IMPORT FROM PRODUCTION.
 *
 * Thin wrapper around the production `loadCpmWasm` for use under the
 * dedicated `vitest.integration.config.ts` only.
 *
 * Contract (W5B-B2.12A.8.1):
 *   - Executes the **real** compiled `cpm-wasm` pkg artifact.
 *   - Does NOT mock the JS-to-WASM boundary.
 *   - Does NOT reimplement any Rust algorithm in JS.
 *   - Does NOT trigger a WASM rebuild.
 *   - Does NOT use AI003 data.
 *
 * The helper exists only to (a) consolidate the boundary call-shape used
 * by every test in `w5b-b2-12a-8-real-wasm-boundary.test.ts`, and
 * (b) keep the per-test code focused on assertions rather than ABI
 * plumbing. Production callers must continue to use the worker's
 * scheduling pipeline; do not import this helper outside `tests/`.
 */

import { getCpmWasm, isWasmLoaded, loadCpmWasm } from "../../../src/wasm/loadCpmWasm.js";

/**
 * Boundary-shaped task input for the minute-native ABI v2 entry point
 * (`calculate_schedule_minute`). Matches `TemporalTaskBoundary` in
 * `packages/cpm-wasm/src/lib.rs` — kept here only so test files do not
 * have to import that struct shape from production. No conversion
 * logic.
 */
export interface RealWasmTaskInput {
  id: string;
  durationMinutes: number;
  minEarlyStartMinutes?: number;
  calendarId: string;
  parentId?: string | null;
  isSummary?: boolean;
  constraintType?: "ASAP" | "ALAP" | "SNET" | "FNLT" | "MSO" | "MFO";
  constraintDateMinute?: number | null;
}

export interface RealWasmRelationInput {
  predId: string;
  succId: string;
  depType?: "FS" | "SS" | "FF" | "SF";
  lagMinutes?: number;
  lagCalendarId?: string;
}

export interface RealWasmCalendar {
  id: string;
  /** Half-open working-time intervals as `[start, end)` tuples. */
  intervals: Array<[number, number]>;
}

export interface RealWasmMinuteRequest {
  abiVersion: 2;
  tasks: RealWasmTaskInput[];
  dependencies: RealWasmRelationInput[];
  calendars: RealWasmCalendar[];
  projectCalendarId: string;
  dataDateMinute?: number;
}

export interface RealWasmTaskResult {
  taskId: string;
  earlyStartMinute: number;
  earlyFinishMinute: number;
  lateStartMinute: number;
  lateFinishMinute: number;
  totalFloatMinutes: number;
  freeFloatMinutes: number;
  isCritical: boolean;
}

export interface RealWasmMinuteResponse {
  scheduleVersion: number;
  results: RealWasmTaskResult[];
}

/**
 * Idempotently initialise the real cpm-wasm module via the production
 * `loadCpmWasm` path. Safe to call from each test's `beforeAll`.
 */
export async function ensureRealWasmLoaded(): Promise<void> {
  if (!isWasmLoaded()) {
    await loadCpmWasm();
  }
}

/**
 * Execute the minute-native ABI v2 entry point (`calculate_schedule_minute`)
 * against the real WASM artifact. No mocking. No rebuild.
 *
 * Per `packages/cpm-wasm/src/lib.rs`, this routes to
 * `cpm_kernel::run_schedule_temporal`. The worker's production path
 * does NOT currently call this entry point (slot kernel remains
 * authoritative); the harness exercises it directly to verify the
 * JS↔WASM boundary for the temporal kernel.
 */
export function runRealWasmMinute(req: RealWasmMinuteRequest): RealWasmMinuteResponse {
  const m = getCpmWasm();
  return m.calculate_schedule_minute(req) as RealWasmMinuteResponse;
}
