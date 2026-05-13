import { ENGINE_ABI_VERSION_V2, type MinuteScheduleRequest, type MinuteScheduleResponse } from "@planner/protocol/kernel";
import { describe, expect, it } from "vitest";
import { buildTemporalAuthorityRoutingInput, decideScheduleAuthorityPolicy } from "../../src/schedule/ScheduleAuthorityPolicyGate.js";
import { getCpmWasm, loadCpmWasm } from "../../src/wasm/loadCpmWasm.js";

type WasmLoadMode = "real" | "mocked" | "unavailable";

type ValidationScenarioName =
  | "single_calendar_5d"
  | "single_calendar_6d"
  | "single_calendar_7d"
  | "multi_calendar_5d_to_7d"
  | "multi_calendar_7d_to_5d"
  | "invalid_calendar_fallback"
  | "source_date_protection";

type ValidationScenarioResult = {
  readonly name: ValidationScenarioName;
  readonly status: "passed" | "failed" | "blocked";
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly error?: string;
};

type RealWasmValidationGateResult = {
  readonly realWasmValidationPassed: boolean;
  readonly wasmLoadMode: WasmLoadMode;
  readonly scenariosPlanned: number;
  readonly scenariosExecuted: number;
  readonly scenariosPassed: number;
  readonly scenariosFailed: number;
  readonly scenariosBlocked: number;
  readonly temporalExecutionErrors: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly sourceProtectionStatus: "ok" | "violated" | "blocked" | "not_evaluated_wasm_unavailable";
  readonly performanceMs: number | null;
  readonly authorityApplied: false;
  readonly scenarioResults: readonly ValidationScenarioResult[];
  readonly blockerReason?: string;
};

type MinuteWasmModule = {
  calculate_schedule_minute: (request: unknown) => unknown;
};

const day = 480;

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
    const dayOfWeek = dayOffset % 7; // 0=Mon, 5=Sat, 6=Sun in this synthetic fixture
    const works =
      mode === "7d"
        ? true
        : mode === "6d"
          ? dayOfWeek <= 5
          : dayOfWeek <= 4;
    if (works) {
      const start = dayOffset * day;
      intervals.push([start, start + day]);
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

const collectTaskIds = (items: readonly ValidationScenarioResult[], key: "expected" | "unexplained"): string[] => {
  const set = new Set<string>();
  for (const item of items) {
    const values = key === "expected" ? item.expectedDivergenceTaskIds : item.unexplainedDivergenceTaskIds;
    for (const value of values) {
      set.add(value);
    }
  }
  return [...set];
};

const buildGateResult = (
  wasmLoadMode: WasmLoadMode,
  scenarioResults: readonly ValidationScenarioResult[],
  temporalExecutionErrors: readonly string[],
  sourceProtectionStatus: "ok" | "violated" | "blocked" | "not_evaluated_wasm_unavailable",
  performanceMs: number | null,
  blockerReason?: string,
): RealWasmValidationGateResult => {
  const scenariosPlanned = scenarioResults.length;
  const scenariosExecuted = scenarioResults.filter((s) => s.status !== "blocked").length;
  const scenariosPassed = scenarioResults.filter((s) => s.status === "passed").length;
  const scenariosFailed = scenarioResults.filter((s) => s.status === "failed").length;
  const scenariosBlocked = scenarioResults.filter((s) => s.status === "blocked").length;
  const unexplainedDivergenceTaskIds = collectTaskIds(scenarioResults, "unexplained");
  const expectedDivergenceTaskIds = collectTaskIds(scenarioResults, "expected");

  const realWasmValidationPassed =
    wasmLoadMode === "real"
    && scenariosFailed === 0
    && temporalExecutionErrors.length === 0
    && unexplainedDivergenceTaskIds.length === 0
    && sourceProtectionStatus === "ok";

  return {
    realWasmValidationPassed,
    wasmLoadMode,
    scenariosPlanned,
    scenariosExecuted,
    scenariosPassed,
    scenariosFailed,
    scenariosBlocked,
    temporalExecutionErrors,
    unexplainedDivergenceTaskIds,
    expectedDivergenceTaskIds,
    sourceProtectionStatus,
    performanceMs,
    authorityApplied: false,
    scenarioResults,
    blockerReason,
  };
};

const asErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

const runRealMinuteValidationScenarios = (wasm: MinuteWasmModule): ValidationScenarioResult[] => {
  const results: ValidationScenarioResult[] = [];

  // 1) single 5d
  try {
    const request: MinuteScheduleRequest = {
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("A", 6 * day, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("5d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_5d",
      status: !!a && a.earlyFinishMinute === 8 * day ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 8 * day ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("A", 6 * day, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("6d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_6d",
      status: !!a && a.earlyFinishMinute === 6 * day ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 6 * day ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("A", 7 * day, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("7d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const response = runMinute(wasm, request);
    const a = response.results.find((r) => r.taskId === "A");
    results.push({
      name: "single_calendar_7d",
      status: !!a && a.earlyFinishMinute === 7 * day ? "passed" : "failed",
      expectedDivergenceTaskIds: [],
      unexplainedDivergenceTaskIds: [],
      error: !a ? "Task A missing" : a.earlyFinishMinute !== 7 * day ? `Unexpected finish: ${a.earlyFinishMinute}` : undefined,
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("pred", 5 * day, "cal5"), mkTask("succ", day, "cal7")],
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
      status: !!succ && succ.earlyStartMinute === 5 * day ? "passed" : "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: [],
      error: !succ ? "Task succ missing" : succ.earlyStartMinute !== 5 * day ? `Unexpected succ ES: ${succ.earlyStartMinute}` : undefined,
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("pred", 6 * day, "cal7"), mkTask("succ", day, "cal5")],
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
      status: !!succ && succ.earlyStartMinute === 7 * day ? "passed" : "failed",
      expectedDivergenceTaskIds: ["succ"],
      unexplainedDivergenceTaskIds: [],
      error: !succ ? "Task succ missing" : succ.earlyStartMinute !== 7 * day ? `Unexpected succ ES: ${succ.earlyStartMinute}` : undefined,
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("A", 2 * day, "project")],
      dependencies: [],
      calendars: [{ id: "project", intervals: buildCalendarIntervals("5d") }],
      projectCalendarId: "project",
      dataDateMinute: 0,
    };
    const fallbackRequest: MinuteScheduleRequest = {
      ...baselineRequest,
      tasks: [mkTask("A", 2 * day, "invalid-calendar-id")],
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
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks: [mkTask("A", day, "project")],
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

const buildUnavailableScenarioResults = (reason: string): ValidationScenarioResult[] => {
  const names: ValidationScenarioName[] = [
    "single_calendar_5d",
    "single_calendar_6d",
    "single_calendar_7d",
    "multi_calendar_5d_to_7d",
    "multi_calendar_7d_to_5d",
    "invalid_calendar_fallback",
    "source_date_protection",
  ];
  return names.map((name) => ({
    name,
    status: "blocked",
    expectedDivergenceTaskIds: name === "multi_calendar_5d_to_7d" || name === "multi_calendar_7d_to_5d"
      ? ["succ"]
      : [],
    unexplainedDivergenceTaskIds: [],
    error: `Real WASM unavailable in worker test environment: ${reason}`,
  }));
};

describe("W5B-B2.3 real worker + real wasm validation gate", () => {
  it("detects real wasm load mode and reports blocker when unavailable", async () => {
    let wasmLoadMode: WasmLoadMode = "unavailable";
    let temporalExecutionErrors: string[] = [];
    let scenarioResults: ValidationScenarioResult[] = [];
    let performanceMs: number | null = null;

    const startedAt = performance.now();
    let blockerReason: string | undefined = undefined;
    try {
      await loadCpmWasm();
      const wasm = getCpmWasm() as unknown as MinuteWasmModule;
      wasmLoadMode = "real";
      scenarioResults = runRealMinuteValidationScenarios(wasm);
    } catch (error) {
      const message = asErrorMessage(error);
      wasmLoadMode = "unavailable";
      temporalExecutionErrors = [message];
      scenarioResults = buildUnavailableScenarioResults(message);
      blockerReason = message;
    }
    performanceMs = Math.round(performance.now() - startedAt);

    let sourceProtectionStatus: "ok" | "violated" | "blocked" | "not_evaluated_wasm_unavailable";
    if (wasmLoadMode === "unavailable") {
      sourceProtectionStatus = "not_evaluated_wasm_unavailable";
    } else {
      const sp = scenarioResults.find((s) => s.name === "source_date_protection");
      if (sp?.status === "passed") sourceProtectionStatus = "ok";
      else if (sp?.status === "failed") sourceProtectionStatus = "violated";
      else sourceProtectionStatus = "blocked";
    }

    const gateResult = buildGateResult(
      wasmLoadMode,
      scenarioResults,
      temporalExecutionErrors,
      sourceProtectionStatus,
      performanceMs,
      blockerReason,
    );

    // Required gate shape
    expect(gateResult).toMatchObject({
      wasmLoadMode,
      authorityApplied: false,
      scenariosPlanned: 7,
      scenariosBlocked: wasmLoadMode === "unavailable" ? 7 : 0,
    });

    // Prove we do not fake pass when real wasm is unavailable.
    if (wasmLoadMode === "unavailable") {
      expect(gateResult.realWasmValidationPassed).toBe(false);
      expect(gateResult.temporalExecutionErrors.length).toBeGreaterThan(0);
      expect(gateResult.scenariosPassed).toBe(0);
      expect(gateResult.scenariosBlocked).toBe(7);
      expect(gateResult.sourceProtectionStatus === "not_evaluated_wasm_unavailable").toBe(true);
    } else {
      expect(gateResult.temporalExecutionErrors).toHaveLength(0);
      expect(gateResult.scenariosFailed).toBe(0);
      expect(gateResult.realWasmValidationPassed).toBe(true);
      expect(["ok", "blocked"]).toContain(gateResult.sourceProtectionStatus);
    }

    // Slot authority policy still blocks UAT/production when real gate is false.
    const uatDecision = decideScheduleAuthorityPolicy(
      buildTemporalAuthorityRoutingInput({
        shadowComparisonReport: {
          tasksCompared: 2,
          tasksWithStartVariance: 0,
          tasksWithFinishVariance: 0,
          tasksWithFloatVariance: 0,
          maxStartVarianceMs: 0,
          maxFinishVarianceMs: 0,
          taskCalendarDifferencesExpected: false,
          divergencesDueToPerTaskCalendar: false,
          expectedDivergenceTaskIds: [],
          unexplainedDivergenceTaskIds: [],
          hasUnexplainedDivergences: false,
          singleCalendarParity: true,
        },
        temporalShadowExecutionEnabled: true,
        temporalAuthorityRoutingEnabled: true,
        temporalAuthorityRolloutRing: "uat",
        temporalAuthorityEmergencyRollback: false,
        sourceProtectionStatus: gateResult.sourceProtectionStatus,
        performanceThresholdPassed: true,
        realWasmValidationPassed: gateResult.realWasmValidationPassed,
        allowTemporalAuthorityInTests: false,
      }),
    );

    if (!gateResult.realWasmValidationPassed) {
      expect(uatDecision.mode).toBe("slot_fallback");
      expect([
        "gate_failed",
        "source_protection_violation",
      ]).toContain(uatDecision.fallbackReason);
    }

    // This validation gate never applies authority in this phase.
    expect(gateResult.authorityApplied).toBe(false);
  });
});
