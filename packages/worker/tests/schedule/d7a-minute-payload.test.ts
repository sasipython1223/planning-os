import type { CalendarConfig, CalendarId, Dependency, Task, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { compileCalendar } from "../../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../../src/calendarTypes.js";
import type { SchedulingStateSnapshot } from "../../src/schedule/ISchedulingEngine.js";
import { MinuteEngineAdapter } from "../../src/schedule/MinuteEngineAdapter.js";
import {
    assertFitsI32,
    assertFitsU32,
    assertI64SafeInteger,
    toMinuteConstraintDate,
    toMinuteDuration,
    toMinuteLag,
    toMinuteMinEarlyStart,
} from "../../src/schedule/minutePayloadPrimitives.js";
import {
    _resetMinutePayloadShadowFlag,
    isMinutePayloadShadowEnabled,
    setMinutePayloadShadowEnabled,
} from "../../src/schedule/minutePayloadShadowFlag.js";
import { SlotCoordinateTranslator } from "../../src/schedule/SlotCoordinateTranslator.js";
import { d, wm } from "../helpers.js";

const projectCalendar: CalendarConfig = {
  id: "project" as CalendarId,
  name: "Project",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

const temporalAdapter = {
  minutesPerDay: MINUTES_PER_DAY,
  toDaySlots: (workMinutes: WorkMinutes) => Math.round((workMinutes as number) / (MINUTES_PER_DAY as number)) as WorkMinutes,
  fromDaySlots: (daySlots: WorkMinutes) => ((daySlots as number) * (MINUTES_PER_DAY as number)) as WorkMinutes,
};

function makeSnapshot(overrides: Partial<SchedulingStateSnapshot> = {}): SchedulingStateSnapshot {
  const tasks: Task[] = overrides.tasks ? [...overrides.tasks] : [];
  const dependencies: Dependency[] = overrides.dependencies ? [...overrides.dependencies] : [];
  return {
    tasks,
    dependencies,
    projectStartDate: overrides.projectStartDate ?? "2025-01-06",
    projectCalendar: overrides.projectCalendar ?? projectCalendar,
    findTask: overrides.findTask ?? ((id: string) => tasks.find((t) => t.id === id)),
    calendars: overrides.calendars ?? { project: projectCalendar },
    nonWorkingDays: overrides.nonWorkingDays ?? [5, 6],
    nwdSet: overrides.nwdSet ?? new Set([5, 6]),
    schedulingMode: overrides.schedulingMode ?? "legacy",
    assumptionSet: overrides.assumptionSet ?? {
      id: "as-1",
      version: 1,
      name: "Scenario",
      zones: [],
      quantities: [],
      resources: [],
      productivityRules: [],
    },
    authoredActivities: overrides.authoredActivities ?? [],
    compiledProjectCalendar: overrides.compiledProjectCalendar,
    temporalAdapter: overrides.temporalAdapter ?? temporalAdapter,
  };
}

describe("D7a minute payload primitives", () => {
  it("keeps STANDARD_CALENDAR minute translation parity for scalar fields", () => {
    expect(toMinuteDuration(d(2))).toBe(d(2));
    expect(toMinuteLag(wm(-60))).toBe(-60);
    expect(toMinuteMinEarlyStart(wm(120))).toBe(120);
  });

  it("applies project holiday effect for start-oriented constraint minute translation", () => {
    const holidayCal = compileCalendar({
      ...STANDARD_CALENDAR,
      exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Holiday" }],
    });

    const minute = toMinuteConstraintDate({
      projectStartDate: "2025-01-06",
      constraintDateMinutes: d(0),
      constraintType: "SNET",
      projectCalendar: holidayCal,
    });

    // Day 1 at 08:00 => 1440 + 480
    expect(minute).toBe(1920);
  });

  it("maps finish-oriented constraint to end of working day on STANDARD_CALENDAR", () => {
    const minute = toMinuteConstraintDate({
      projectStartDate: "2025-01-06",
      constraintDateMinutes: d(0),
      constraintType: "FNLT",
      projectCalendar: compileCalendar(STANDARD_CALENDAR),
    });

    // Day 0 at 17:00 => 1020
    expect(minute).toBe(1020);
  });

  it("falls back to scalar NWD snapping when compiled project calendar is missing", () => {
    const minute = toMinuteConstraintDate({
      projectStartDate: "2025-01-06",
      constraintDateMinutes: d(2),
      constraintType: "SNET",
      nwdSet: new Set([2]),
      fallbackMinutesPerDay: MINUTES_PER_DAY,
    });

    // Day 2 snapped to day 3 => 3 * 1440
    expect(minute).toBe(4320);
  });

  it("enforces integer-width safety guards", () => {
    expect(assertI64SafeInteger(60, "x")).toBe(60);
    expect(assertFitsI32(-60, "y")).toBe(-60);
    expect(assertFitsU32(60, "z")).toBe(60);

    expect(() => assertI64SafeInteger(Number.MAX_SAFE_INTEGER + 1, "x")).toThrow();
    expect(() => assertFitsI32(3_000_000_000, "y")).toThrow();
    expect(() => assertFitsU32(-1, "z")).toThrow();
  });
});

describe("D7a MinuteEngineAdapter", () => {
  it("builds a minute payload request in shadow mode shape", () => {
    const adapter = new MinuteEngineAdapter();
    const holidayCal = compileCalendar({
      ...STANDARD_CALENDAR,
      exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Holiday" }],
    });

    const snapshot = makeSnapshot({
      compiledProjectCalendar: holidayCal,
      tasks: [
        {
          id: "t1",
          name: "T1",
          durationWorkMinutes: d(3),
          minEarlyStartMinutes: wm(120),
          siblingOrder: "a",
          constraintType: "SNET",
          constraintDateMinutes: d(0),
          assignedCalendarId: "task-cal" as CalendarId,
        },
        {
          id: "t2",
          name: "T2",
          durationWorkMinutes: d(1),
          minEarlyStartMinutes: wm(0),
          siblingOrder: "b",
        },
        {
          id: "t3",
          name: "T3",
          durationWorkMinutes: d(1),
          minEarlyStartMinutes: wm(0),
          siblingOrder: "c",
          assignedCalendarId: "invalid-cal" as CalendarId,
        },
      ],
      dependencies: [
        {
          id: "d1",
          predId: "t1",
          succId: "t1",
          type: "FS",
          lagWorkMinutes: wm(-30),
        },
      ],
      nonWorkingDays: [5, 6],
      nwdSet: new Set([5, 6]),
    });

    const request = adapter.prepareRequest(snapshot);
    expect(request.abiVersion).toBe(2);
    expect(request.projectCalendarId).toBe("project");
    expect(request.dataDateMinute).toBe(0);
    expect(request.calendars.some((c) => c.id === "project")).toBe(true);
    expect(request.tasks[0].durationMinutes).toBe(d(3));
    expect(request.tasks[0].minEarlyStartMinutes).toBe(120);
    expect(request.tasks[0].constraintDateMinute).toBe(1920);
    expect(request.tasks[0].calendarId).toBe("task-cal");
    expect(request.tasks[1].calendarId).toBe("project");
    expect(request.tasks[2].calendarId).toBe("invalid-cal");
    expect(request.dependencies[0].lagMinutes).toBe(-30);
    expect(request.dependencies[0].lagCalendarId).toBe("project");

    // calendars[] carries project + available definitions for temporal shadow.
    expect(request.calendars.map((c) => c.id)).toContain("project");
  });

  it("keeps production slot translator behavior unchanged", () => {
    const translator = new SlotCoordinateTranslator({
      projectStartDate: "2025-01-06",
      minutesPerDay: MINUTES_PER_DAY,
      nwdSet: new Set([2]),
    });

    expect(translator.convertDuration(d(2))).toBe(2);
    expect(translator.convertLag(d(1))).toBe(1);
    expect(translator.convertMinEarlyStart(d(1))).toBe(1);
  });
});

describe("D7a minute payload shadow flag", () => {
  beforeEach(() => {
    _resetMinutePayloadShadowFlag();
  });

  it("defaults to disabled and can be toggled", () => {
    expect(isMinutePayloadShadowEnabled()).toBe(false);
    setMinutePayloadShadowEnabled(true);
    expect(isMinutePayloadShadowEnabled()).toBe(true);
    setMinutePayloadShadowEnabled(false);
    expect(isMinutePayloadShadowEnabled()).toBe(false);
  });
});
