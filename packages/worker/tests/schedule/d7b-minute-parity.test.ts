import type { CalendarConfig, CalendarId, Dependency, Task, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compileCalendar } from "../../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../../src/calendarTypes.js";
import { buildScheduleRequest } from "../../src/schedule/buildScheduleRequest.js";
import type { SchedulingStateSnapshot } from "../../src/schedule/ISchedulingEngine.js";
import { MinuteEngineAdapter } from "../../src/schedule/MinuteEngineAdapter.js";
import { SlotCoordinateTranslator } from "../../src/schedule/SlotCoordinateTranslator.js";
import { createMinuteAnchor, minuteToDate } from "../../src/temporal/minuteAnchor.js";
import { d, wm } from "../helpers.js";

const minuteAdapter = new MinuteEngineAdapter();

const defaultProjectCalendar: CalendarConfig = {
  id: "project" as CalendarId,
  name: "Project",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

function makeTemporalAdapter(minutesPerDay: number) {
  return {
    minutesPerDay: minutesPerDay as WorkMinutes,
    toDaySlots: (workMinutes: WorkMinutes) =>
      Math.round((workMinutes as number) / minutesPerDay) as WorkMinutes,
    fromDaySlots: (daySlots: WorkMinutes) =>
      ((daySlots as number) * minutesPerDay) as WorkMinutes,
  };
}

function makeSnapshot(overrides: Partial<SchedulingStateSnapshot> = {}): SchedulingStateSnapshot {
  const tasks: Task[] = overrides.tasks ? [...overrides.tasks] : [];
  const dependencies: Dependency[] = overrides.dependencies ? [...overrides.dependencies] : [];

  return {
    tasks,
    dependencies,
    projectStartDate: overrides.projectStartDate ?? "2025-01-06",
    projectCalendar: overrides.projectCalendar ?? defaultProjectCalendar,
    findTask: overrides.findTask ?? ((id: string) => tasks.find((task) => task.id === id)),
    calendars: overrides.calendars ?? { project: defaultProjectCalendar },
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
    temporalAdapter: overrides.temporalAdapter ?? makeTemporalAdapter(MINUTES_PER_DAY as number),
  };
}

function buildSlotPayload(snapshot: SchedulingStateSnapshot) {
  return buildScheduleRequest(
    snapshot.tasks,
    snapshot.dependencies,
    snapshot.nonWorkingDays,
    new SlotCoordinateTranslator({
      projectStartDate: snapshot.projectStartDate,
      minutesPerDay: snapshot.temporalAdapter.minutesPerDay as number,
      nwdSet: snapshot.nwdSet,
      projectCalendar: snapshot.compiledProjectCalendar,
    }),
  );
}

function buildMinutePayload(snapshot: SchedulingStateSnapshot) {
  return minuteAdapter.prepareRequest(snapshot);
}

function payloadDate(projectStartDate: string, minuteOffset: number): string {
  return minuteToDate(minuteOffset, createMinuteAnchor(projectStartDate));
}

describe("D7b slot/minute payload parity matrix", () => {
  describe("parity holds under STANDARD_CALENDAR / uniform-day assumptions", () => {
    it("duration, lag, minEarlyStart, and nonWorkingDays stay equivalent after unit scaling", () => {
      const snapshot = makeSnapshot({
        compiledProjectCalendar: compileCalendar(STANDARD_CALENDAR),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: d(2),
            minEarlyStartMinutes: d(1),
            siblingOrder: "a",
          },
          {
            id: "B",
            name: "B",
            durationWorkMinutes: d(1),
            siblingOrder: "b",
          },
        ],
        dependencies: [
          {
            id: "dep-1",
            predId: "A",
            succId: "B",
            type: "FS",
            lagWorkMinutes: d(1),
          },
        ],
      });

      const slot = buildSlotPayload(snapshot);
      const minute = buildMinutePayload(snapshot);

      expect(minute.abiVersion).toBe(2);
      expect(minute.projectCalendarId).toBe("project");
      expect(minute.dataDateMinute).toBe(0);
      expect(minute.calendars.some((c) => c.id === "project")).toBe(true);
      expect(minute.tasks[0].durationMinutes).toBe((slot.tasks[0].durationWorkMinutes as number) * (MINUTES_PER_DAY as number));
      expect(minute.tasks[0].minEarlyStartMinutes).toBe((slot.tasks[0].minEarlyStartMinutes as number) * (MINUTES_PER_DAY as number));
      expect(minute.dependencies[0].lagMinutes).toBe((slot.dependencies[0].lagWorkMinutes as number) * (MINUTES_PER_DAY as number));
      expect(minute.tasks[0].calendarId).toBe("project");
      expect(minute.dependencies[0].lagCalendarId).toBe("project");
    });

    it("start-oriented constraints keep the same snapped working date as the slot payload", () => {
      const snapshot = makeSnapshot({
        compiledProjectCalendar: compileCalendar(STANDARD_CALENDAR),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: d(1),
            siblingOrder: "a",
            constraintType: "SNET",
            constraintDateMinutes: d(5),
          },
        ],
      });

      const slot = buildSlotPayload(snapshot);
      const minute = buildMinutePayload(snapshot);
      const slotDate = payloadDate(snapshot.projectStartDate, (slot.tasks[0].constraintDateMinutes as number) * 1440);

      expect(slot.tasks[0].constraintDateMinutes).toBe(7);
      expect(payloadDate(snapshot.projectStartDate, minute.tasks[0].constraintDateMinute as number)).toBe(slotDate);
      expect((minute.tasks[0].constraintDateMinute as number) % 1440).toBe(480);
    });

    it("finish-oriented constraints keep the same snapped working date as the slot payload", () => {
      const snapshot = makeSnapshot({
        compiledProjectCalendar: compileCalendar(STANDARD_CALENDAR),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: d(1),
            siblingOrder: "a",
            constraintType: "FNLT",
            constraintDateMinutes: d(6),
          },
        ],
      });

      const slot = buildSlotPayload(snapshot);
      const minute = buildMinutePayload(snapshot);
      const slotDate = payloadDate(snapshot.projectStartDate, (slot.tasks[0].constraintDateMinutes as number) * 1440);

      expect(slot.tasks[0].constraintDateMinutes).toBe(4);
      expect(payloadDate(snapshot.projectStartDate, minute.tasks[0].constraintDateMinute as number)).toBe(slotDate);
      expect((minute.tasks[0].constraintDateMinute as number) % 1440).toBe(1020);
    });
  });

  describe("expected divergence evidence", () => {
    it("holiday calendars keep the same snapped working date but diverge in exact minute coordinate", () => {
      const holidayCalendar = compileCalendar({
        ...STANDARD_CALENDAR,
        exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Holiday" }],
      });
      const snapshot = makeSnapshot({
        compiledProjectCalendar: holidayCalendar,
        nonWorkingDays: [0, 5, 6],
        nwdSet: new Set([0, 5, 6]),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: d(1),
            siblingOrder: "a",
            constraintType: "SNET",
            constraintDateMinutes: d(0),
          },
        ],
      });

      const slot = buildSlotPayload(snapshot);
      const minute = buildMinutePayload(snapshot);
      const minuteConstraint = minute.tasks[0].constraintDateMinute as number;

      expect(slot.tasks[0].constraintDateMinutes).toBe(1);
      expect(payloadDate(snapshot.projectStartDate, minuteConstraint)).toBe("2025-01-07");
      expect(minuteConstraint).toBe(1920);
      expect(minuteConstraint).not.toBe((slot.tasks[0].constraintDateMinutes as number) * 1440);
    });

    it("half-day calendars expose end-of-day detail the slot payload cannot encode", () => {
      const halfDayCalendar = compileCalendar({
        ...STANDARD_CALENDAR,
        exceptions: [{
          date: "2025-01-10",
          workIntervals: [{ startMinute: 480, endMinute: 720 }],
          name: "Half Day",
        }],
      });

      const baselineSnapshot = makeSnapshot({
        compiledProjectCalendar: compileCalendar(STANDARD_CALENDAR),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: d(1),
            siblingOrder: "a",
            constraintType: "FNLT",
            constraintDateMinutes: d(4),
          },
        ],
      });
      const halfDaySnapshot = makeSnapshot({
        compiledProjectCalendar: halfDayCalendar,
        tasks: baselineSnapshot.tasks,
      });

      const slotStandard = buildSlotPayload(baselineSnapshot);
      const slotHalfDay = buildSlotPayload(halfDaySnapshot);
      const minuteStandard = buildMinutePayload(baselineSnapshot);
      const minuteHalfDay = buildMinutePayload(halfDaySnapshot);

      expect(slotStandard.tasks[0].constraintDateMinutes).toBe(4);
      expect(slotHalfDay.tasks[0].constraintDateMinutes).toBe(4);
      expect((minuteStandard.tasks[0].constraintDateMinute as number) % 1440).toBe(1020);
      expect((minuteHalfDay.tasks[0].constraintDateMinute as number) % 1440).toBe(720);
      expect(minuteHalfDay.tasks[0].constraintDateMinute).not.toBe(minuteStandard.tasks[0].constraintDateMinute);
    });

    it("non-uniform working patterns break scalar duration and lag parity", () => {
      const nonUniformCalendar = compileCalendar({
        id: "non-uniform" as CalendarId,
        name: "Non Uniform",
        weeklyPattern: {
          1: [{ startMinute: 480, endMinute: 960 }],
          2: [{ startMinute: 480, endMinute: 960 }],
          3: [{ startMinute: 480, endMinute: 960 }],
          4: [{ startMinute: 480, endMinute: 960 }],
          5: [{ startMinute: 480, endMinute: 720 }],
        },
        exceptions: [],
      });
      const compatibilityMinutesPerDay = 432;
      const snapshot = makeSnapshot({
        compiledProjectCalendar: nonUniformCalendar,
        temporalAdapter: makeTemporalAdapter(compatibilityMinutesPerDay),
        tasks: [
          {
            id: "A",
            name: "A",
            durationWorkMinutes: wm(240),
            minEarlyStartMinutes: wm(240),
            siblingOrder: "a",
          },
          {
            id: "B",
            name: "B",
            durationWorkMinutes: d(1),
            siblingOrder: "b",
          },
        ],
        dependencies: [
          {
            id: "dep-1",
            predId: "A",
            succId: "B",
            type: "FS",
            lagWorkMinutes: wm(240),
          },
        ],
      });

      const slot = buildSlotPayload(snapshot);
      const minute = buildMinutePayload(snapshot);

      expect(slot.tasks[0].durationWorkMinutes).toBe(1);
      expect(slot.tasks[0].minEarlyStartMinutes).toBe(1);
      expect(slot.dependencies[0].lagWorkMinutes).toBe(1);

      expect(minute.tasks[0].durationMinutes).toBe(240);
      expect(minute.tasks[0].minEarlyStartMinutes).toBe(240);
      expect(minute.dependencies[0].lagMinutes).toBe(240);

      expect(minute.tasks[0].durationMinutes).not.toBe((slot.tasks[0].durationWorkMinutes as number) * compatibilityMinutesPerDay);
      expect(minute.tasks[0].minEarlyStartMinutes).not.toBe((slot.tasks[0].minEarlyStartMinutes as number) * compatibilityMinutesPerDay);
      expect(minute.dependencies[0].lagMinutes).not.toBe((slot.dependencies[0].lagWorkMinutes as number) * compatibilityMinutesPerDay);
    });
  });
});