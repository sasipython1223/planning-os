import type { Task, WorkMinutes } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import * as State from "../src/state.js";

const wm = (n: number) => n as WorkMinutes;

describe("State hydration backward compatibility", () => {
  it("hydrates older snapshots where tasks do not contain sourceActivityId or activityCode", () => {
    State.clearState();

    const oldSnapshot = {
      projectStartDate: "2026-01-01",
      excludeWeekends: true,
      tasks: [
        {
          id: "t1",
          name: "Legacy Task",
          durationWorkMinutes: wm(5),
          siblingOrder: "V",
        },
      ] as Task[],
      dependencies: [],
      baselines: {},
      resources: [],
      assignments: [],
    };

    State.hydrateState(oldSnapshot);

    expect(State.getTasks()).toHaveLength(1);
    expect(State.getTasks()[0].id).toBe("t1");
    expect(State.getTasks()[0].sourceActivityId).toBeUndefined();
    expect(State.getTasks()[0].activityCode).toBeUndefined();
  });

  it("hydrates planner calendar exceptions and preserves project default calendar selection", () => {
    State.clearState();

    State.hydrateState({
      projectStartDate: "2026-01-01",
      excludeWeekends: true,
      calendarId: "planner-team" as unknown as import("@planner/protocol").CalendarId,
      plannerCalendars: {
        ["planner-team"]: {
          calendarId: "planner-team" as unknown as import("@planner/protocol").CalendarId,
          name: "Planner Team",
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
            1: [{ startMinute: 480, endMinute: 960 }],
            2: [{ startMinute: 480, endMinute: 960 }],
            3: [{ startMinute: 480, endMinute: 960 }],
            4: [{ startMinute: 480, endMinute: 960 }],
            5: [{ startMinute: 480, endMinute: 960 }],
            6: [],
          },
          exceptions: [
            {
              date: "2026-12-25",
              type: "non-working",
              workIntervals: [],
              name: "Holiday",
            },
          ],
          createdAt: "2026-05-09T00:00:00.000Z",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
      },
      tasks: [],
      dependencies: [],
      baselines: {},
      resources: [],
      assignments: [],
    });

    expect(String(State.getCalendarId())).toBe("planner-team");
    expect(State.getPlannerCalendars()["planner-team"]?.isDefaultProjectCalendar).toBe(true);
    expect(State.getPlannerCalendars()["planner-team"]?.exceptions).toHaveLength(1);
    expect(State.getPlannerCalendars()["planner-team"]?.exceptions[0].date).toBe("2026-12-25");
  });
});
