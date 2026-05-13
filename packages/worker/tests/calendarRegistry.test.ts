import type { BaseCalendarDefinition, CalendarId, TimeInterval } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
    CalendarRegistry,
    compileCalendar,
    normalizeIntervals
} from "../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../src/calendarTypes.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Shorthand for a TimeInterval. */
const iv = (startMinute: number, endMinute: number): TimeInterval => ({
  startMinute,
  endMinute,
});

/** Build a minimal Mon–Fri calendar with the given intervals per working day. */
function weekdayCal(
  id: string,
  intervals: readonly TimeInterval[],
  exceptions: BaseCalendarDefinition["exceptions"] = [],
): BaseCalendarDefinition {
  return {
    id: id as CalendarId,
    name: id,
    weeklyPattern: {
      1: intervals,
      2: intervals,
      3: intervals,
      4: intervals,
      5: intervals,
    },
    exceptions,
  };
}

// ─── normalizeIntervals ─────────────────────────────────────────────

describe("normalizeIntervals", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeIntervals([])).toEqual([]);
  });

  it("passes through a single valid interval unchanged", () => {
    expect(normalizeIntervals([iv(480, 720)])).toEqual([iv(480, 720)]);
  });

  it("sorts intervals by startMinute", () => {
    const result = normalizeIntervals([iv(780, 1020), iv(480, 720)]);
    expect(result).toEqual([iv(480, 720), iv(780, 1020)]);
  });

  it("merges overlapping intervals", () => {
    const result = normalizeIntervals([iv(480, 750), iv(700, 1020)]);
    expect(result).toEqual([iv(480, 1020)]);
  });

  it("merges adjacent intervals (touching at boundary)", () => {
    const result = normalizeIntervals([iv(480, 720), iv(720, 1020)]);
    expect(result).toEqual([iv(480, 1020)]);
  });

  it("merges multiple overlapping intervals into one", () => {
    const result = normalizeIntervals([
      iv(480, 600),
      iv(550, 700),
      iv(680, 900),
    ]);
    expect(result).toEqual([iv(480, 900)]);
  });

  it("keeps non-overlapping intervals separate", () => {
    const result = normalizeIntervals([iv(480, 720), iv(780, 1020)]);
    expect(result).toEqual([iv(480, 720), iv(780, 1020)]);
  });

  it("filters out intervals where startMinute >= endMinute", () => {
    const result = normalizeIntervals([
      iv(500, 500), // zero-width
      iv(600, 400), // inverted
      iv(480, 720), // valid
    ]);
    expect(result).toEqual([iv(480, 720)]);
  });

  it("filters out intervals with startMinute < 0", () => {
    const result = normalizeIntervals([iv(-60, 120), iv(480, 720)]);
    expect(result).toEqual([iv(480, 720)]);
  });

  it("filters out intervals with endMinute > 1440", () => {
    const result = normalizeIntervals([iv(1400, 1500), iv(480, 720)]);
    expect(result).toEqual([iv(480, 720)]);
  });

  it("returns empty array when all intervals are invalid", () => {
    expect(normalizeIntervals([iv(720, 480), iv(-10, -5)])).toEqual([]);
  });

  it("handles a single interval spanning the full day", () => {
    expect(normalizeIntervals([iv(0, 1440)])).toEqual([iv(0, 1440)]);
  });
});

// ─── compileCalendar ────────────────────────────────────────────────

describe("compileCalendar", () => {
  it("compiles STANDARD_CALENDAR correctly", () => {
    const compiled = compileCalendar(STANDARD_CALENDAR);

    expect(compiled.id).toBe(DEFAULT_CALENDAR_ID);
    expect(compiled.name).toBe(STANDARD_CALENDAR.name);

    // Mon–Fri each have 2 intervals, Sat/Sun are empty
    expect(compiled.weeklyPattern[0]).toEqual([]); // Sunday
    expect(compiled.weeklyPattern[6]).toEqual([]); // Saturday

    for (let dow = 1; dow <= 5; dow++) {
      expect(compiled.weeklyPattern[dow]).toEqual([
        iv(480, 720),
        iv(780, 1020),
      ]);
    }

    // dailyMinutes: Sun=0, Mon–Fri=480, Sat=0
    expect(compiled.dailyMinutes[0]).toBe(0);
    for (let dow = 1; dow <= 5; dow++) {
      expect(compiled.dailyMinutes[dow]).toBe(480);
    }
    expect(compiled.dailyMinutes[6]).toBe(0);

    // weeklyMinutes: 5 × 480 = 2400
    expect(compiled.weeklyMinutes).toBe(2400);

    // No exceptions
    expect(compiled.exceptionsByDate.size).toBe(0);
  });

  it("handles calendar with exceptions", () => {
    const cal = weekdayCal("custom" as string, [iv(480, 720)], [
      { date: "2025-12-25", workIntervals: [], name: "Christmas" },
      { date: "2025-12-24", workIntervals: [iv(480, 600)], name: "Christmas Eve" },
    ]);

    const compiled = compileCalendar(cal);

    expect(compiled.exceptionsByDate.size).toBe(2);
    expect(compiled.exceptionsByDate.get("2025-12-25")).toEqual([]);
    expect(compiled.exceptionsByDate.get("2025-12-24")).toEqual([iv(480, 600)]);
  });

  it("normalizes overlapping intervals in weekly pattern", () => {
    const cal: BaseCalendarDefinition = {
      id: "overlap" as CalendarId,
      name: "Overlap Test",
      weeklyPattern: {
        1: [iv(480, 750), iv(700, 1020)], // overlapping
      },
      exceptions: [],
    };

    const compiled = compileCalendar(cal);
    expect(compiled.weeklyPattern[1]).toEqual([iv(480, 1020)]);
    expect(compiled.dailyMinutes[1]).toBe(540); // 1020 - 480
  });

  it("handles empty weekly pattern (all non-working)", () => {
    const cal: BaseCalendarDefinition = {
      id: "empty" as CalendarId,
      name: "No Work",
      weeklyPattern: {},
      exceptions: [],
    };

    const compiled = compileCalendar(cal);

    for (let dow = 0; dow < 7; dow++) {
      expect(compiled.weeklyPattern[dow]).toEqual([]);
      expect(compiled.dailyMinutes[dow]).toBe(0);
    }
    expect(compiled.weeklyMinutes).toBe(0);
  });

  it("normalizes exception intervals", () => {
    const cal = weekdayCal("exc-norm", [iv(480, 720)], [
      { date: "2025-01-01", workIntervals: [iv(600, 800), iv(480, 650)] },
    ]);

    const compiled = compileCalendar(cal);
    // [480,650] + [600,800] should merge to [480,800]
    expect(compiled.exceptionsByDate.get("2025-01-01")).toEqual([iv(480, 800)]);
  });

  it("last exception wins for duplicate dates", () => {
    const cal = weekdayCal("dup-exc", [iv(480, 720)], [
      { date: "2025-01-01", workIntervals: [iv(480, 720)] },
      { date: "2025-01-01", workIntervals: [] },
    ]);

    const compiled = compileCalendar(cal);
    // Last one wins — empty intervals
    expect(compiled.exceptionsByDate.get("2025-01-01")).toEqual([]);
  });
});

// ─── CalendarRegistry ───────────────────────────────────────────────

describe("CalendarRegistry", () => {
  let registry: CalendarRegistry;

  beforeEach(() => {
    registry = new CalendarRegistry();
  });

  describe("before rebuild", () => {
    it("has size 0", () => {
      expect(registry.size).toBe(0);
    });

    it("returns undefined for any get", () => {
      expect(registry.get(DEFAULT_CALENDAR_ID)).toBeUndefined();
    });

    it("has() returns false", () => {
      expect(registry.has(DEFAULT_CALENDAR_ID)).toBe(false);
    });
  });

  describe("rebuild with empty definitions", () => {
    beforeEach(() => {
      registry.rebuild({});
    });

    it("still has STANDARD_CALENDAR", () => {
      expect(registry.has(DEFAULT_CALENDAR_ID)).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("getDefault() returns standard calendar", () => {
      const def = registry.getDefault();
      expect(def.id).toBe(DEFAULT_CALENDAR_ID);
      expect(def.weeklyMinutes).toBe(2400);
    });
  });

  describe("rebuild with custom calendars", () => {
    const nightShift = weekdayCal("night-shift", [iv(1200, 1440)]);

    beforeEach(() => {
      registry.rebuild({
        "night-shift": nightShift,
      });
    });

    it("contains both standard and custom calendar", () => {
      expect(registry.size).toBe(2);
      expect(registry.has(DEFAULT_CALENDAR_ID)).toBe(true);
      expect(registry.has("night-shift" as CalendarId)).toBe(true);
    });

    it("get() returns the custom compiled calendar", () => {
      const compiled = registry.get("night-shift" as CalendarId)!;
      expect(compiled.id).toBe("night-shift");
      expect(compiled.weeklyMinutes).toBe(5 * 240); // 5 working days × 240 min
    });

    it("get() returns undefined for unknown ID", () => {
      expect(registry.get("nonexistent" as CalendarId)).toBeUndefined();
    });

    it("ids() returns all calendar IDs", () => {
      const ids = registry.ids();
      expect(ids).toContain(DEFAULT_CALENDAR_ID as string);
      expect(ids).toContain("night-shift");
    });
  });

  describe("rebuild replaces previous cache", () => {
    it("clears old calendars on rebuild", () => {
      const cal1 = weekdayCal("cal-1", [iv(480, 720)]);
      const cal2 = weekdayCal("cal-2", [iv(480, 600)]);

      registry.rebuild({ "cal-1": cal1 });
      expect(registry.has("cal-1" as CalendarId)).toBe(true);

      registry.rebuild({ "cal-2": cal2 });
      expect(registry.has("cal-1" as CalendarId)).toBe(false);
      expect(registry.has("cal-2" as CalendarId)).toBe(true);
      // Standard still present
      expect(registry.has(DEFAULT_CALENDAR_ID)).toBe(true);
    });
  });

  describe("STANDARD_CALENDAR cannot be overridden to empty", () => {
    it("user-supplied default calendar overrides the fallback", () => {
      // If user supplies a definition with DEFAULT_CALENDAR_ID, it should be used
      const customDefault: BaseCalendarDefinition = {
        id: DEFAULT_CALENDAR_ID,
        name: "Custom Default",
        weeklyPattern: { 1: [iv(480, 600)] }, // Mon only, 2 hours
        exceptions: [],
      };

      registry.rebuild({ [DEFAULT_CALENDAR_ID as string]: customDefault });
      const compiled = registry.getDefault();
      expect(compiled.name).toBe("Custom Default");
      expect(compiled.weeklyMinutes).toBe(120); // Mon only
    });
  });

  describe("getDefault() after rebuild", () => {
    it("returns a fully compiled calendar", () => {
      registry.rebuild({});
      const def = registry.getDefault();
      expect(def.id).toBe(DEFAULT_CALENDAR_ID);
      expect(def.weeklyPattern).toHaveLength(7);
      expect(def.exceptionsByDate).toBeInstanceOf(Map);
      expect(def.dailyMinutes).toHaveLength(7);
      expect(typeof def.weeklyMinutes).toBe("number");
    });
  });
});
