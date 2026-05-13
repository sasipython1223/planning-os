/**
 * Phase D4 — Projection seam unit tests.
 *
 * Tests the following D4 modules:
 *   - parseProjectStartMs (UTC date parsing)
 *   - SlotScheduleTranslator (day-offset → epoch-ms + working-minute floats)
 *   - TemporalScheduleTranslator (absolute-minute → epoch-ms + float passthrough)
 *   - ProjectionAdapter.projectFacts (facts → ScheduleResultMap round-trip)
 *
 * These tests do NOT depend on WASM or real scheduling — raw engine
 * outputs are constructed inline to isolate D4 translation logic.
 */

import type { WorkMinutes } from "@planner/protocol";
import type { ScheduleResponse } from "@planner/protocol/kernel";
import { describe, expect, it } from "vitest";
import type { NormalizedScheduleFacts } from "../../src/schedule/NormalizedScheduleFact.js";
import { MS_PER_DAY } from "../../src/schedule/NormalizedScheduleFact.js";
import { projectFacts } from "../../src/schedule/ProjectionAdapter.js";
import { parseProjectStartMs, SlotScheduleTranslator } from "../../src/schedule/SlotScheduleTranslator.js";
import type { TemporalScheduleResponseBoundary } from "../../src/schedule/TemporalScheduleTranslator.js";
import { TemporalScheduleTranslator } from "../../src/schedule/TemporalScheduleTranslator.js";

// ─── Constants ──────────────────────────────────────────────────────

const PROJECT_START = "2025-01-06";
const PROJECT_START_MS = Date.UTC(2025, 0, 6); // Mon 6 Jan 2025, UTC midnight
const MPD = 480; // minutes per day

// ─── parseProjectStartMs ────────────────────────────────────────────

describe("parseProjectStartMs", () => {
  it("parses YYYY-MM-DD to UTC midnight epoch-ms", () => {
    expect(parseProjectStartMs("2025-01-06")).toBe(Date.UTC(2025, 0, 6));
  });

  it("handles month/day boundaries correctly", () => {
    expect(parseProjectStartMs("2024-12-31")).toBe(Date.UTC(2024, 11, 31));
    expect(parseProjectStartMs("2025-02-28")).toBe(Date.UTC(2025, 1, 28));
  });

  it("returns UTC — no timezone offset", () => {
    const ms = parseProjectStartMs("2025-06-15");
    const d = new Date(ms);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });
});

// ─── SlotScheduleTranslator ─────────────────────────────────────────

describe("SlotScheduleTranslator", () => {
  const translator = new SlotScheduleTranslator();
  const ctx = { projectStartDate: PROJECT_START, minutesPerDay: MPD };

  it("converts day-offset dates to epoch-ms at UTC midnight", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinutes: 0 as WorkMinutes,   // day 0
          earlyFinishMinutes: 3 as WorkMinutes,   // day 3
          lateStartMinutes: 1 as WorkMinutes,     // day 1
          lateFinishMinutes: 4 as WorkMinutes,    // day 4
          totalFloatMinutes: 1 as WorkMinutes,    // 1 day-offset float
          isCritical: false,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    const t1 = facts["T1"];

    expect(t1.earlyStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(t1.earlyFinishDate).toBe(PROJECT_START_MS + 3 * MS_PER_DAY);
    expect(t1.lateStartDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(t1.lateFinishDate).toBe(PROJECT_START_MS + 4 * MS_PER_DAY);
  });

  it("converts float to working minutes (float × minutesPerDay)", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 2 as WorkMinutes,
          lateStartMinutes: 0 as WorkMinutes,
          lateFinishMinutes: 2 as WorkMinutes,
          totalFloatMinutes: 2 as WorkMinutes, // 2 day-offset units
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["T1"].totalFloatMinutes).toBe(2 * MPD); // 960 working minutes
  });

  it("always sets freeFloatMinutes to 0", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 1 as WorkMinutes,
          lateStartMinutes: 0 as WorkMinutes,
          lateFinishMinutes: 1 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["T1"].freeFloatMinutes).toBe(0);
  });

  it("handles multiple tasks", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 1 as WorkMinutes,
          lateStartMinutes: 0 as WorkMinutes,
          lateFinishMinutes: 1 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: true,
        },
        {
          taskId: "B",
          earlyStartMinutes: 1 as WorkMinutes,
          earlyFinishMinutes: 3 as WorkMinutes,
          lateStartMinutes: 1 as WorkMinutes,
          lateFinishMinutes: 3 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(Object.keys(facts)).toHaveLength(2);
    expect(facts["A"].earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(facts["B"].earlyStartDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(facts["B"].earlyFinishDate).toBe(PROJECT_START_MS + 3 * MS_PER_DAY);
  });

  it("returns null when results are missing", () => {
    const response = { scheduleVersion: 1 } as ScheduleResponse;
    expect(translator.translate(response, ctx)).toBeNull();
  });

  it("preserves isCritical flag", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 1 as WorkMinutes,
          lateStartMinutes: 0 as WorkMinutes,
          lateFinishMinutes: 1 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: false,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["T1"].isCritical).toBe(false);
  });
});

// ─── TemporalScheduleTranslator ─────────────────────────────────────

describe("TemporalScheduleTranslator", () => {
  const translator = new TemporalScheduleTranslator();
  const ctx = { projectStartDate: PROJECT_START, minutesPerDay: MPD };

  it("converts absolute-minute starts with floor(min/1440) and finishes with ceil(min/1440)", () => {
    const response: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinute: 0,       // day 0 (0/1440 = 0)
          earlyFinishMinute: 960,    // day 1 for finish (ceil(960/1440) = 1)
          lateStartMinute: 480,      // day 0
          lateFinishMinute: 1440,    // day 1
          totalFloatMinutes: 480,
          freeFloatMinutes: 120,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    const t1 = facts["T1"];

    expect(t1.earlyStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(t1.earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(t1.lateStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(t1.lateFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
  });

  it("passes through float values unchanged (already working minutes)", () => {
    const response: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinute: 0,
          earlyFinishMinute: 480,
          lateStartMinute: 0,
          lateFinishMinute: 480,
          totalFloatMinutes: 960,
          freeFloatMinutes: 240,
          isCritical: false,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["T1"].totalFloatMinutes).toBe(960);
    expect(facts["T1"].freeFloatMinutes).toBe(240);
  });

  it("uses floor for non-integer wall-clock day offsets", () => {
    // 600 minutes / 1440 = 0.416... → floor = 0
    const response: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinute: 600,
          earlyFinishMinute: 1080, // finish uses ceil(1080/1440)=1
          lateStartMinute: 600,
          lateFinishMinute: 1080,
          totalFloatMinutes: 0,
          freeFloatMinutes: 0,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["T1"].earlyStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(facts["T1"].earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
  });

  it("returns null when results are missing", () => {
    const response = { scheduleVersion: 1 } as TemporalScheduleResponseBoundary;
    expect(translator.translate(response, ctx)).toBeNull();
  });

  it("handles multiple tasks", () => {
    const response: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinute: 0,
          earlyFinishMinute: 480,
          lateStartMinute: 0,
          lateFinishMinute: 480,
          totalFloatMinutes: 0,
          freeFloatMinutes: 0,
          isCritical: true,
        },
        {
          taskId: "B",
          earlyStartMinute: 480,
          earlyFinishMinute: 1440,
          lateStartMinute: 480,
          lateFinishMinute: 1440,
          totalFloatMinutes: 0,
          freeFloatMinutes: 0,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(Object.keys(facts)).toHaveLength(2);
    expect(facts["B"].earlyStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(facts["B"].earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
  });

  it("keeps zero-duration milestone finish on the same day", () => {
    const response: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "M1",
          earlyStartMinute: 0,
          earlyFinishMinute: 0,
          lateStartMinute: 0,
          lateFinishMinute: 0,
          totalFloatMinutes: 0,
          freeFloatMinutes: 0,
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(response, ctx)!;
    expect(facts["M1"].earlyStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(facts["M1"].earlyFinishDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(facts["M1"].lateStartDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
    expect(facts["M1"].lateFinishDate).toBe(PROJECT_START_MS + 0 * MS_PER_DAY);
  });
});

// ─── ProjectionAdapter (round-trip) ─────────────────────────────────

describe("ProjectionAdapter.projectFacts", () => {
  it("converts epoch-ms dates back to day-offsets", () => {
    const facts: NormalizedScheduleFacts = {
      T1: {
        taskId: "T1",
        earlyStartDate: PROJECT_START_MS + 0 * MS_PER_DAY,
        earlyFinishDate: PROJECT_START_MS + 3 * MS_PER_DAY,
        lateStartDate: PROJECT_START_MS + 1 * MS_PER_DAY,
        lateFinishDate: PROJECT_START_MS + 4 * MS_PER_DAY,
        totalFloatMinutes: 480,
        freeFloatMinutes: 0,
        isCritical: false,
      },
    };

    const result = projectFacts(facts, PROJECT_START, MPD);
    const t1 = result["T1"];

    expect(t1.earlyStartMinutes).toBe(0);
    expect(t1.earlyFinishMinutes).toBe(3);
    expect(t1.lateStartMinutes).toBe(1);
    expect(t1.lateFinishMinutes).toBe(4);
    expect(t1.totalFloatMinutes).toBe(1); // 480 / 480
    expect(t1.isCritical).toBe(false);
  });

  it("slot translator → projectFacts round-trip matches raw day-offsets", () => {
    const slotTranslator = new SlotScheduleTranslator();
    const ctx = { projectStartDate: PROJECT_START, minutesPerDay: MPD };

    const rawResponse: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "T1",
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 5 as WorkMinutes,
          lateStartMinutes: 2 as WorkMinutes,
          lateFinishMinutes: 7 as WorkMinutes,
          totalFloatMinutes: 2 as WorkMinutes,
          isCritical: true,
        },
        {
          taskId: "T2",
          earlyStartMinutes: 5 as WorkMinutes,
          earlyFinishMinutes: 10 as WorkMinutes,
          lateStartMinutes: 5 as WorkMinutes,
          lateFinishMinutes: 10 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: true,
        },
      ],
    };

    // Translate to facts then project back
    const facts = slotTranslator.translate(rawResponse, ctx)!;
    const resultMap = projectFacts(facts, PROJECT_START, MPD);

    // Day-offset values should survive the round-trip exactly
    for (const r of rawResponse.results) {
      const projected = resultMap[r.taskId];
      expect(projected.earlyStartMinutes).toBe(r.earlyStartMinutes);
      expect(projected.earlyFinishMinutes).toBe(r.earlyFinishMinutes);
      expect(projected.lateStartMinutes).toBe(r.lateStartMinutes);
      expect(projected.lateFinishMinutes).toBe(r.lateFinishMinutes);
      expect(projected.totalFloatMinutes).toBe(r.totalFloatMinutes);
      expect(projected.isCritical).toBe(r.isCritical);
    }
  });

  it("handles empty facts map", () => {
    const result = projectFacts({}, PROJECT_START, MPD);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("converts working-minute floats back to day-offset units", () => {
    const facts: NormalizedScheduleFacts = {
      T1: {
        taskId: "T1",
        earlyStartDate: PROJECT_START_MS,
        earlyFinishDate: PROJECT_START_MS + MS_PER_DAY,
        lateStartDate: PROJECT_START_MS,
        lateFinishDate: PROJECT_START_MS + MS_PER_DAY,
        totalFloatMinutes: 960, // 2 working days
        freeFloatMinutes: 0,
        isCritical: true,
      },
    };

    const result = projectFacts(facts, PROJECT_START, MPD);
    expect(result["T1"].totalFloatMinutes).toBe(2); // 960 / 480
  });
});
