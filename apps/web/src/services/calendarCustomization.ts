import type { PlannerCalendar, PlannerCalendarException } from "@planner/protocol";

export type WorkweekPreset = "5d-8h" | "6d-8h" | "7d-8h" | "4d-10h";

const FULL_DAY_PERIODS_8H = [
  { startMinute: 8 * 60, endMinute: 12 * 60 },
  { startMinute: 13 * 60, endMinute: 17 * 60 },
] as const;

const FULL_DAY_PERIODS_10H = [
  { startMinute: 7 * 60, endMinute: 12 * 60 },
  { startMinute: 13 * 60, endMinute: 18 * 60 },
] as const;

export function applyWorkweekPreset(calendar: PlannerCalendar, preset: WorkweekPreset): PlannerCalendar {
  const next = { ...calendar };

  if (preset === "5d-8h") {
    next.hoursPerDay = 8;
    next.hoursPerWeek = 40;
    next.weeklyHours = { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 };
    next.weeklyWorkPeriods = {
      0: [],
      1: [...FULL_DAY_PERIODS_8H],
      2: [...FULL_DAY_PERIODS_8H],
      3: [...FULL_DAY_PERIODS_8H],
      4: [...FULL_DAY_PERIODS_8H],
      5: [...FULL_DAY_PERIODS_8H],
      6: [],
    };
  }

  if (preset === "6d-8h") {
    next.hoursPerDay = 8;
    next.hoursPerWeek = 48;
    next.weeklyHours = { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 };
    next.weeklyWorkPeriods = {
      0: [],
      1: [...FULL_DAY_PERIODS_8H],
      2: [...FULL_DAY_PERIODS_8H],
      3: [...FULL_DAY_PERIODS_8H],
      4: [...FULL_DAY_PERIODS_8H],
      5: [...FULL_DAY_PERIODS_8H],
      6: [...FULL_DAY_PERIODS_8H],
    };
  }

  if (preset === "7d-8h") {
    next.hoursPerDay = 8;
    next.hoursPerWeek = 56;
    next.weeklyHours = { 0: 8, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 };
    next.weeklyWorkPeriods = {
      0: [...FULL_DAY_PERIODS_8H],
      1: [...FULL_DAY_PERIODS_8H],
      2: [...FULL_DAY_PERIODS_8H],
      3: [...FULL_DAY_PERIODS_8H],
      4: [...FULL_DAY_PERIODS_8H],
      5: [...FULL_DAY_PERIODS_8H],
      6: [...FULL_DAY_PERIODS_8H],
    };
  }

  if (preset === "4d-10h") {
    next.hoursPerDay = 10;
    next.hoursPerWeek = 40;
    next.weeklyHours = { 0: 0, 1: 10, 2: 10, 3: 10, 4: 10, 5: 0, 6: 0 };
    next.weeklyWorkPeriods = {
      0: [],
      1: [...FULL_DAY_PERIODS_10H],
      2: [...FULL_DAY_PERIODS_10H],
      3: [...FULL_DAY_PERIODS_10H],
      4: [...FULL_DAY_PERIODS_10H],
      5: [],
      6: [],
    };
  }

  return {
    ...next,
    hoursPerMonth: next.hoursPerMonth || next.hoursPerWeek * 4,
    hoursPerYear: next.hoursPerYear || next.hoursPerWeek * 52,
    updatedAt: new Date().toISOString(),
  };
}

export function updateHoursPerPeriod(
  calendar: PlannerCalendar,
  updates: Partial<Pick<PlannerCalendar, "hoursPerDay" | "hoursPerWeek" | "hoursPerMonth" | "hoursPerYear">>,
): PlannerCalendar {
  return {
    ...calendar,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

export function addCalendarException(
  calendar: PlannerCalendar,
  exception: PlannerCalendarException,
): PlannerCalendar {
  return {
    ...calendar,
    exceptions: [...calendar.exceptions, exception],
    updatedAt: new Date().toISOString(),
  };
}
