/**
 * Phases D3–D4 — Shadow engine dual-run unit tests.
 *
 * Tests the following D3/D4 modules:
 *   - ScheduleComparator (field-by-field diff on NormalizedScheduleFacts)
 *   - ShadowEngineFacade (dual-run, flag gating, async shadow)
 *   - shadowEngineFlag (toggle behavior)
 *
 * These tests do NOT depend on WASM or real scheduling — all engines
 * are stubbed/mocked to isolate D3 comparison logic.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineResult, ISchedulingEngine, SchedulingStateSnapshot } from "../../src/schedule/ISchedulingEngine.js";
import type { NormalizedScheduleFacts, ScheduleFact } from "../../src/schedule/NormalizedScheduleFact.js";
import { compareSchedules } from "../../src/schedule/ScheduleComparator.js";
import { ShadowEngineFacade } from "../../src/schedule/ShadowEngineFacade.js";
import {
    _resetShadowEngineFlag,
    isShadowEngineEnabled,
    setShadowEngineEnabled,
} from "../../src/schedule/shadowEngineFlag.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a ScheduleFact for testing. */
function ntr(
  taskId: string,
  overrides: Partial<{
    earlyStartDate: number;
    earlyFinishDate: number;
    lateStartDate: number;
    lateFinishDate: number;
    totalFloatMinutes: number;
    freeFloatMinutes: number;
    isCritical: boolean;
  }> = {},
): ScheduleFact {
  return {
    taskId,
    earlyStartDate: overrides.earlyStartDate ?? 0,
    earlyFinishDate: overrides.earlyFinishDate ?? 480,
    lateStartDate: overrides.lateStartDate ?? 0,
    lateFinishDate: overrides.lateFinishDate ?? 480,
    totalFloatMinutes: overrides.totalFloatMinutes ?? 0,
    freeFloatMinutes: overrides.freeFloatMinutes ?? 0,
    isCritical: overrides.isCritical ?? true,
  };
}

/** Build a NormalizedScheduleFacts from task results. */
function buildNormalized(
  ...tasks: ScheduleFact[]
): NormalizedScheduleFacts {
  const map: Record<string, ScheduleFact> = {};
  for (const t of tasks) map[t.taskId] = t;
  return map;
}

/** Stub engine that returns a canned EngineResult. */
function stubEngine(result: EngineResult): ISchedulingEngine {
  return { execute: () => result };
}

/** Minimal SchedulingStateSnapshot — irrelevant fields stubbed. */
const DUMMY_SNAPSHOT = {} as SchedulingStateSnapshot;

// ─── shadowEngineFlag ───────────────────────────────────────────────

describe("shadowEngineFlag", () => {
  afterEach(() => _resetShadowEngineFlag());

  it("defaults to disabled", () => {
    expect(isShadowEngineEnabled()).toBe(false);
  });

  it("can be enabled and disabled", () => {
    setShadowEngineEnabled(true);
    expect(isShadowEngineEnabled()).toBe(true);

    setShadowEngineEnabled(false);
    expect(isShadowEngineEnabled()).toBe(false);
  });

  it("_resetShadowEngineFlag resets to disabled", () => {
    setShadowEngineEnabled(true);
    _resetShadowEngineFlag();
    expect(isShadowEngineEnabled()).toBe(false);
  });
});

// ─── ScheduleComparator ─────────────────────────────────────────────

describe("ScheduleComparator", () => {
  it("returns empty result when both maps are identical", () => {
    const a = buildNormalized(ntr("T1"), ntr("T2"));
    const b = buildNormalized(ntr("T1"), ntr("T2"));
    const result = compareSchedules(a, b);

    expect(result.mismatches).toEqual([]);
    expect(result.missingInTemporal).toEqual([]);
    expect(result.missingInSlot).toEqual([]);
  });

  it("detects date field mismatches", () => {
    const slot = buildNormalized(ntr("T1", { earlyStartDate: 0, earlyFinishDate: 480 }));
    const temporal = buildNormalized(ntr("T1", { earlyStartDate: 0, earlyFinishDate: 960 }));
    const result = compareSchedules(slot, temporal);

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toEqual({
      taskId: "T1",
      field: "earlyFinishDate",
      slotValue: 480,
      temporalValue: 960,
    });
  });

  it("detects isCritical mismatch", () => {
    const slot = buildNormalized(ntr("T1", { isCritical: true }));
    const temporal = buildNormalized(ntr("T1", { isCritical: false }));
    const result = compareSchedules(slot, temporal);

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toEqual({
      taskId: "T1",
      field: "isCritical",
      slotValue: true,
      temporalValue: false,
    });
  });

  it("reports tasks missing in temporal", () => {
    const slot = buildNormalized(ntr("T1"), ntr("T2"));
    const temporal = buildNormalized(ntr("T1"));
    const result = compareSchedules(slot, temporal);

    expect(result.missingInTemporal).toEqual(["T2"]);
    expect(result.missingInSlot).toEqual([]);
  });

  it("reports tasks missing in slot", () => {
    const slot = buildNormalized(ntr("T1"));
    const temporal = buildNormalized(ntr("T1"), ntr("T3"));
    const result = compareSchedules(slot, temporal);

    expect(result.missingInSlot).toEqual(["T3"]);
    expect(result.missingInTemporal).toEqual([]);
  });

  it("ignores freeFloatMinutes differences when totalFloat is non-zero", () => {
    const slot = buildNormalized(
      ntr("T1", { totalFloatMinutes: 480, freeFloatMinutes: 0 }),
    );
    const temporal = buildNormalized(
      ntr("T1", { totalFloatMinutes: 480, freeFloatMinutes: 960 }),
    );
    const result = compareSchedules(slot, temporal);

    expect(result.mismatches).toEqual([]);
  });

  it("detects freeFloatMinutes mismatch when both totals are zero", () => {
    const slot = buildNormalized(
      ntr("T1", { totalFloatMinutes: 0, freeFloatMinutes: 0 }),
    );
    const temporal = buildNormalized(
      ntr("T1", { totalFloatMinutes: 0, freeFloatMinutes: 120 }),
    );
    const result = compareSchedules(slot, temporal);

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toEqual({
      taskId: "T1",
      field: "freeFloatMinutes",
      slotValue: 0,
      temporalValue: 120,
    });
  });

  it("detects multiple mismatches across multiple tasks", () => {
    const slot = buildNormalized(
      ntr("T1", { earlyStartDate: 0, totalFloatMinutes: 480 }),
      ntr("T2", { lateFinishDate: 1440 }),
    );
    const temporal = buildNormalized(
      ntr("T1", { earlyStartDate: 60, totalFloatMinutes: 420 }),
      ntr("T2", { lateFinishDate: 1500 }),
    );
    const result = compareSchedules(slot, temporal);

    expect(result.mismatches).toHaveLength(3);
    const fields = result.mismatches.map((m) => `${m.taskId}.${m.field}`);
    expect(fields).toContain("T1.earlyStartDate");
    expect(fields).toContain("T1.totalFloatMinutes");
    expect(fields).toContain("T2.lateFinishDate");
  });

  it("handles empty maps gracefully", () => {
    const result = compareSchedules({}, {});
    expect(result.mismatches).toEqual([]);
    expect(result.missingInTemporal).toEqual([]);
    expect(result.missingInSlot).toEqual([]);
    expect(result.readinessReport.tasksCompared).toBe(0);
  });

  it("reports parity-ready single-calendar comparison metrics", () => {
    const slot = buildNormalized(
      ntr("T1", { earlyStartDate: 0, earlyFinishDate: 480, totalFloatMinutes: 0 }),
      ntr("T2", { earlyStartDate: 480, earlyFinishDate: 960, totalFloatMinutes: 0 }),
    );
    const temporal = buildNormalized(
      ntr("T1", { earlyStartDate: 0, earlyFinishDate: 480, totalFloatMinutes: 0 }),
      ntr("T2", { earlyStartDate: 480, earlyFinishDate: 960, totalFloatMinutes: 0 }),
    );

    const result = compareSchedules(slot, temporal);

    expect(result.readinessReport.tasksCompared).toBe(2);
    expect(result.readinessReport.tasksWithStartVariance).toBe(0);
    expect(result.readinessReport.tasksWithFinishVariance).toBe(0);
    expect(result.readinessReport.maxStartVarianceMs).toBe(0);
    expect(result.readinessReport.maxFinishVarianceMs).toBe(0);
    expect(result.readinessReport.singleCalendarParity).toBe(true);
    expect(result.readinessReport.hasUnexplainedDivergences).toBe(false);
  });

  it("classifies multi-calendar shadow divergences as expected when mapped to task calendar differences", () => {
    const slot = buildNormalized(
      ntr("T1", { earlyStartDate: 0, earlyFinishDate: 480, totalFloatMinutes: 0 }),
      ntr("T2", { earlyStartDate: 480, earlyFinishDate: 960, totalFloatMinutes: 0 }),
    );
    const temporal = buildNormalized(
      ntr("T1", { earlyStartDate: 240, earlyFinishDate: 720, totalFloatMinutes: 480 }),
      ntr("T2", { earlyStartDate: 480, earlyFinishDate: 960, totalFloatMinutes: 0 }),
    );

    const result = compareSchedules(slot, temporal, {
      expectedTaskCalendarDivergenceTaskIds: new Set(["T1"]),
    });

    expect(result.readinessReport.tasksCompared).toBe(2);
    expect(result.readinessReport.tasksWithStartVariance).toBe(1);
    expect(result.readinessReport.tasksWithFinishVariance).toBe(1);
    expect(result.readinessReport.tasksWithFloatVariance).toBe(1);
    expect(result.readinessReport.maxStartVarianceMs).toBe(240);
    expect(result.readinessReport.maxFinishVarianceMs).toBe(240);
    expect(result.readinessReport.taskCalendarDifferencesExpected).toBe(true);
    expect(result.readinessReport.divergencesDueToPerTaskCalendar).toBe(true);
    expect(result.readinessReport.expectedDivergenceTaskIds).toEqual(["T1"]);
    expect(result.readinessReport.unexplainedDivergenceTaskIds).toEqual([]);
  });
});

// ─── ShadowEngineFacade ─────────────────────────────────────────────

describe("ShadowEngineFacade", () => {
  afterEach(() => _resetShadowEngineFlag());

  it("returns primary result when shadow is disabled", () => {
    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    };
    const shadowResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1", { earlyFinishDate: 999 })),
    };

    const facade = new ShadowEngineFacade(
      stubEngine(primaryResult),
      stubEngine(shadowResult),
    );

    const result = facade.execute(DUMMY_SNAPSHOT);
    expect(result).toBe(primaryResult);
  });

  it("does not invoke shadow engine when flag is disabled", () => {
    const shadowExecute = vi.fn().mockReturnValue({
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: null,
    });
    const shadowEngine: ISchedulingEngine = { execute: shadowExecute };

    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    };

    const facade = new ShadowEngineFacade(stubEngine(primaryResult), shadowEngine);
    facade.execute(DUMMY_SNAPSHOT);

    // Shadow should NOT be called synchronously when flag off
    expect(shadowExecute).not.toHaveBeenCalled();
  });

  it("invokes shadow engine asynchronously when flag is enabled", async () => {
    setShadowEngineEnabled(true);

    const shadowExecute = vi.fn().mockReturnValue({
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    });
    const shadowEngine: ISchedulingEngine = { execute: shadowExecute };

    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    };

    const facade = new ShadowEngineFacade(stubEngine(primaryResult), shadowEngine);
    const result = facade.execute(DUMMY_SNAPSHOT);

    // Primary result is returned immediately
    expect(result).toBe(primaryResult);

    // Shadow has NOT been called yet (queued via setTimeout)
    expect(shadowExecute).not.toHaveBeenCalled();

    // Flush the setTimeout(0) queue
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now shadow should have been invoked
    expect(shadowExecute).toHaveBeenCalledOnce();
  });

  it("still returns primary result even when shadow is enabled", async () => {
    setShadowEngineEnabled(true);

    const primaryNormalized = buildNormalized(ntr("T1", { earlyFinishDate: 480 }));
    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: primaryNormalized,
    };
    const shadowResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1", { earlyFinishDate: 960 })),
    };

    const facade = new ShadowEngineFacade(
      stubEngine(primaryResult),
      stubEngine(shadowResult),
    );
    const result = facade.execute(DUMMY_SNAPSHOT);

    // Always returns primary
    expect(result).toBe(primaryResult);
  });

  it("logs agreement when engines agree", async () => {
    setShadowEngineEnabled(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const normalized = buildNormalized(ntr("T1"));
    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized,
    };
    const shadowResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    };

    const facade = new ShadowEngineFacade(
      stubEngine(primaryResult),
      stubEngine(shadowResult),
    );
    facade.execute(DUMMY_SNAPSHOT);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Slot and temporal engines agree"),
    );

    logSpy.mockRestore();
  });

  it("logs mismatches when engines disagree", async () => {
    setShadowEngineEnabled(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1", { earlyFinishDate: 480 })),
    };
    const shadowResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1", { earlyFinishDate: 960 })),
    };

    const facade = new ShadowEngineFacade(
      stubEngine(primaryResult),
      stubEngine(shadowResult),
    );
    facade.execute(DUMMY_SNAPSHOT);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("1 field mismatch"),
    );

    warnSpy.mockRestore();
  });

  it("swallows shadow engine errors without affecting primary", async () => {
    setShadowEngineEnabled(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const primaryResult: EngineResult = {
      rawResult: { scheduleVersion: 1, results: [] },
      normalized: buildNormalized(ntr("T1")),
    };
    const throwingEngine: ISchedulingEngine = {
      execute: () => { throw new Error("temporal kaboom"); },
    };

    const facade = new ShadowEngineFacade(
      stubEngine(primaryResult),
      throwingEngine,
    );

    // Should not throw
    const result = facade.execute(DUMMY_SNAPSHOT);
    expect(result).toBe(primaryResult);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Temporal engine failed"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
