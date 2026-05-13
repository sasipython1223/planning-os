import type { CalendarConfig, CalendarId, Dependency, DependencyType, Task, WorkMinutes } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID, MINUTES_PER_DAY } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { TemporalCoordinateTranslator } from "../../src/schedule/TemporalCoordinateTranslator.js";
import type { TemporalStateReader } from "../../src/temporal/temporalRequestBuilder.js";
import {
    _resetCompilerCache,
    buildTemporalRequest,
} from "../../src/temporal/temporalRequestBuilder.js";

const PROJECT_START = "2025-01-06"; // Monday

const projectCalendar: CalendarConfig = {
  id: DEFAULT_CALENDAR_ID,
  name: "Standard (Mon–Fri, 8h)",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

const makeTask = (overrides: Partial<Task> & { id: string }): Task => ({
  name: overrides.id,
  durationWorkMinutes: (480 as WorkMinutes),
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

function createStateReader(
  tasks: Task[],
  dependencies: Dependency[] = [],
  calendars: Record<string, CalendarConfig> = {},
): TemporalStateReader {
  return {
    getTasks: () => tasks,
    getDependencies: () => dependencies,
    getProjectStartDate: () => PROJECT_START,
    getProjectCalendar: () => projectCalendar,
    findTask: (id: string) => tasks.find(t => t.id === id),
    getCalendars: () => calendars,
  };
}

const translator = new TemporalCoordinateTranslator({
  projectStartDate: PROJECT_START,
  minutesPerDay: MINUTES_PER_DAY as number,
  nwdSet: new Set(),
});

describe("TemporalRequestBuilder", () => {
  beforeEach(() => {
    _resetCompilerCache();
  });

  describe("buildTemporalRequest", () => {
    it("returns a valid request shape for empty state", () => {
      const state = createStateReader([]);
      const req = buildTemporalRequest(state, translator);

      expect(req.tasks).toEqual([]);
      expect(req.relations).toEqual([]);
      expect(req.calendars).toHaveLength(1);
      expect(req.project_calendar_id).toBe("default");
      expect(req.data_date_minute).toBe(0);
    });

    it("maps a single task correctly", () => {
      const tasks = [makeTask({ id: "t1", durationWorkMinutes: 960 as WorkMinutes })];
      const state = createStateReader(tasks);
      const req = buildTemporalRequest(state, translator);

      expect(req.tasks).toHaveLength(1);
      const t = req.tasks[0];
      expect(t.id).toBe("t1");
      expect(t.duration_minutes).toBe(960);
      expect(t.calendar_id).toBe("default");
      expect(t.parent_id).toBeNull();
      expect(t.is_summary).toBe(false);
      expect(t.constraint_type).toBe("ASAP");
      expect(t.constraint_date_minutes).toBeNull();
    });

    it("derives is_summary from parentId relationships", () => {
      const tasks = [
        makeTask({ id: "parent" }),
        makeTask({ id: "child", parentId: "parent" }),
      ];
      const state = createStateReader(tasks);
      const req = buildTemporalRequest(state, translator);

      const parent = req.tasks.find(t => t.id === "parent")!;
      const child = req.tasks.find(t => t.id === "child")!;
      expect(parent.is_summary).toBe(true);
      expect(child.is_summary).toBe(false);
    });

    it("maps constraint type and date", () => {
      const tasks = [
        makeTask({
          id: "t1",
          constraintType: "SNET",
          constraintDateMinutes: 480 as WorkMinutes,
        }),
      ];
      const state = createStateReader(tasks);
      const req = buildTemporalRequest(state, translator);

      expect(req.tasks[0].constraint_type).toBe("SNET");
      expect(req.tasks[0].constraint_date_minutes).toBe(480);
    });

    it("maps dependencies correctly", () => {
      const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
      const deps = [makeDep("t1", "t2", { type: "FS", lagWorkMinutes: 480 as WorkMinutes })];
      const state = createStateReader(tasks, deps);
      const req = buildTemporalRequest(state, translator);

      expect(req.relations).toHaveLength(1);
      const r = req.relations[0];
      expect(r.pred_id).toBe("t1");
      expect(r.succ_id).toBe("t2");
      expect(r.dep_type).toBe("FS");
      expect(r.lag_minutes).toBe(480);
      expect(r.lag_calendar_id).toBe("default");
    });

    it("compiles project calendar into working intervals", () => {
      const state = createStateReader([]);
      const req = buildTemporalRequest(state, translator);

      expect(req.calendars).toHaveLength(1);
      const cal = req.calendars[0];
      expect(cal.id).toBe("default");
      // Default horizon=3650 days, Mon-Fri → ~2607 working days
      expect(cal.intervals.length).toBeGreaterThan(2600);
      // Each interval should be 480 minutes wide
      const [start, end] = cal.intervals[0];
      expect(end - start).toBe(480);
    });

    it("includes additional calendars from state", () => {
      const customCal: CalendarConfig = {
        id: "custom" as CalendarId,
        name: "Custom",
        minutesPerDay: 600 as WorkMinutes,
        workingWeekPattern: "ALL_DAYS",
        holidays: [],
      };
      const state = createStateReader([], [], { custom: customCal });
      const req = buildTemporalRequest(state, translator);

      expect(req.calendars).toHaveLength(2);
      const custom = req.calendars.find(c => c.id === "custom")!;
      expect(custom).toBeDefined();
      expect(custom.intervals[0][1] - custom.intervals[0][0]).toBe(600);
    });

    it("does not duplicate project calendar in additional calendars", () => {
      const state = createStateReader([], [], {
        [DEFAULT_CALENDAR_ID as string]: projectCalendar,
      });
      const req = buildTemporalRequest(state, translator);

      const defaultCals = req.calendars.filter(c => c.id === "default");
      expect(defaultCals).toHaveLength(1);
    });

    it("sets data_date_minute to 0 (project start)", () => {
      const state = createStateReader([]);
      const req = buildTemporalRequest(state, translator);
      expect(req.data_date_minute).toBe(0);
    });

    it("handles multiple dependency types", () => {
      const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
      const deps = [
        makeDep("t1", "t2", { id: "d1", type: "SS" as DependencyType }),
      ];
      const state = createStateReader(tasks, deps);
      const req = buildTemporalRequest(state, translator);

      expect(req.relations[0].dep_type).toBe("SS");
    });
  });
});
