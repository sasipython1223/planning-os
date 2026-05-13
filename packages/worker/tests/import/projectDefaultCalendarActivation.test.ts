import type { BaseCalendarDefinition, CalendarId, SourceImportRecord } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_CONFIG } from "../../src/calendarTypes.js";
import { resolveImportedProjectDefaultCalendarActivation } from "../../src/import/projectDefaultCalendarActivation.js";

const buildSourceRecord = (overrides: Partial<SourceImportRecord> = {}): SourceImportRecord => ({
  format: "xer",
  summary: {
    taskCount: 0,
    dependencyCount: 0,
    resourceCount: 0,
    assignmentCount: 0,
    calendarInfo: "",
  },
  diagnostics: [],
  status: "sourceImportedNotCalculated",
  importedAt: new Date().toISOString(),
  ...overrides,
});

describe("resolveImportedProjectDefaultCalendarActivation", () => {
  it("activates imported default calendar when definition exists and has working time", () => {
    const importedCalId = "P6-CAL" as CalendarId;
    const importedCal: BaseCalendarDefinition = {
      id: importedCalId,
      name: "P6 6-Day",
      sourceHoursPerDay: 8,
      weeklyPattern: {
        1: [{ startMinute: 480, endMinute: 1020 }],
        2: [{ startMinute: 480, endMinute: 1020 }],
        3: [{ startMinute: 480, endMinute: 1020 }],
        4: [{ startMinute: 480, endMinute: 1020 }],
        5: [{ startMinute: 480, endMinute: 1020 }],
        6: [{ startMinute: 480, endMinute: 1020 }],
      },
      exceptions: [{ date: "2026-01-12", workIntervals: [] }],
    };

    const result = resolveImportedProjectDefaultCalendarActivation(
      buildSourceRecord({
        sourceProjectSettings: { defaultCalendarId: importedCalId },
        resolvedCalendarDefinitions: { [importedCalId]: importedCal },
      }),
      DEFAULT_CALENDAR_ID,
      DEFAULT_CALENDAR_CONFIG,
      {},
      {},
    );

    expect(result.activated).toBe(true);
    expect(result.calendarId).toBe(importedCalId);
    expect(result.calendarConfig.minutesPerDay).toBe(480);
    expect(result.calendarConfig.workingWeekPattern).toBe("ALL_DAYS");
    expect(result.calendarConfig.holidays).toEqual(["2026-01-12"]);
  });

  it("falls back when imported default calendar id is missing", () => {
    const result = resolveImportedProjectDefaultCalendarActivation(
      buildSourceRecord({ sourceProjectSettings: {} }),
      DEFAULT_CALENDAR_ID,
      DEFAULT_CALENDAR_CONFIG,
      {},
      {},
    );

    expect(result.activated).toBe(false);
    expect(result.calendarId).toBe(DEFAULT_CALENDAR_ID);
    expect(result.calendarConfig).toEqual(DEFAULT_CALENDAR_CONFIG);
    expect(result.reason).toContain("no default calendar id");
  });

  it("falls back when imported default calendar has no working time", () => {
    const importedCalId = "empty" as CalendarId;
    const emptyCal: BaseCalendarDefinition = {
      id: importedCalId,
      name: "Empty",
      weeklyPattern: {},
      exceptions: [],
    };

    const result = resolveImportedProjectDefaultCalendarActivation(
      buildSourceRecord({
        sourceProjectSettings: { defaultCalendarId: importedCalId },
        resolvedCalendarDefinitions: { [importedCalId]: emptyCal },
      }),
      DEFAULT_CALENDAR_ID,
      DEFAULT_CALENDAR_CONFIG,
      {},
      {},
    );

    expect(result.activated).toBe(false);
    expect(result.calendarId).toBe(DEFAULT_CALENDAR_ID);
    expect(result.reason).toContain("no working time");
  });
});
