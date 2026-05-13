/**
 * @module activityCalendarCompiler.test
 *
 * Tests for W5B — Activity-level Calendar Compilation and Routing
 *
 * Covers:
 * 1. Activity calendar compiler — task assignment resolution
 * 2. Cross-calendar relationship behavior
 * 3. Preservation of W5A project default calendar behavior
 * 4. Diagnostics for assigned calendar handling
 */

import type { BaseCalendarDefinition, CalendarId, Task } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { compileCalendar } from "../../src/calendarRegistry.js";
import {
    buildActivityCalendarMap,
    compileActivityCalendars,
    getTasksWithAssignedCalendars,
} from "../../src/import/activityCalendarCompiler.js";
import { wm } from "../helpers.js";

describe("W5B — Activity Calendar Compiler", () => {
  let projectCalendarDef: BaseCalendarDefinition;
  let fiveDayCalendarDef: BaseCalendarDefinition;
  let sixDayCalendarDef: BaseCalendarDefinition;
  let sevenDayCalendarDef: BaseCalendarDefinition;
  let compiledProjectCalendar: any;

  beforeEach(() => {
    // Project calendar — 5-day (Mon-Fri)
    projectCalendarDef = {
      id: "project-cal" as CalendarId,
      name: "Project Calendar",
      weeklyPattern: {
        0: [], // Sun
        1: [{ startMinute: 480, endMinute: 960 }], // Mon
        2: [{ startMinute: 480, endMinute: 960 }], // Tue
        3: [{ startMinute: 480, endMinute: 960 }], // Wed
        4: [{ startMinute: 480, endMinute: 960 }], // Thu
        5: [{ startMinute: 480, endMinute: 960 }], // Fri
        6: [], // Sat
      },
      exceptions: [],
    };

    // 5-day calendar (Mon-Fri)
    fiveDayCalendarDef = {
      id: "5day-cal" as CalendarId,
      name: "5-Day Calendar",
      weeklyPattern: {
        0: [], // Sun
        1: [{ startMinute: 480, endMinute: 960 }], // Mon
        2: [{ startMinute: 480, endMinute: 960 }], // Tue
        3: [{ startMinute: 480, endMinute: 960 }], // Wed
        4: [{ startMinute: 480, endMinute: 960 }], // Thu
        5: [{ startMinute: 480, endMinute: 960 }], // Fri
        6: [], // Sat
      },
      exceptions: [],
    };

    // 6-day calendar (Mon-Sat)
    sixDayCalendarDef = {
      id: "6day-cal" as CalendarId,
      name: "6-Day Calendar",
      weeklyPattern: {
        0: [], // Sun
        1: [{ startMinute: 480, endMinute: 960 }], // Mon
        2: [{ startMinute: 480, endMinute: 960 }], // Tue
        3: [{ startMinute: 480, endMinute: 960 }], // Wed
        4: [{ startMinute: 480, endMinute: 960 }], // Thu
        5: [{ startMinute: 480, endMinute: 960 }], // Fri
        6: [{ startMinute: 480, endMinute: 960 }], // Sat
      },
      exceptions: [],
    };

    // 7-day calendar (every day)
    sevenDayCalendarDef = {
      id: "7day-cal" as CalendarId,
      name: "7-Day Calendar",
      weeklyPattern: {
        0: [{ startMinute: 480, endMinute: 960 }], // Sun
        1: [{ startMinute: 480, endMinute: 960 }], // Mon
        2: [{ startMinute: 480, endMinute: 960 }], // Tue
        3: [{ startMinute: 480, endMinute: 960 }], // Wed
        4: [{ startMinute: 480, endMinute: 960 }], // Thu
        5: [{ startMinute: 480, endMinute: 960 }], // Fri
        6: [{ startMinute: 480, endMinute: 960 }], // Sat
      },
      exceptions: [],
    };

    compiledProjectCalendar = compileCalendar(projectCalendarDef);
  });

  describe("Test 1: Task with assignedCalendarId resolves to assigned calendar", () => {
    it("should resolve task calendar from resolved definitions", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "6day-cal" as CalendarId },
      ];
      const resolvedDefs = { "6day-cal": sixDayCalendarDef };
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].assignedCalendarId).toBe("6day-cal");
      expect(result.mappings[0].compiledCalendar.dailyMinutes).toEqual([0, 480, 480, 480, 480, 480, 480]); // 6-day pattern
      expect(result.mappings[0].isDefault).toBe(false);
      expect(result.diagnostics).toEqual({});
    });
  });

  describe("Test 2: Task without assignedCalendarId falls back to project default", () => {
    it("should use project calendar for unassigned tasks", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V" },
      ];
      const resolvedDefs = {};
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].assignedCalendarId).toBeUndefined();
      expect(result.mappings[0].isDefault).toBe(true);
      expect(result.diagnostics).toEqual({});
    });
  });

  describe("Test 3: Invalid assignedCalendarId falls back safely with diagnostic", () => {
    it("should fallback to project calendar and emit warning diagnostic", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "nonexistent-cal" as CalendarId },
      ];
      const resolvedDefs = {};
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].assignedCalendarId).toBe("nonexistent-cal");
      expect(result.mappings[0].isDefault).toBe(true);
      expect(result.mappings[0].diagnostic).toContain("not found");
      expect(result.diagnostics["T1"]).toContain("not found");
    });
  });

  describe("Test 4: 5-day calendar skips weekends", () => {
    it("should have 0 working minutes on Saturday and Sunday", () => {
      const tasks: Task[] = [
        { id: "T4", name: "T4", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "5day-cal" as CalendarId },
      ];
      const resolvedDefs = { "5day-cal": fiveDayCalendarDef };
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      const compiled = result.mappings[0].compiledCalendar;
      expect(compiled.dailyMinutes[0]).toBe(0); // Sunday
      expect(compiled.dailyMinutes[6]).toBe(0); // Saturday
      expect(compiled.dailyMinutes.slice(1, 6).every((m) => m > 0)).toBe(true); // Mon-Fri working
    });
  });

  describe("Test 5: 6-day calendar allows Saturday", () => {
    it("should have working minutes on Saturday, 0 on Sunday", () => {
      const tasks: Task[] = [
        { id: "T5", name: "T5", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "6day-cal" as CalendarId },
      ];
      const resolvedDefs = { "6day-cal": sixDayCalendarDef };
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      const compiled = result.mappings[0].compiledCalendar;
      expect(compiled.dailyMinutes[0]).toBe(0); // Sunday
      expect(compiled.dailyMinutes[6]).toBeGreaterThan(0); // Saturday
      expect(compiled.dailyMinutes.slice(1, 6).every((m) => m > 0)).toBe(true); // Mon-Fri working
    });
  });

  describe("Test 6: 7-day calendar allows Sunday", () => {
    it("should have working minutes every day", () => {
      const tasks: Task[] = [
        { id: "T6", name: "T6", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "7day-cal" as CalendarId },
      ];
      const resolvedDefs = { "7day-cal": sevenDayCalendarDef };
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      const compiled = result.mappings[0].compiledCalendar;
      expect(compiled.dailyMinutes.every((m) => m > 0)).toBe(true); // Every day working
    });
  });

  describe("Test 8: Project default calendar remains fallback for unassigned tasks", () => {
    it("should use project calendar for unassigned in mixed group", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "6day-cal" as CalendarId },
        { id: "T2", name: "T2", durationWorkMinutes: wm(480), siblingOrder: "V" }, // Unassigned
        { id: "T3", name: "T3", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "7day-cal" as CalendarId },
      ];
      const resolvedDefs = {
        "6day-cal": sixDayCalendarDef,
        "7day-cal": sevenDayCalendarDef,
      };
      const rawDefs = {};

      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      expect(result.mappings).toHaveLength(3);
      expect(result.mappings[0].isDefault).toBe(false); // 6-day assigned
      expect(result.mappings[1].isDefault).toBe(true); // Unassigned, uses project
      expect(result.mappings[2].isDefault).toBe(false); // 7-day assigned
    });
  });

  describe("Test 13: Resource calendars remain inactive (diagnostic verification)", () => {
    it("should not process resource calendar logic during activity compilation", () => {
      // W5B scope: resource calendars are NOT activated
      // This is verified by the fact that compileActivityCalendars only looks at task.assignedCalendarId
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V" },
      ];
      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, {}, {});
      
      // Should only have task calendar logic, not resource logic
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].assignedCalendarId).toBeUndefined();
      // Diagnostics should not mention resources
      expect(Object.values(result.diagnostics).join("")).not.toContain("resource");
    });
  });

  describe("Test 14: Lag calendar settings remain inactive (diagnostic verification)", () => {
    it("should not process lag calendar logic during activity compilation", () => {
      // W5B scope: lag calendars are NOT activated
      // This is verified by compileActivityCalendars focusing only on task assignments
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V" },
      ];
      const result = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, {}, {});
      
      // Should not have lag calendar entries in diagnostics
      expect(Object.values(result.diagnostics).join("")).not.toContain("lag");
    });
  });

  describe("buildActivityCalendarMap helper", () => {
    it("should create fast-lookup map from compilation result", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "6day-cal" as CalendarId },
        { id: "T2", name: "T2", durationWorkMinutes: wm(480), siblingOrder: "V" },
      ];
      const resolvedDefs = { "6day-cal": sixDayCalendarDef };
      const rawDefs = {};

      const compilation = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      const map = buildActivityCalendarMap(compilation);

      expect(map.size).toBe(2);
      expect(map.get("T1")).toBeDefined();
      expect(map.get("T2")).toBeDefined();
    });
  });

  describe("getTasksWithAssignedCalendars helper", () => {
    it("should identify tasks with assigned calendars (non-default)", () => {
      const tasks: Task[] = [
        { id: "T1", name: "T1", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "6day-cal" as CalendarId },
        { id: "T2", name: "T2", durationWorkMinutes: wm(480), siblingOrder: "V" },
        { id: "T3", name: "T3", durationWorkMinutes: wm(480), siblingOrder: "V", assignedCalendarId: "7day-cal" as CalendarId },
      ];
      const resolvedDefs = {
        "6day-cal": sixDayCalendarDef,
        "7day-cal": sevenDayCalendarDef,
      };
      const rawDefs = {};

      const compilation = compileActivityCalendars(tasks, "project-cal" as CalendarId, compiledProjectCalendar, resolvedDefs, rawDefs);
      const withCals = getTasksWithAssignedCalendars(compilation);

      expect(withCals.size).toBe(2);
      expect(withCals.has("T1")).toBe(true);
      expect(withCals.has("T3")).toBe(true);
      expect(withCals.has("T2")).toBe(false); // Unassigned doesn't count
    });
  });
});
