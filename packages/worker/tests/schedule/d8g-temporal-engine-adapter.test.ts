import type { CalendarConfig, CalendarId, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulingStateSnapshot } from "../../src/schedule/ISchedulingEngine.js";
import {
    _resetTemporalWasm,
    setTemporalWasm,
    TemporalEngineAdapter,
} from "../../src/schedule/TemporalEngineAdapter.js";

const projectCalendar: CalendarConfig = {
  id: "project" as CalendarId,
  name: "Project",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

const temporalAdapter = {
  minutesPerDay: MINUTES_PER_DAY,
  toDaySlots: (workMinutes: WorkMinutes) =>
    Math.round((workMinutes as number) / (MINUTES_PER_DAY as number)) as WorkMinutes,
  fromDaySlots: (daySlots: WorkMinutes) =>
    ((daySlots as number) * (MINUTES_PER_DAY as number)) as WorkMinutes,
};

function makeSnapshot(): SchedulingStateSnapshot {
  return {
    tasks: [
      {
        id: "T1",
        name: "Task 1",
        siblingOrder: "a",
        durationWorkMinutes: MINUTES_PER_DAY as WorkMinutes,
        assignedCalendarId: "task-cal" as CalendarId,
      },
      {
        id: "T2",
        name: "Task 2",
        siblingOrder: "b",
        durationWorkMinutes: MINUTES_PER_DAY as WorkMinutes,
      },
    ],
    dependencies: [
      {
        id: "d1",
        predId: "T1",
        succId: "T2",
        type: "FS",
        lagWorkMinutes: 0 as WorkMinutes,
      },
    ],
    projectStartDate: "2025-01-06",
    projectCalendar,
    findTask: () => undefined,
    calendars: {
      project: projectCalendar,
      "task-cal": {
        ...projectCalendar,
        id: "task-cal" as CalendarId,
        name: "Task Calendar",
      },
    },
    nonWorkingDays: [5, 6],
    nwdSet: new Set([5, 6]),
    schedulingMode: "legacy",
    assumptionSet: {
      id: "as-1",
      version: 1,
      name: "Scenario",
      zones: [],
      quantities: [],
      resources: [],
      productivityRules: [],
    },
    authoredActivities: [],
    compiledProjectCalendar: undefined,
    temporalAdapter,
  };
}

describe("D8g TemporalEngineAdapter response validation", () => {
  beforeEach(() => {
    _resetTemporalWasm();
  });

  it("accepts valid minute response shape and produces normalized facts", () => {
    setTemporalWasm({
      calculate_schedule_minute: () => ({
        scheduleVersion: 1,
        results: [
          {
            taskId: "T1",
            earlyStartMinute: 0,
            earlyFinishMinute: 480,
            lateStartMinute: 0,
            lateFinishMinute: 480,
            totalFloatMinutes: 0,
            freeFloatMinutes: 0,
            isCritical: true,
          },
        ],
      }),
    });

    const adapter = new TemporalEngineAdapter();
    const result = adapter.execute(makeSnapshot());

    expect(result.normalized).not.toBeNull();
    expect(result.normalized?.T1).toBeDefined();
  });

  it("forwards per-task calendars and calendars[] to minute shadow request", () => {
    let capturedRequest: any = null;

    setTemporalWasm({
      calculate_schedule_minute: (request: unknown) => {
        capturedRequest = request;
        return {
          scheduleVersion: 1,
          results: [
            {
              taskId: "T1",
              earlyStartMinute: 0,
              earlyFinishMinute: 480,
              lateStartMinute: 0,
              lateFinishMinute: 480,
              totalFloatMinutes: 0,
              freeFloatMinutes: 0,
              isCritical: true,
            },
            {
              taskId: "T2",
              earlyStartMinute: 480,
              earlyFinishMinute: 960,
              lateStartMinute: 480,
              lateFinishMinute: 960,
              totalFloatMinutes: 0,
              freeFloatMinutes: 0,
              isCritical: true,
            },
          ],
        };
      },
    });

    const adapter = new TemporalEngineAdapter();
    const result = adapter.execute(makeSnapshot());

    expect(result.normalized).not.toBeNull();
    expect(capturedRequest).toBeTruthy();
    expect(capturedRequest.tasks[0].calendarId).toBe("task-cal");
    expect(capturedRequest.tasks[1].calendarId).toBe("project");
    expect(capturedRequest.projectCalendarId).toBe("project");
    expect(Array.isArray(capturedRequest.calendars)).toBe(true);
    expect(capturedRequest.calendars.some((c: { id: string }) => c.id === "project")).toBe(true);
    expect(capturedRequest.calendars.some((c: { id: string }) => c.id === "task-cal")).toBe(true);
  });

  it("returns explicit shadow malformed response when success payload is malformed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setTemporalWasm({
      calculate_schedule_minute: () => ({
        scheduleVersion: 1,
        results: [
          {
            taskId: "T1",
            earlyStartMinute: 0,
            // Missing required fields should fail validation
            isCritical: true,
          },
        ],
      }),
    });

    const adapter = new TemporalEngineAdapter();
    const result = adapter.execute(makeSnapshot());

    expect(result.normalized).toBeNull();
    expect((result.rawResult as any).type).toBe("ShadowMalformedResponse");
    expect((result.rawResult as any).message).toContain("shape validation");
    expect(warnSpy).toHaveBeenCalledWith(
      "[D8g Shadow] Minute response shape invalid.",
    );

    warnSpy.mockRestore();
  });

  it("keeps typed error envelopes non-blocking and untranslated", () => {
    setTemporalWasm({
      calculate_schedule_minute: () => ({
        type: "CycleDetected",
        message: "cycle",
      }),
    });

    const adapter = new TemporalEngineAdapter();
    const result = adapter.execute(makeSnapshot());

    expect(result.normalized).toBeNull();
    expect((result.rawResult as any).type).toBe("CycleDetected");
  });

  it("treats non-object payloads as malformed shadow responses", () => {
    setTemporalWasm({
      calculate_schedule_minute: () => 42,
    });

    const adapter = new TemporalEngineAdapter();
    const result = adapter.execute(makeSnapshot());

    expect(result.normalized).toBeNull();
    expect((result.rawResult as any).type).toBe("ShadowMalformedResponse");
  });
});
