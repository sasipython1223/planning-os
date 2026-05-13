import type { CalendarId, PlannerCalendar } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { addCalendarException, applyWorkweekPreset, updateHoursPerPeriod } from "./calendarCustomization";

const baseCalendar: PlannerCalendar = {
  calendarId: "default" as CalendarId,
  name: "Default",
  type: "Project",
  source: "planner-editable",
  isDefaultProjectCalendar: true,
  hoursPerDay: 8,
  hoursPerWeek: 40,
  hoursPerMonth: 160,
  hoursPerYear: 2080,
  weeklyHours: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
  weeklyWorkPeriods: {
    0: [],
    1: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
    2: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
    3: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
    4: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
    5: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
    6: [],
  },
  exceptions: [],
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

describe("calendarCustomization", () => {
  it("5-day preset creates Mon-Fri 8h and Sat/Sun 0h", () => {
    const next = applyWorkweekPreset(baseCalendar, "5d-8h");
    expect(next.weeklyHours[1]).toBe(8);
    expect(next.weeklyHours[5]).toBe(8);
    expect(next.weeklyHours[0]).toBe(0);
    expect(next.weeklyHours[6]).toBe(0);
  });

  it("6-day preset creates Mon-Sat 8h and Sun 0h", () => {
    const next = applyWorkweekPreset(baseCalendar, "6d-8h");
    expect(next.weeklyHours[1]).toBe(8);
    expect(next.weeklyHours[6]).toBe(8);
    expect(next.weeklyHours[0]).toBe(0);
  });

  it("7-day preset creates Sun-Sat working days", () => {
    const next = applyWorkweekPreset(baseCalendar, "7d-8h");
    expect(next.weeklyHours[0]).toBe(8);
    expect(next.weeklyHours[6]).toBe(8);
  });

  it("hours per day/week/month/year are saved", () => {
    const next = updateHoursPerPeriod(baseCalendar, {
      hoursPerDay: 9,
      hoursPerWeek: 45,
      hoursPerMonth: 180,
      hoursPerYear: 2340,
    });
    expect(next.hoursPerDay).toBe(9);
    expect(next.hoursPerWeek).toBe(45);
    expect(next.hoursPerMonth).toBe(180);
    expect(next.hoursPerYear).toBe(2340);
  });

  it("public holiday/nonwork exception is saved", () => {
    const next = addCalendarException(baseCalendar, {
      date: "2026-12-25",
      type: "non-working",
      workIntervals: [],
      name: "Holiday",
    });
    expect(next.exceptions).toHaveLength(1);
    expect(next.exceptions[0].type).toBe("non-working");
    expect(next.exceptions[0].date).toBe("2026-12-25");
  });
});
