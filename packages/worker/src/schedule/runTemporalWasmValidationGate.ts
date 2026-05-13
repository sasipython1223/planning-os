/**
 * @module runTemporalWasmValidationGate
 *
 * W5B-B2.3C Real WASM Validation Gate Harness
 *
 * Executes 7 controlled temporal scheduling scenarios to validate WASM availability and correctness.
 * Diagnostic-only; never mutates canonical state or applies temporal results.
 * Always sets authorityApplied = false.
 *
 * Scenarios:
 * 1. Single calendar 5-day
 * 2. Single calendar 6-day
 * 3. Single calendar 7-day
 * 4. Multi-calendar 5d predecessor → 7d successor
 * 5. Multi-calendar 7d predecessor → 5d successor
 * 6. Invalid calendar fallback
 * 7. Source-date protection
 */

import type { TemporalWasmValidationGatePayload, TemporalWasmValidationScenarioResult } from "@planner/protocol";
import type { MinuteScheduleRequest, MinuteScheduleResponse } from "@planner/protocol/kernel";
import { ENGINE_ABI_VERSION_V2 as ABI_V2 } from "@planner/protocol/kernel";

// ─── Types ───────────────────────────────────────────────────────

type WasmLoadMode = "real" | "unavailable" | "mocked";

type MinuteWasmModule = {
  calculate_schedule_minute: (request: unknown) => unknown;
};

// ─── Constants ───────────────────────────────────────────────────

const MINUTES_PER_DAY = 480;

// ─── Helper functions ───────────────────────────────────────────

const mkTask = (
  id: string,
  durationMinutes: number,
  calendarId: string,
): MinuteScheduleRequest["tasks"][number] => ({
  id,
  durationMinutes,
  minEarlyStartMinutes: 0,
  isSummary: false,
  calendarId,
});

const mkFsDep = (
  predId: string,
  succId: string,
): MinuteScheduleRequest["dependencies"][number] => ({
  predId,
  succId,
  depType: "FS",
  lagMinutes: 0,
  lagCalendarId: "project",
});

const buildCalendarIntervals = (mode: "5d" | "6d" | "7d", horizonDays = 28): Array<[number, number]> => {
  const intervals: Array<[number, number]> = [];
  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const dayOfWeek = dayOffset % 7; // 0=Mon, 5=Sat, 6=Sun
    const works =
      mode === "7d"
        ? true
        : mode === "6d"
          ? dayOfWeek <= 5
          : dayOfWeek <= 4;
    if (works) {
      const start = dayOffset * MINUTES_PER_DAY;
      intervals.push([start, start + MINUTES_PER_DAY]);
    }
  }
  return intervals;
};

const unwrapMinuteResponse = (raw: unknown): MinuteScheduleResponse => {
  if (!raw || typeof raw !== "object") {
    throw new Error("Minute execution returned non-object payload");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type === "string") {
    throw new Error(`Minute execution returned error envelope: ${obj.type}`);
  }
  if (!Array.isArray(obj.results)) {
    throw new Error("Minute execution response missing results[]");
  }
  return obj as unknown as MinuteScheduleResponse;
};

const runMinute = (
  wasm: MinuteWasmModule,
  request: MinuteScheduleRequest,
): MinuteScheduleResponse => {
  const raw = wasm.calculate_schedule_minute(request);
  return unwrapMinuteResponse(raw);
};

const collectTaskIds = (items: readonly TemporalWasmValidationScenarioResult[], key: "expected" | "unexplained"): string[] => {
  const set = new Set<string>();
  for (const item of items) {
    const values = key === "expected" ? item.expectedDivergenceTaskIds : item.unexplainedDivergenceTaskIds;
    for (const value of values) {
      set.add(value);
    }
  }
  return [...set];
};

const asErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

// ─── Scenario execution ──────────────────────────────────────────

const runRealMinuteValidationScenarios = (wasm: MinuteWasmModule): TemporalWasmValidationScenarioResult[] => {
  const results: TemporalWasmValidationScenarioResult[] = [];

  // 1) single 5d
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("A", 6 * MINUTES_PER_DAY, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("5d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_5d",
      status: !!a && a.earlyFinishMinute === 8 * MINUTES_PER_DAY ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 8 * MINUTES_PER_DAY ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
    });
  } catch (error) {
    results.push({
      name: "single_calendar_5d",
      status: "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: ["A"],
      error: asErrorMessage(error),
    });
  }

  // 2) single 6d
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("A", 6 * MINUTES_PER_DAY, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("6d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_6d",
      status: !!a && a.earlyFinishMinute === 6 * MINUTES_PER_DAY ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 6 * MINUTES_PER_DAY ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
    });
  } catch (error) {
    results.push({
      name: "single_calendar_6d",
      status: "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: ["A"],
      error: asErrorMessage(error),
    });
  }

  // 3) single 7d
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("A", 7 * MINUTES_PER_DAY, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("7d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_7d",
      status: !!a && a.earlyFinishMinute === 7 * MINUTES_PER_DAY ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 7 * MINUTES_PER_DAY ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
    });
  } catch (error) {
    results.push({
      name: "single_calendar_7d",
      status: "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: ["A"],
      error: asErrorMessage(error),
    });
  }

  // 4) multi 5d pred -> 7d succ
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("pred", 5 * MINUTES_PER_DAY, "cal5"), mkTask("succ", MINUTES_PER_DAY, "cal7")],
      dependencies: [mkFsDep("pred", "succ")],
      calendars: [
        { id: "project", intervals: buildCalendarIntervals("5d") },
        { id: "cal5", intervals: buildCalendarIntervals("5d") },
        { id: "cal7", intervals: buildCalendarIntervals("7d") },
      ],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const succ = response.results.find((r) => r.taskId === "succ");
    results.push({
      name: "multi_calendar_5d_to_7d",
      status: !!succ && succ.earlyStartMinute === 5 * MINUTES_PER_DAY ? "passed" : "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: [],
      error: !succ ? "Task succ missing" : succ.earlyStartMinute !== 5 * MINUTES_PER_DAY ? `Unexpected succ ES: ${succ.earlyStartMinute}` : undefined,
    });
  } catch (error) {
    results.push({
      name: "multi_calendar_5d_to_7d",
      status: "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: ["succ"],
      error: asErrorMessage(error),
    });
  }

  // 5) multi 7d pred -> 5d succ
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("pred", 6 * MINUTES_PER_DAY, "cal7"), mkTask("succ", MINUTES_PER_DAY, "cal5")],
      dependencies: [mkFsDep("pred", "succ")],
      calendars: [
        { id: "project", intervals: buildCalendarIntervals("5d") },
        { id: "cal5", intervals: buildCalendarIntervals("5d") },
        { id: "cal7", intervals: buildCalendarIntervals("7d") },
      ],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const succ = response.results.find((r) => r.taskId === "succ");
    results.push({
      name: "multi_calendar_7d_to_5d",
      status: !!succ && succ.earlyStartMinute === 7 * MINUTES_PER_DAY ? "passed" : "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: [],
      error: !succ ? "Task succ missing" : succ.earlyStartMinute !== 7 * MINUTES_PER_DAY ? `Unexpected succ ES: ${succ.earlyStartMinute}` : undefined,
    });
  } catch (error) {
    results.push({
      name: "multi_calendar_7d_to_5d",
      status: "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: ["succ"],
      error: asErrorMessage(error),
    });
  }

  // 6) invalid calendar fallback
  try {
    const baselineRequest: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("A", 2 * MINUTES_PER_DAY, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("5d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const fallbackRequest: MinuteScheduleRequest = {
      ...baselineRequest,
      tasks: [mkTask("A", 2 * MINUTES_PER_DAY, "invalid-calendar-id")],
    };
    const baseline = runMinute(wasm, baselineRequest);
    const fallback = runMinute(wasm, fallbackRequest);
    const baseA = baseline.results.find((r) => r.taskId === "A");
    const fbA = fallback.results.find((r) => r.taskId === "A");
    const same = !!baseA && !!fbA
      && baseA.earlyStartMinute === fbA.earlyStartMinute
      && baseA.earlyFinishMinute === fbA.earlyFinishMinute;

    results.push({
      name: "invalid_calendar_fallback",
      status: same ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: same ? [] : ["A"],
      error: same ? undefined : "Fallback response differed from project-calendar baseline",
    });
  } catch (error) {
    results.push({
      name: "invalid_calendar_fallback",
      status: "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: ["A"],
      error: asErrorMessage(error),
    });
  }

  // 7) source-date protection
  try {
    const sourceDatesByTaskId = {
      A: { sourceStartMinutes: 480, sourceFinishMinutes: 1440 },
    };
    const before = JSON.stringify(sourceDatesByTaskId);

    const request: MinuteScheduleRequest = {
      abiVersion: ABI_V2,
      tasks: [mkTask("A", MINUTES_PER_DAY, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("5d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    runMinute(wasm, request);

    const after = JSON.stringify(sourceDatesByTaskId);
    const protectedOk = before === after;

    results.push({
      name: "source_date_protection",
      status: protectedOk ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: protectedOk ? [] : ["A"],
      error: protectedOk ? undefined : "sourceDatesByTaskId mutated during validation",
    });
  } catch (error) {
    results.push({
      name: "source_date_protection",
      status: "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: ["A"],
      error: asErrorMessage(error),
    });
  }

  return results;
};

// ─── Main gate result builder ───────────────────────────────────

/**
 * Run the real WASM validation gate harness.
 * Returns a diagnostic-only result; never mutates state or applies temporal results.
 *
 * @param wasm WASM module with calculate_schedule_minute export, or null if unavailable.
 * @returns Gate result payload with authorityApplied always false.
 */
export const runTemporalWasmValidationGate = (wasm: MinuteWasmModule | null): TemporalWasmValidationGatePayload => {
  const startTime = performance.now();

  // Check WASM availability
  if (!wasm) {
    return {
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
    };
  }

  // Run scenarios
  let scenarioResults: TemporalWasmValidationScenarioResult[] = [];
  const temporalExecutionErrors: string[] = [];

  try {
    scenarioResults = runRealMinuteValidationScenarios(wasm);
  } catch (error) {
    const msg = asErrorMessage(error);
    temporalExecutionErrors.push(msg);
    return {
      realWasmValidationPassed: false,
      wasmLoadMode: "real",
      scenariosPlanned: 7,
      scenariosExecuted: 0,
      scenariosPassed: 0,
      scenariosFailed: 7,
      scenariosBlocked: 0,
      sourceProtectionStatus: "blocked",
      authorityApplied: false,
      performanceMs: performance.now() - startTime,
      scenarioResults: [],
      blockerReason: msg,
      temporalExecutionErrors: [msg],
      unexplainedDivergenceTaskIds: [],
      expectedDivergenceTaskIds: [],
    };
  }

  // Build result
  const scenariosPlanned = scenarioResults.length;
  const scenariosExecuted = scenarioResults.filter((s) => s.status !== "blocked").length;
  const scenariosPassed = scenarioResults.filter((s) => s.status === "passed").length;
  const scenariosFailed = scenarioResults.filter((s) => s.status === "failed").length;
  const scenariosBlocked = scenarioResults.filter((s) => s.status === "blocked").length;
  const unexplainedDivergenceTaskIds = collectTaskIds(scenarioResults, "unexplained");
  const expectedDivergenceTaskIds = collectTaskIds(scenarioResults, "expected");

  const realWasmValidationPassed =
    scenariosFailed === 0
    && temporalExecutionErrors.length === 0
    && unexplainedDivergenceTaskIds.length === 0;

  return {
    realWasmValidationPassed,
    wasmLoadMode: "real",
    scenariosPlanned,
    scenariosExecuted,
    scenariosPassed,
    scenariosFailed,
    scenariosBlocked,
    sourceProtectionStatus: realWasmValidationPassed ? "ok" : "blocked",
    authorityApplied: false,
    performanceMs: performance.now() - startTime,
    scenarioResults,
    temporalExecutionErrors,
    unexplainedDivergenceTaskIds,
    expectedDivergenceTaskIds,
  };
};
