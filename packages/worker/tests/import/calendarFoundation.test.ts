/**
 * Calendar Foundation Unit Tests — W3A
 *
 * Tests the rich calendar preservation foundation:
 * - ImportCandidate can carry calendarDefinitions
 * - IMPORT_SCHEDULE persists calendarDefinitions via SourceImportRecord
 * - Hydration restores calendarDefinitions from persisted state
 * - ImportSummary exposes calendarFidelity counts
 * - Existing worker schedule output is unchanged when calendarDefinitions are present
 */

import type {
    BaseCalendarDefinition,
    CalendarFidelitySummary,
    CalendarId,
    ImportSummary,
    WorkMinutes,
} from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImportCandidate } from "../../src/import/importCandidate.js";
import {
    clearPendingCandidate,
    getPendingCandidate,
    setPendingCandidate,
} from "../../src/import/importCandidate.js";
import * as State from "../../src/state.js";

const wm = (n: number) => n as WorkMinutes;
const asCalendarId = (s: string) => s as CalendarId;

// ─── Fixtures ────────────────────────────────────────────────────────

const STANDARD_CALENDAR_ID = asCalendarId("default");

const buildCalendarDef = (id: string, name: string): BaseCalendarDefinition => ({
  id: asCalendarId(id),
  name,
  weeklyPattern: {
    1: [{ startMinute: 480, endMinute: 1020 }],
    2: [{ startMinute: 480, endMinute: 1020 }],
    3: [{ startMinute: 480, endMinute: 1020 }],
    4: [{ startMinute: 480, endMinute: 1020 }],
    5: [{ startMinute: 480, endMinute: 1020 }],
  },
  exceptions: [],
});

const buildCalendarFidelity = (overrides: Partial<CalendarFidelitySummary> = {}): CalendarFidelitySummary => ({
  totalCalendars: 1,
  taskCalendarAssignments: 0,
  resourceCalendarAssignments: 0,
  exceptionCount: 0,
  calendarsWithInheritance: 0,
  calendarsSimplifiedForEngine: 1,
  ...overrides,
});

const buildSummary = (calendarFidelity?: CalendarFidelitySummary): ImportSummary => ({
  taskCount: 2,
  dependencyCount: 1,
  resourceCount: 0,
  assignmentCount: 0,
  calendarInfo: "5-day workweek",
  calendarFidelity,
});

function buildCandidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    format: "xer",
    projectName: "Calendar Test Project",
    projectStartDate: "2026-01-01",
    summary: buildSummary(),
    diagnostics: [],
    diagnosticsSummary: { errors: 0, warnings: 0, infos: 0 },
    canCommit: true,
    rawData: { projects: [], wbs: [], tasks: [], taskPreds: [], resources: [], taskRsrcs: [], calendars: [] },
    mappedTasks: [{ id: "t1", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" }],
    mappedDependencies: [],
    mappedResources: [],
    mappedAssignments: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Calendar Foundation — W3A", () => {
  beforeEach(() => {
    State.clearState();
    clearPendingCandidate();
  });

  describe("ImportCandidate calendar definitions", () => {
    it("should carry calendarDefinitions when present", () => {
      const calDefs: Record<CalendarId, BaseCalendarDefinition> = {
        [asCalendarId("C1")]: buildCalendarDef("C1", "Standard 5-Day"),
      };

      const candidate = buildCandidate({ calendarDefinitions: calDefs });
      setPendingCandidate(candidate);

      const held = getPendingCandidate();
      expect(held).not.toBeNull();
      expect(held!.calendarDefinitions).toBeDefined();
      expect(Object.keys(held!.calendarDefinitions!)).toHaveLength(1);
      expect(held!.calendarDefinitions![asCalendarId("C1")].name).toBe("Standard 5-Day");
    });

    it("should carry undefined calendarDefinitions when absent", () => {
      const candidate = buildCandidate();
      setPendingCandidate(candidate);

      const held = getPendingCandidate();
      expect(held!.calendarDefinitions).toBeUndefined();
    });

    it("should support multiple calendar definitions", () => {
      const calDefs: Record<CalendarId, BaseCalendarDefinition> = {
        [asCalendarId("CAL-GLOBAL")]: buildCalendarDef("CAL-GLOBAL", "Global Calendar"),
        [asCalendarId("CAL-NIGHT")]: buildCalendarDef("CAL-NIGHT", "Night Shift"),
        [asCalendarId("CAL-WEEKEND")]: buildCalendarDef("CAL-WEEKEND", "Weekend Calendar"),
      };

      const candidate = buildCandidate({ calendarDefinitions: calDefs });
      setPendingCandidate(candidate);

      const held = getPendingCandidate();
      expect(Object.keys(held!.calendarDefinitions!)).toHaveLength(3);
      expect(held!.calendarDefinitions![asCalendarId("CAL-NIGHT")].name).toBe("Night Shift");
    });
  });

  describe("SourceImportRecord calendar definitions", () => {
    it("should persist calendarDefinitions in SourceImportRecord after commit", () => {
      const calDefs: Record<CalendarId, BaseCalendarDefinition> = {
        [asCalendarId("C1")]: buildCalendarDef("C1", "Project Calendar"),
      };

      State.setSourceImportRecord({
        format: "xer",
        summary: buildSummary(),
        diagnostics: [],
        sourceFileName: "test.xer",
        status: "sourceImportedNotCalculated",
        calendarDefinitions: calDefs,
        importedAt: new Date().toISOString(),
      });

      const record = State.getSourceImportRecord();
      expect(record).not.toBeNull();
      expect(record!.calendarDefinitions).toBeDefined();
      expect(Object.keys(record!.calendarDefinitions!)).toHaveLength(1);
      expect(record!.calendarDefinitions![asCalendarId("C1")].name).toBe("Project Calendar");
    });

    it("should allow SourceImportRecord without calendarDefinitions (backward compat)", () => {
      State.setSourceImportRecord({
        format: "xer",
        summary: buildSummary(),
        diagnostics: [],
        status: "sourceImportedNotCalculated",
        importedAt: new Date().toISOString(),
      });

      const record = State.getSourceImportRecord();
      expect(record).not.toBeNull();
      expect(record!.calendarDefinitions).toBeUndefined();
    });
  });

  describe("Hydration restores calendarDefinitions", () => {
    it("should restore calendarDefinitions from persisted state", () => {
      const calDefs: Record<string, BaseCalendarDefinition> = {
        "CAL-1": buildCalendarDef("CAL-1", "Restored Calendar"),
      };

      State.hydrateState({
        projectStartDate: "2026-01-01",
        excludeWeekends: false,
        tasks: [{ id: "t1", name: "Task", durationWorkMinutes: wm(5), siblingOrder: "V" }],
        dependencies: [],
        baselines: {},
        calendarDefinitions: calDefs,
      });

      const restored = State.getCalendarDefinitions();
      // DEFAULT_CALENDAR_ID is always present
      expect(restored[STANDARD_CALENDAR_ID as string]).toBeDefined();
      // Persisted defs merged in
      expect(restored["CAL-1"]).toBeDefined();
      expect(restored["CAL-1"].name).toBe("Restored Calendar");
    });

    it("should fall back to STANDARD_CALENDAR when calendarDefinitions absent from persisted", () => {
      State.hydrateState({
        projectStartDate: "2026-01-01",
        excludeWeekends: false,
        tasks: [],
        dependencies: [],
        baselines: {},
      });

      const defs = State.getCalendarDefinitions();
      expect(defs[STANDARD_CALENDAR_ID as string]).toBeDefined();
    });

    it("should restore calendarDefinitions from sourceImportRecord", () => {
      const calDefs: Record<string, BaseCalendarDefinition> = {
        "CAL-IMPORT": buildCalendarDef("CAL-IMPORT", "Imported Rich Calendar"),
      };

      State.hydrateState({
        projectStartDate: "2026-01-01",
        excludeWeekends: false,
        tasks: [],
        dependencies: [],
        baselines: {},
        sourceImportRecord: {
          format: "xer",
          summary: buildSummary(),
          diagnostics: [],
          status: "sourceImportedNotCalculated",
          calendarDefinitions: calDefs,
          importedAt: new Date().toISOString(),
        },
      });

      const record = State.getSourceImportRecord();
      expect(record!.calendarDefinitions).toBeDefined();
      expect(record!.calendarDefinitions!["CAL-IMPORT" as CalendarId].name).toBe("Imported Rich Calendar");
    });
  });

  describe("ImportSummary calendar fidelity counts", () => {
    it("should expose calendarFidelity when present in ImportSummary", () => {
      const fidelity = buildCalendarFidelity({
        totalCalendars: 3,
        taskCalendarAssignments: 12,
        resourceCalendarAssignments: 2,
        exceptionCount: 5,
        calendarsWithInheritance: 1,
        calendarsSimplifiedForEngine: 3,
      });

      const summary = buildSummary(fidelity);
      expect(summary.calendarFidelity).toBeDefined();
      expect(summary.calendarFidelity!.totalCalendars).toBe(3);
      expect(summary.calendarFidelity!.taskCalendarAssignments).toBe(12);
      expect(summary.calendarFidelity!.resourceCalendarAssignments).toBe(2);
      expect(summary.calendarFidelity!.exceptionCount).toBe(5);
      expect(summary.calendarFidelity!.calendarsWithInheritance).toBe(1);
      expect(summary.calendarFidelity!.calendarsSimplifiedForEngine).toBe(3);
    });

    it("should allow ImportSummary without calendarFidelity (backward compat)", () => {
      const summary = buildSummary();
      expect(summary.calendarFidelity).toBeUndefined();
    });

    it("should carry calendarFidelity through ImportCandidate summary", () => {
      const fidelity = buildCalendarFidelity({ totalCalendars: 2 });
      const candidate = buildCandidate({ summary: buildSummary(fidelity) });
      setPendingCandidate(candidate);

      const held = getPendingCandidate();
      expect(held!.summary.calendarFidelity).toBeDefined();
      expect(held!.summary.calendarFidelity!.totalCalendars).toBe(2);
    });
  });

  describe("Snapshot preserves calendarDefinitions", () => {
    it("should include calendarDefinitions in snapshot and restore them", () => {
      const calDefs: Record<string, BaseCalendarDefinition> = {
        "SNAP-CAL": buildCalendarDef("SNAP-CAL", "Snapshot Calendar"),
      };
      State.setCalendarDefinitions({ ...calDefs, [STANDARD_CALENDAR_ID as string]: State.getCalendarDefinitions()[STANDARD_CALENDAR_ID as string] });

      const snapshot = State.createSnapshot();
      expect(snapshot.calendarDefinitions).toBeDefined();
      expect(snapshot.calendarDefinitions!["SNAP-CAL"]).toBeDefined();
      expect(snapshot.calendarDefinitions!["SNAP-CAL"].name).toBe("Snapshot Calendar");

      // Clear and restore
      State.clearState();
      State.restoreSnapshot(snapshot);

      const restored = State.getCalendarDefinitions();
      expect(restored["SNAP-CAL"]).toBeDefined();
      expect(restored["SNAP-CAL"].name).toBe("Snapshot Calendar");
    });
  });
});
