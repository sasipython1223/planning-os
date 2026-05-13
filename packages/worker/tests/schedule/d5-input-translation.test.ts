/**
 * Phase D5 — Input translation seam unit tests.
 *
 * Tests the following D5 modules:
 *   - SlotCoordinateTranslator (WorkMinutes → day-slots, constraint snapping)
 *   - TemporalCoordinateTranslator (WorkMinutes → number, identity passthrough)
 *   - buildScheduleRequest with translator (coordinator-agnostic)
 *   - buildTemporalRequest with translator (coordinator-agnostic)
 *
 * These tests do NOT depend on WASM or real scheduling. They isolate D5
 * input coordinate translation and verify behavioural equivalence with
 * the pre-D5 inline conversion logic.
 */

import type { CalendarId, ConstraintType, Dependency, DependencyType, Task, TimeInterval, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compileCalendar } from "../../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../../src/calendarTypes.js";
import type { InputTranslationContext } from "../../src/schedule/IEngineCoordinateTranslator.js";
import { SlotCoordinateTranslator } from "../../src/schedule/SlotCoordinateTranslator.js";
import { TemporalCoordinateTranslator } from "../../src/schedule/TemporalCoordinateTranslator.js";
import { buildScheduleRequest } from "../../src/schedule/buildScheduleRequest.js";

// ─── Constants ──────────────────────────────────────────────────────

const MPD = MINUTES_PER_DAY as number; // 480

const baseContext: InputTranslationContext = {
  projectStartDate: "2025-01-06",
  minutesPerDay: MPD,
  nwdSet: new Set<number>(),
};

const iv = (startMinute: number, endMinute: number): TimeInterval => ({
  startMinute,
  endMinute,
});

// ─── Helpers ────────────────────────────────────────────────────────

const makeTask = (overrides: Partial<Task> & { id: string }): Task => ({
  name: overrides.id,
  durationWorkMinutes: (MPD as WorkMinutes),
  siblingOrder: "a",
  ...overrides,
});

const makeDep = (
  predId: string,
  succId: string,
  overrides: Partial<Dependency> = {},
): Dependency => ({
  id: `${predId}-${succId}`,
  predId,
  succId,
  type: "FS" as DependencyType,
  lagWorkMinutes: 0 as WorkMinutes,
  ...overrides,
});

// ─── SlotCoordinateTranslator ───────────────────────────────────────

describe("SlotCoordinateTranslator", () => {
  const translator = new SlotCoordinateTranslator(baseContext);

  describe("convertDuration", () => {
    it("converts 0 WorkMinutes to 0 day-slots", () => {
      expect(translator.convertDuration(0 as WorkMinutes)).toBe(0);
    });

    it("converts 480 WorkMinutes (1 day) to 1 day-slot", () => {
      expect(translator.convertDuration(480 as WorkMinutes)).toBe(1);
    });

    it("converts 960 WorkMinutes (2 days) to 2 day-slots", () => {
      expect(translator.convertDuration(960 as WorkMinutes)).toBe(2);
    });

    it("rounds to nearest day-slot", () => {
      // 720 / 480 = 1.5 → rounds to 2
      expect(translator.convertDuration(720 as WorkMinutes)).toBe(2);
      // 239 / 480 = 0.498 → rounds to 0
      expect(translator.convertDuration(239 as WorkMinutes)).toBe(0);
      // 241 / 480 = 0.502 → rounds to 1
      expect(translator.convertDuration(241 as WorkMinutes)).toBe(1);
    });
  });

  describe("convertLag", () => {
    it("converts lag WorkMinutes to day-slots", () => {
      expect(translator.convertLag(480 as WorkMinutes)).toBe(1);
      expect(translator.convertLag(0 as WorkMinutes)).toBe(0);
      expect(translator.convertLag(1440 as WorkMinutes)).toBe(3);
    });
  });

  describe("convertMinEarlyStart", () => {
    it("converts minEarlyStart WorkMinutes to day-slots", () => {
      expect(translator.convertMinEarlyStart(480 as WorkMinutes)).toBe(1);
      expect(translator.convertMinEarlyStart(0 as WorkMinutes)).toBe(0);
    });
  });

  describe("convertConstraintDate", () => {
    it("converts without snapping when no NWD collision", () => {
      expect(translator.convertConstraintDate(480 as WorkMinutes, "SNET")).toBe(1);
      expect(translator.convertConstraintDate(960 as WorkMinutes, "FNLT")).toBe(2);
    });

    it("converts without snapping when no constraintType", () => {
      expect(translator.convertConstraintDate(480 as WorkMinutes)).toBe(1);
      expect(translator.convertConstraintDate(480 as WorkMinutes, undefined)).toBe(1);
    });

    it("snaps SNET forward when landing on NWD", () => {
      // Day-slot 2 is a non-working day; next working day is 3
      const nwdSet = new Set([2]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      // 960 WM = day-slot 2 → snap forward to 3
      expect(t.convertConstraintDate(960 as WorkMinutes, "SNET")).toBe(3);
    });

    it("snaps MSO forward when landing on NWD", () => {
      const nwdSet = new Set([2]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      expect(t.convertConstraintDate(960 as WorkMinutes, "MSO")).toBe(3);
    });

    it("snaps FNLT backward when landing on NWD", () => {
      const nwdSet = new Set([2]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      // 960 WM = day-slot 2 → snap backward to 1
      expect(t.convertConstraintDate(960 as WorkMinutes, "FNLT")).toBe(1);
    });

    it("snaps MFO backward when landing on NWD", () => {
      const nwdSet = new Set([2]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      expect(t.convertConstraintDate(960 as WorkMinutes, "MFO")).toBe(1);
    });

    it("snaps forward past consecutive NWDs", () => {
      const nwdSet = new Set([2, 3, 4]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      // Day-slot 2 → skip 2,3,4 → land on 5
      expect(t.convertConstraintDate(960 as WorkMinutes, "SNET")).toBe(5);
    });

    it("snaps backward past consecutive NWDs", () => {
      const nwdSet = new Set([2, 3, 4]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      // Day-slot 4 → skip 4,3,2 → land on 1
      expect(t.convertConstraintDate(1920 as WorkMinutes, "FNLT")).toBe(1);
    });

    it("does not snap when day-slot is not a NWD", () => {
      const nwdSet = new Set([5, 6]);
      const ctx: InputTranslationContext = { ...baseContext, nwdSet };
      const t = new SlotCoordinateTranslator(ctx);
      // Day-slot 2 not in NWD set → no snap
      expect(t.convertConstraintDate(960 as WorkMinutes, "SNET")).toBe(2);
    });

    it("preserves STANDARD_CALENDAR parity when projectCalendar is provided", () => {
      const standardCtx: InputTranslationContext = {
        ...baseContext,
        nwdSet: new Set([5, 6]),
        projectCalendar: compileCalendar(STANDARD_CALENDAR),
      };
      const t = new SlotCoordinateTranslator(standardCtx);
      expect(t.convertConstraintDate((5 * MPD) as WorkMinutes, "SNET")).toBe(7);
      expect(t.convertConstraintDate((6 * MPD) as WorkMinutes, "FNLT")).toBe(4);
    });

    it("uses compiled project-calendar holidays even when nwdSet does not include them", () => {
      const holidayCtx: InputTranslationContext = {
        projectStartDate: "2025-01-06",
        minutesPerDay: 360,
        nwdSet: new Set<number>(),
        projectCalendar: compileCalendar({
          id: "holiday-cal" as CalendarId,
          name: "Holiday Calendar",
          weeklyPattern: {
            1: [iv(480, 660), iv(720, 900)],
            2: [iv(480, 660), iv(720, 900)],
            3: [iv(480, 660), iv(720, 900)],
            4: [iv(480, 660), iv(720, 900)],
            5: [iv(480, 660), iv(720, 900)],
          },
          exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Project Holiday" }],
        }),
      };
      const t = new SlotCoordinateTranslator(holidayCtx);
      expect(t.convertConstraintDate(0 as WorkMinutes, "SNET")).toBe(1);
    });

    it("falls back safely to scalar conversion when project calendar is missing", () => {
      const fallbackCtx: InputTranslationContext = {
        projectStartDate: "2025-01-06",
        minutesPerDay: 360,
        nwdSet: new Set([8]),
      };
      const t = new SlotCoordinateTranslator(fallbackCtx);
      expect(t.convertConstraintDate((8 * 360) as WorkMinutes, "SNET")).toBe(9);
    });
  });
});

// ─── TemporalCoordinateTranslator ───────────────────────────────────

describe("TemporalCoordinateTranslator", () => {
  const translator = new TemporalCoordinateTranslator(baseContext);

  it("convertDuration is identity passthrough", () => {
    expect(translator.convertDuration(480 as WorkMinutes)).toBe(480);
    expect(translator.convertDuration(0 as WorkMinutes)).toBe(0);
    expect(translator.convertDuration(960 as WorkMinutes)).toBe(960);
  });

  it("convertConstraintDate is identity passthrough", () => {
    expect(translator.convertConstraintDate(480 as WorkMinutes, "SNET")).toBe(480);
    expect(translator.convertConstraintDate(960 as WorkMinutes, "FNLT")).toBe(960);
    expect(translator.convertConstraintDate(480 as WorkMinutes)).toBe(480);
  });

  it("convertLag is identity passthrough", () => {
    expect(translator.convertLag(480 as WorkMinutes)).toBe(480);
    expect(translator.convertLag(0 as WorkMinutes)).toBe(0);
  });

  it("convertMinEarlyStart is identity passthrough", () => {
    expect(translator.convertMinEarlyStart(480 as WorkMinutes)).toBe(480);
    expect(translator.convertMinEarlyStart(0 as WorkMinutes)).toBe(0);
  });

  it("does not snap constraints on NWDs (unlike slot translator)", () => {
    const nwdCtx: InputTranslationContext = {
      ...baseContext,
      nwdSet: new Set([2]),
    };
    const t = new TemporalCoordinateTranslator(nwdCtx);
    // Temporal translator ignores NWD set — passes 960 through as-is
    expect(t.convertConstraintDate(960 as WorkMinutes, "SNET")).toBe(960);
  });
});

// ─── Translator parity ─────────────────────────────────────────────

describe("Translator parity", () => {
  it("slot translator matches pre-D5 inline toDaySlots formula", () => {
    const translator = new SlotCoordinateTranslator(baseContext);
    const testValues = [0, 240, 480, 720, 960, 1440, 2400] as WorkMinutes[];
    for (const wm of testValues) {
      const expected = Math.round((wm as number) / MPD);
      expect(translator.convertDuration(wm)).toBe(expected);
      expect(translator.convertLag(wm)).toBe(expected);
      expect(translator.convertMinEarlyStart(wm)).toBe(expected);
    }
  });

  it("temporal translator returns original WorkMinutes value for all methods", () => {
    const translator = new TemporalCoordinateTranslator(baseContext);
    const testValues = [0, 123, 480, 960, 9999] as WorkMinutes[];
    for (const wm of testValues) {
      expect(translator.convertDuration(wm)).toBe(wm as number);
      expect(translator.convertConstraintDate(wm, "SNET")).toBe(wm as number);
      expect(translator.convertLag(wm)).toBe(wm as number);
      expect(translator.convertMinEarlyStart(wm)).toBe(wm as number);
    }
  });
});

// ─── buildScheduleRequest integration ───────────────────────────────

describe("buildScheduleRequest with translator", () => {
  it("uses translator for duration conversion", () => {
    const translator = new SlotCoordinateTranslator(baseContext);
    const tasks = [makeTask({ id: "t1", durationWorkMinutes: 960 as WorkMinutes })];
    const req = buildScheduleRequest(tasks, [], [], translator);

    expect(req.tasks[0].durationWorkMinutes).toBe(2); // 960 / 480 = 2 day-slots
  });

  it("uses translator for lag conversion", () => {
    const translator = new SlotCoordinateTranslator(baseContext);
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
    const deps = [makeDep("t1", "t2", { lagWorkMinutes: 480 as WorkMinutes })];
    const req = buildScheduleRequest(tasks, deps, [], translator);

    expect(req.dependencies[0].lagWorkMinutes).toBe(1); // 480 / 480 = 1 day-slot
  });

  it("uses translator for constraint date conversion with snapping", () => {
    // Day-slot 2 is NWD. SNET constraint should snap forward to 3.
    const nwdCtx: InputTranslationContext = {
      ...baseContext,
      nwdSet: new Set([2]),
    };
    const translator = new SlotCoordinateTranslator(nwdCtx);
    const tasks = [
      makeTask({
        id: "t1",
        constraintType: "SNET" as ConstraintType,
        constraintDateMinutes: 960 as WorkMinutes,
      }),
    ];
    const req = buildScheduleRequest(tasks, [], [2], translator);

    expect(req.tasks[0].constraintDateMinutes).toBe(3); // snapped forward
  });

  it("task assignedCalendarId remains inactive on the live request path", () => {
    const translator = new SlotCoordinateTranslator({
      projectStartDate: "2025-01-06",
      minutesPerDay: 360,
      nwdSet: new Set<number>(),
      projectCalendar: compileCalendar({
        id: "project-holiday" as CalendarId,
        name: "Project Holiday",
        weeklyPattern: {
          1: [iv(480, 660), iv(720, 900)],
          2: [iv(480, 660), iv(720, 900)],
          3: [iv(480, 660), iv(720, 900)],
          4: [iv(480, 660), iv(720, 900)],
          5: [iv(480, 660), iv(720, 900)],
        },
        exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Project Holiday" }],
      }),
    });
    const tasks = [
      makeTask({
        id: "t1",
        assignedCalendarId: "task-specific" as CalendarId,
        constraintType: "SNET" as ConstraintType,
        constraintDateMinutes: 0 as WorkMinutes,
      }),
    ];

    const req = buildScheduleRequest(tasks, [], [], translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(1);
  });

  it("produces valid request structure", () => {
    const translator = new SlotCoordinateTranslator(baseContext);
    const tasks = [
      makeTask({ id: "p" }),
      makeTask({ id: "c", parentId: "p", durationWorkMinutes: 1440 as WorkMinutes }),
    ];
    const deps = [makeDep("p", "c")];
    const req = buildScheduleRequest(tasks, deps, [5, 6], translator);

    expect(req.tasks).toHaveLength(2);
    expect(req.dependencies).toHaveLength(1);
    expect(req.nonWorkingDays).toEqual([5, 6]);
    // Parent should be marked as summary
    const parent = req.tasks.find(t => t.id === "p")!;
    expect(parent.isSummary).toBe(true);
    // Child duration: 1440/480 = 3
    const child = req.tasks.find(t => t.id === "c")!;
    expect(child.durationWorkMinutes).toBe(3);
  });
});
