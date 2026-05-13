import type { CalendarId, TimeInterval } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compileCalendar } from "../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../src/calendarTypes.js";
import {
    addWorkingMinutes,
    countWorkingMinutesBetween,
    daySlotToProjectInstant,
    getWorkingDayDefinition,
    isWorkingInstant,
    snapForwardToWorkingTime,
    type ProjectInstant,
} from "../src/workingTimeEngine.js";

// ─── Helpers ────────────────────────────────────────────────────────

const iv = (startMinute: number, endMinute: number): TimeInterval => ({
  startMinute,
  endMinute,
});

const inst = (date: string, minuteOfDay: number): ProjectInstant => ({
  date,
  minuteOfDay,
});

/** Standard Mon–Fri 8h calendar, compiled. */
const STD = compileCalendar(STANDARD_CALENDAR);

/** Calendar with a Christmas exception (non-working) and Christmas Eve half-day. */
const WITH_EXCEPTIONS = compileCalendar({
  id: "exc-cal" as CalendarId,
  name: "With Exceptions",
  weeklyPattern: {
    1: [iv(480, 720), iv(780, 1020)],
    2: [iv(480, 720), iv(780, 1020)],
    3: [iv(480, 720), iv(780, 1020)],
    4: [iv(480, 720), iv(780, 1020)],
    5: [iv(480, 720), iv(780, 1020)],
  },
  exceptions: [
    { date: "2025-12-25", workIntervals: [], name: "Christmas" },
    { date: "2025-12-24", workIntervals: [iv(480, 720)], name: "Christmas Eve" },
  ],
});

/** Calendar with only Monday working, for edge case tests. */
const MONDAY_ONLY = compileCalendar({
  id: "mon-only" as CalendarId,
  name: "Monday Only",
  weeklyPattern: {
    1: [iv(480, 720), iv(780, 1020)],
  },
  exceptions: [],
});

/** Calendar with no working days at all. */
const EMPTY_CAL = compileCalendar({
  id: "empty" as CalendarId,
  name: "No Work",
  weeklyPattern: {},
  exceptions: [],
});

// ─── getWorkingDayDefinition ────────────────────────────────────────

describe("getWorkingDayDefinition", () => {
  it("returns working day with intervals for a standard weekday", () => {
    // 2025-01-06 is a Monday
    const def = getWorkingDayDefinition(STD, "2025-01-06");
    expect(def.isWorking).toBe(true);
    expect(def.intervals).toEqual([iv(480, 720), iv(780, 1020)]);
  });

  it("returns non-working for a Saturday", () => {
    // 2025-01-04 is a Saturday
    const def = getWorkingDayDefinition(STD, "2025-01-04");
    expect(def.isWorking).toBe(false);
    expect(def.intervals).toEqual([]);
  });

  it("returns non-working for a Sunday", () => {
    // 2025-01-05 is a Sunday
    const def = getWorkingDayDefinition(STD, "2025-01-05");
    expect(def.isWorking).toBe(false);
    expect(def.intervals).toEqual([]);
  });

  it("exception overrides weekly pattern to non-working", () => {
    // 2025-12-25 is Thursday — normally working, but Christmas exception
    const def = getWorkingDayDefinition(WITH_EXCEPTIONS, "2025-12-25");
    expect(def.isWorking).toBe(false);
    expect(def.intervals).toEqual([]);
  });

  it("exception overrides weekly pattern to special working day", () => {
    // 2025-12-24 is Wednesday — Christmas Eve half-day
    const def = getWorkingDayDefinition(WITH_EXCEPTIONS, "2025-12-24");
    expect(def.isWorking).toBe(true);
    expect(def.intervals).toEqual([iv(480, 720)]);
  });

  it("returns weekly pattern for date without exception", () => {
    // 2025-12-22 is Monday — no exception
    const def = getWorkingDayDefinition(WITH_EXCEPTIONS, "2025-12-22");
    expect(def.isWorking).toBe(true);
    expect(def.intervals).toEqual([iv(480, 720), iv(780, 1020)]);
  });

  it("handles empty weekly pattern (all non-working)", () => {
    const def = getWorkingDayDefinition(EMPTY_CAL, "2025-01-06");
    expect(def.isWorking).toBe(false);
    expect(def.intervals).toEqual([]);
  });

  it("returns consistent results for the same date", () => {
    const a = getWorkingDayDefinition(STD, "2025-01-06");
    const b = getWorkingDayDefinition(STD, "2025-01-06");
    expect(a).toEqual(b);
  });
});

// ─── isWorkingInstant ───────────────────────────────────────────────

describe("isWorkingInstant", () => {
  it("returns true inside a working interval", () => {
    // Monday 10:00 (600 min) — inside [480, 720)
    expect(isWorkingInstant(STD, inst("2025-01-06", 600))).toBe(true);
  });

  it("returns true at interval start (inclusive)", () => {
    // Monday 08:00 (480 min) — start of first interval
    expect(isWorkingInstant(STD, inst("2025-01-06", 480))).toBe(true);
  });

  it("returns false at interval end (exclusive)", () => {
    // Monday 12:00 (720 min) — end of first interval
    expect(isWorkingInstant(STD, inst("2025-01-06", 720))).toBe(false);
  });

  it("returns true inside second interval (split shift)", () => {
    // Monday 14:00 (840 min) — inside [780, 1020)
    expect(isWorkingInstant(STD, inst("2025-01-06", 840))).toBe(true);
  });

  it("returns false during lunch break between intervals", () => {
    // Monday 12:30 (750 min) — between 720 and 780
    expect(isWorkingInstant(STD, inst("2025-01-06", 750))).toBe(false);
  });

  it("returns false before first interval", () => {
    // Monday 07:00 (420 min) — before 480
    expect(isWorkingInstant(STD, inst("2025-01-06", 420))).toBe(false);
  });

  it("returns false after last interval", () => {
    // Monday 18:00 (1080 min) — after 1020
    expect(isWorkingInstant(STD, inst("2025-01-06", 1080))).toBe(false);
  });

  it("returns false on a non-working day (Saturday)", () => {
    expect(isWorkingInstant(STD, inst("2025-01-04", 600))).toBe(false);
  });

  it("returns false on exception non-working day", () => {
    // Christmas — normally working Thursday, but exception
    expect(isWorkingInstant(WITH_EXCEPTIONS, inst("2025-12-25", 600))).toBe(false);
  });

  it("returns true on exception special working day within interval", () => {
    // Christmas Eve — half-day [480, 720)
    expect(isWorkingInstant(WITH_EXCEPTIONS, inst("2025-12-24", 600))).toBe(true);
  });

  it("returns false on exception special working day outside interval", () => {
    // Christmas Eve afternoon — outside [480, 720)
    expect(isWorkingInstant(WITH_EXCEPTIONS, inst("2025-12-24", 840))).toBe(false);
  });

  it("returns false at midnight on working day", () => {
    expect(isWorkingInstant(STD, inst("2025-01-06", 0))).toBe(false);
  });
});

// ─── snapForwardToWorkingTime ───────────────────────────────────────

describe("snapForwardToWorkingTime", () => {
  it("returns same instant when already inside working interval", () => {
    // Monday 10:00 — inside [480, 720)
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 600));
    expect(result).toEqual(inst("2025-01-06", 600));
  });

  it("returns interval start when already at interval start", () => {
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 480));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("snaps to first interval start when before first interval", () => {
    // Monday 07:00 → snap to 08:00
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 420));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("snaps to next interval when between split shifts", () => {
    // Monday 12:30 (750 min) → snap to 13:00 (780 min)
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 750));
    expect(result).toEqual(inst("2025-01-06", 780));
  });

  it("snaps to next interval when at exact end of first interval", () => {
    // Monday 12:00 (720 min, exclusive end) → snap to 13:00 (780)
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 720));
    expect(result).toEqual(inst("2025-01-06", 780));
  });

  it("snaps to next working day when after last interval", () => {
    // Monday 18:00 → next working day is Tuesday 08:00
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 1080));
    expect(result).toEqual(inst("2025-01-07", 480));
  });

  it("snaps across weekend", () => {
    // Friday 18:00 (after work) → next Monday 08:00
    // 2025-01-03 is Friday
    const result = snapForwardToWorkingTime(STD, inst("2025-01-03", 1080));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("snaps from Saturday to Monday", () => {
    // Saturday at noon → Monday 08:00
    const result = snapForwardToWorkingTime(STD, inst("2025-01-04", 720));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("snaps from Sunday to Monday", () => {
    const result = snapForwardToWorkingTime(STD, inst("2025-01-05", 600));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("snaps across holiday exception", () => {
    // 2025-12-25 (Thursday) is Christmas — non-working exception.
    // Wednesday after work → should skip Thursday, land on Friday 08:00.
    // 2025-12-24 is Wednesday (Christmas Eve half-day [480,720]).
    // After 720 on 24th → skip 25th (holiday) → 26th (Friday) 08:00
    const result = snapForwardToWorkingTime(WITH_EXCEPTIONS, inst("2025-12-24", 780));
    expect(result).toEqual(inst("2025-12-26", 480));
  });

  it("snaps to exception half-day interval when within its range", () => {
    // Christmas Eve at 07:00 → snap to 08:00 (exception half-day start)
    const result = snapForwardToWorkingTime(WITH_EXCEPTIONS, inst("2025-12-24", 420));
    expect(result).toEqual(inst("2025-12-24", 480));
  });

  it("snaps from non-working day in monday-only calendar", () => {
    // Tuesday → next Monday
    // 2025-01-07 is Tuesday, next Monday is 2025-01-13
    const result = snapForwardToWorkingTime(MONDAY_ONLY, inst("2025-01-07", 600));
    expect(result).toEqual(inst("2025-01-13", 480));
  });

  it("returns undefined for calendar with no working days", () => {
    const result = snapForwardToWorkingTime(EMPTY_CAL, inst("2025-01-06", 600));
    expect(result).toBeUndefined();
  });

  it("snaps from midnight on working day to first interval", () => {
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 0));
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("returns deterministic result across calls", () => {
    const a = snapForwardToWorkingTime(STD, inst("2025-01-04", 720));
    const b = snapForwardToWorkingTime(STD, inst("2025-01-04", 720));
    expect(a).toEqual(b);
  });

  it("handles snap at end-of-day boundary (1440)", () => {
    // Monday at 1440 (end of day) → Tuesday 08:00
    const result = snapForwardToWorkingTime(STD, inst("2025-01-06", 1440));
    expect(result).toEqual(inst("2025-01-07", 480));
  });
});

// ─── addWorkingMinutes ──────────────────────────────────────────────

describe("addWorkingMinutes", () => {
  it("zero minutes during working time returns same instant", () => {
    // Monday 10:00 — already working
    const result = addWorkingMinutes(STD, inst("2025-01-06", 600), 0);
    expect(result).toEqual(inst("2025-01-06", 600));
  });

  it("zero minutes outside working time snaps forward", () => {
    // Monday 07:00 → snap to 08:00
    const result = addWorkingMinutes(STD, inst("2025-01-06", 420), 0);
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("zero minutes on weekend snaps to Monday", () => {
    // Saturday → Monday 08:00
    const result = addWorkingMinutes(STD, inst("2025-01-04", 600), 0);
    expect(result).toEqual(inst("2025-01-06", 480));
  });

  it("addition fully inside one interval", () => {
    // Monday 08:00 + 60 min = Monday 09:00
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 60);
    expect(result).toEqual(inst("2025-01-06", 540));
  });

  it("addition consuming exactly one interval", () => {
    // Monday 08:00 + 240 min (full first interval) = Monday 12:00
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 240);
    expect(result).toEqual(inst("2025-01-06", 720));
  });

  it("crossing split-shift lunch break", () => {
    // Monday 08:00 + 300 min → first interval: 240 min (480→720), remaining 60
    // → lunch gap skipped → second interval starts at 780, +60 = 840
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 300);
    expect(result).toEqual(inst("2025-01-06", 840));
  });

  it("crossing to next working day", () => {
    // Monday 08:00 + 480 min = full day → Tuesday 08:00
    // First interval: 240, second interval: 240, total 480 consumed.
    // remaining = 0 at end of Tuesday? No:
    // Mon first: 240 (remaining 240), Mon second: 240 (remaining 0) → Mon 17:00 (1020)
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 480);
    expect(result).toEqual(inst("2025-01-06", 1020));
  });

  it("addition spilling to next day", () => {
    // Monday 08:00 + 481 min → full Mon day (480) + 1 min into Tue
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 481);
    expect(result).toEqual(inst("2025-01-07", 481));
  });

  it("crossing weekend (Friday to Monday)", () => {
    // Friday 08:00 + 481 min → full Fri day (480) + 1 min
    // 2025-01-03 is Friday → next working day is Monday 2025-01-06
    const result = addWorkingMinutes(STD, inst("2025-01-03", 480), 481);
    expect(result).toEqual(inst("2025-01-06", 481));
  });

  it("crossing holiday exception", () => {
    // 2025-12-24 (Wed) Christmas Eve has half-day [480,720] = 240 min
    // 2025-12-25 (Thu) Christmas is non-working
    // 2025-12-26 (Fri) is normal
    // Start: Wed 08:00 + 300 min → 240 from Wed + skip Thu + 60 from Fri
    const result = addWorkingMinutes(WITH_EXCEPTIONS, inst("2025-12-24", 480), 300);
    expect(result).toEqual(inst("2025-12-26", 540));
  });

  it("start after last interval advances to next day", () => {
    // Monday 18:00 + 60 min → Tuesday 09:00
    const result = addWorkingMinutes(STD, inst("2025-01-06", 1080), 60);
    expect(result).toEqual(inst("2025-01-07", 540));
  });

  it("start on non-working day", () => {
    // Saturday + 60 min → Monday 08:00 + 60 = Monday 09:00
    const result = addWorkingMinutes(STD, inst("2025-01-04", 600), 60);
    expect(result).toEqual(inst("2025-01-06", 540));
  });

  it("start in lunch break consumes from next interval", () => {
    // Monday 12:30 (750) + 60 min → snap to 13:00 (780) + 60 = 14:00 (840)
    const result = addWorkingMinutes(STD, inst("2025-01-06", 750), 60);
    expect(result).toEqual(inst("2025-01-06", 840));
  });

  it("empty/degenerate calendar returns undefined", () => {
    const result = addWorkingMinutes(EMPTY_CAL, inst("2025-01-06", 600), 60);
    expect(result).toBeUndefined();
  });

  it("deterministic repeated calls", () => {
    const a = addWorkingMinutes(STD, inst("2025-01-06", 480), 300);
    const b = addWorkingMinutes(STD, inst("2025-01-06", 480), 300);
    expect(a).toEqual(b);
  });

  it("large duration spanning multiple weeks", () => {
    // 5 days × 480 min = 2400 min → Mon 08:00 + 2400 = Fri 17:00
    const result = addWorkingMinutes(STD, inst("2025-01-06", 480), 2400);
    expect(result).toEqual(inst("2025-01-10", 1020));
  });

  it("addition starting mid-interval", () => {
    // Monday 10:00 (600) + 60 = Monday 11:00 (660)
    const result = addWorkingMinutes(STD, inst("2025-01-06", 600), 60);
    expect(result).toEqual(inst("2025-01-06", 660));
  });
});

// ─── countWorkingMinutesBetween ─────────────────────────────────────

describe("countWorkingMinutesBetween", () => {
  it("inside one interval", () => {
    // Monday 09:00 to Monday 11:00 = 120 min
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 540), inst("2025-01-06", 660));
    expect(result).toBe(120);
  });

  it("across lunch break (split shift same day)", () => {
    // Monday 11:00 (660) to Monday 14:00 (840)
    // First interval: [660, 720) = 60 min
    // Second interval: [780, 840) = 60 min
    // Total = 120 min (lunch gap excluded)
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 660), inst("2025-01-06", 840));
    expect(result).toBe(120);
  });

  it("across full day (both intervals)", () => {
    // Monday 08:00 to Monday 17:00 = 480 min
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 480), inst("2025-01-06", 1020));
    expect(result).toBe(480);
  });

  it("across next day", () => {
    // Monday 16:00 (960) to Tuesday 09:00 (540)
    // Mon: [960, 1020) = 60 min
    // Tue: [480, 540) = 60 min
    // Total = 120
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 960), inst("2025-01-07", 540));
    expect(result).toBe(120);
  });

  it("across weekend", () => {
    // Friday 16:00 to Monday 09:00
    // 2025-01-03 (Fri): [960, 1020) = 60 min
    // Sat + Sun: 0
    // 2025-01-06 (Mon): [480, 540) = 60 min
    // Total = 120
    const result = countWorkingMinutesBetween(STD, inst("2025-01-03", 960), inst("2025-01-06", 540));
    expect(result).toBe(120);
  });

  it("across holiday exception", () => {
    // 2025-12-24 (Wed) half-day [480,720] to 2025-12-26 (Fri) 09:00
    // Wed: [480, 720) = 240
    // Thu (Christmas): 0
    // Fri: [480, 540) = 60
    // Total = 300
    const result = countWorkingMinutesBetween(WITH_EXCEPTIONS, inst("2025-12-24", 480), inst("2025-12-26", 540));
    expect(result).toBe(300);
  });

  it("start outside working time", () => {
    // Monday 07:00 to Monday 09:00
    // Only [480, 540) is working = 60 min
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 420), inst("2025-01-06", 540));
    expect(result).toBe(60);
  });

  it("end outside working time", () => {
    // Monday 16:00 to Monday 20:00 (1200)
    // Only [960, 1020) = 60 min
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 960), inst("2025-01-06", 1200));
    expect(result).toBe(60);
  });

  it("fully non-working span returns 0", () => {
    // Saturday to Sunday
    const result = countWorkingMinutesBetween(STD, inst("2025-01-04", 0), inst("2025-01-05", 1440));
    expect(result).toBe(0);
  });

  it("end <= start returns 0 (same date)", () => {
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 600), inst("2025-01-06", 540));
    expect(result).toBe(0);
  });

  it("end === start returns 0", () => {
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 600), inst("2025-01-06", 600));
    expect(result).toBe(0);
  });

  it("end date before start date returns 0", () => {
    const result = countWorkingMinutesBetween(STD, inst("2025-01-07", 480), inst("2025-01-06", 1020));
    expect(result).toBe(0);
  });

  it("full working week", () => {
    // Mon 08:00 to Sat 00:00 = 5 × 480 = 2400
    const result = countWorkingMinutesBetween(STD, inst("2025-01-06", 480), inst("2025-01-11", 0));
    expect(result).toBe(2400);
  });

  it("deterministic repeated calls", () => {
    const a = countWorkingMinutesBetween(STD, inst("2025-01-06", 480), inst("2025-01-07", 540));
    const b = countWorkingMinutesBetween(STD, inst("2025-01-06", 480), inst("2025-01-07", 540));
    expect(a).toBe(b);
  });

  it("empty calendar returns 0", () => {
    const result = countWorkingMinutesBetween(EMPTY_CAL, inst("2025-01-06", 480), inst("2025-01-07", 540));
    expect(result).toBe(0);
  });
});

// ─── daySlotToProjectInstant (Step 6b-1) ────────────────────────────

describe("daySlotToProjectInstant", () => {
  const PROJECT_START = "2025-01-06"; // Monday

  // ─── Basic date arithmetic ────────────────────────────────────────

  it("daySlot 0 returns project start date", () => {
    const result = daySlotToProjectInstant(PROJECT_START, 0, STD);
    expect(result.date).toBe("2025-01-06");
  });

  it("daySlot 1 returns next calendar day", () => {
    const result = daySlotToProjectInstant(PROJECT_START, 1, STD);
    expect(result.date).toBe("2025-01-07");
  });

  it("daySlot 7 returns one week later", () => {
    const result = daySlotToProjectInstant(PROJECT_START, 7, STD);
    expect(result.date).toBe("2025-01-13");
  });

  it("daySlot 30 returns correct date", () => {
    const result = daySlotToProjectInstant(PROJECT_START, 30, STD);
    expect(result.date).toBe("2025-02-05");
  });

  // ─── Working day anchoring ────────────────────────────────────────

  it("working day (Monday) anchors at first interval start", () => {
    // 2025-01-06 Monday: first interval starts at 480 (08:00)
    const result = daySlotToProjectInstant(PROJECT_START, 0, STD);
    expect(result.minuteOfDay).toBe(480);
  });

  it("working day (Friday) anchors at first interval start", () => {
    // 2025-01-10 Friday = daySlot 4
    const result = daySlotToProjectInstant(PROJECT_START, 4, STD);
    expect(result.date).toBe("2025-01-10");
    expect(result.minuteOfDay).toBe(480);
  });

  it("non-working day (Saturday) anchors at minute 0", () => {
    // 2025-01-11 Saturday = daySlot 5
    const result = daySlotToProjectInstant(PROJECT_START, 5, STD);
    expect(result.date).toBe("2025-01-11");
    expect(result.minuteOfDay).toBe(0);
  });

  it("non-working day (Sunday) anchors at minute 0", () => {
    // 2025-01-12 Sunday = daySlot 6
    const result = daySlotToProjectInstant(PROJECT_START, 6, STD);
    expect(result.date).toBe("2025-01-12");
    expect(result.minuteOfDay).toBe(0);
  });

  // ─── Exception handling ───────────────────────────────────────────

  it("exception non-working day anchors at minute 0", () => {
    // Christmas 2025 = Thursday = daySlot from 2025-01-06:
    // Jan: 25 days remaining + Feb: 28 + Mar: 31 + ... = 353 days
    // Use WITH_EXCEPTIONS calendar, project start near Christmas
    const result = daySlotToProjectInstant("2025-12-25", 0, WITH_EXCEPTIONS);
    expect(result.date).toBe("2025-12-25");
    expect(result.minuteOfDay).toBe(0); // Christmas = non-working exception
  });

  it("exception half-day anchors at first exception interval start", () => {
    // Christmas Eve = 2025-12-24, exception half-day: [480, 720]
    const result = daySlotToProjectInstant("2025-12-24", 0, WITH_EXCEPTIONS);
    expect(result.date).toBe("2025-12-24");
    expect(result.minuteOfDay).toBe(480);
  });

  // ─── Compatibility with current uniform calendar ──────────────────

  it("STANDARD_CALENDAR: all weekdays produce consistent minuteOfDay=480", () => {
    // Mon-Fri of the first week (daySlots 0-4)
    for (let slot = 0; slot < 5; slot++) {
      const result = daySlotToProjectInstant(PROJECT_START, slot, STD);
      expect(result.minuteOfDay).toBe(480);
    }
  });

  it("STANDARD_CALENDAR week pattern repeats correctly", () => {
    // Second week: Mon=7, Tue=8, Wed=9, Thu=10, Fri=11, Sat=12, Sun=13
    for (let slot = 7; slot < 12; slot++) {
      const result = daySlotToProjectInstant(PROJECT_START, slot, STD);
      expect(result.minuteOfDay).toBe(480); // working day
    }
    expect(daySlotToProjectInstant(PROJECT_START, 12, STD).minuteOfDay).toBe(0); // Saturday
    expect(daySlotToProjectInstant(PROJECT_START, 13, STD).minuteOfDay).toBe(0); // Sunday
  });

  // ─── Monday-only calendar ─────────────────────────────────────────

  it("Monday-only calendar: Monday anchors at first interval, other days at 0", () => {
    // daySlot 0 = Monday (working), 1 = Tue (non-working), ...
    const mon = daySlotToProjectInstant(PROJECT_START, 0, MONDAY_ONLY);
    expect(mon.minuteOfDay).toBe(480);

    for (let slot = 1; slot < 7; slot++) {
      const result = daySlotToProjectInstant(PROJECT_START, slot, MONDAY_ONLY);
      expect(result.minuteOfDay).toBe(0);
    }
  });

  // ─── Empty calendar ───────────────────────────────────────────────

  it("empty calendar: all days anchor at minute 0", () => {
    const result = daySlotToProjectInstant(PROJECT_START, 0, EMPTY_CAL);
    expect(result.minuteOfDay).toBe(0);
  });

  // ─── Composability with WorkingTimeEngine ─────────────────────────

  it("result is a valid ProjectInstant for snapForwardToWorkingTime", () => {
    // Saturday daySlot → snap forward should reach Monday
    const saturdayInstant = daySlotToProjectInstant(PROJECT_START, 5, STD);
    expect(saturdayInstant.date).toBe("2025-01-11");
    expect(saturdayInstant.minuteOfDay).toBe(0);

    const snapped = snapForwardToWorkingTime(STD, saturdayInstant);
    expect(snapped).toBeDefined();
    expect(snapped!.date).toBe("2025-01-13"); // Monday
    expect(snapped!.minuteOfDay).toBe(480);
  });

  it("working day result passes through snapForwardToWorkingTime unchanged", () => {
    const mondayInstant = daySlotToProjectInstant(PROJECT_START, 0, STD);
    const snapped = snapForwardToWorkingTime(STD, mondayInstant);
    expect(snapped).toEqual(mondayInstant);
  });

  it("result feeds into countWorkingMinutesBetween for calendar-aware duration", () => {
    // daySlot 0 (Mon) to daySlot 4 (Fri) — both working days
    const start = daySlotToProjectInstant(PROJECT_START, 0, STD);
    const end = daySlotToProjectInstant(PROJECT_START, 4, STD);
    // Mon 08:00 to Fri 08:00 = 4 full working days = 4 × 480 = 1920
    const minutes = countWorkingMinutesBetween(STD, start, end);
    expect(minutes).toBe(1920);
  });
});
