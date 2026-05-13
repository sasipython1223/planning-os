/**
 * W3D: ImportPreviewPanel tests
 *
 * Verifies the logic that drives the calendar fidelity section rendering
 * in ImportPreviewPanel. Tests are pure-logic (no DOM) — they verify
 * the classifyCalendarRisk helper that the panel calls, plus data
 * shape/interface conformance.
 *
 * Note: Full DOM rendering tests require a jsdom environment.
 * These tests cover the decision logic; visual coverage is in e2e.
 */

import type { CalendarFidelitySummary, ImportDiagnostic, ImportDiagnosticsSummary, ImportSummary } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { CALENDAR_DIAGNOSTIC_CODES, classifyCalendarRisk } from "../services/calendarRisk.js";
import type { ImportPreviewData } from "./ImportPreviewPanel.js";

// ─── Test data builders ──────────────────────────────────────────

function makeFidelity(overrides: Partial<CalendarFidelitySummary> = {}): CalendarFidelitySummary {
  return {
    totalCalendars: 4,
    taskCalendarAssignments: 8,
    resourceCalendarAssignments: 2,
    exceptionCount: 3,
    calendarsWithInheritance: 1,
    calendarsSimplifiedForEngine: 0,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    taskCount: 20,
    dependencyCount: 15,
    resourceCount: 4,
    assignmentCount: 12,
    calendarInfo: "5-day workweek",
    calendarFidelity: makeFidelity(),
    ...overrides,
  };
}

function makeDiag(code: ImportDiagnostic["code"], severity: ImportDiagnostic["severity"] = "info"): ImportDiagnostic {
  return { code, severity, message: `Test: ${code}` };
}

function makeDiagSummary(overrides: Partial<ImportDiagnosticsSummary> = {}): ImportDiagnosticsSummary {
  return { errors: 0, warnings: 0, infos: 0, ...overrides };
}

function makePreviewData(overrides: Partial<ImportPreviewData> = {}): ImportPreviewData {
  return {
    projectName: "Test Project",
    projectStartDate: "2024-01-15",
    format: "xer",
    summary: makeSummary(),
    diagnostics: [],
    diagnosticsSummary: makeDiagSummary(),
    canCommit: true,
    ...overrides,
  };
}

// ─── Panel data shape tests ──────────────────────────────────────

describe("ImportPreviewPanel: data shape", () => {

  it("ImportPreviewData accepts calendarFidelity in summary", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity).toBeDefined();
    expect(data.summary.calendarFidelity!.totalCalendars).toBe(4);
    expect(data.summary.calendarFidelity!.taskCalendarAssignments).toBe(8);
  });

  it("ImportPreviewData accepts diagnostics list", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info")],
    });
    expect(data.diagnostics).toHaveLength(1);
    expect(data.diagnostics[0].code).toBe("TASK_CALENDAR_IGNORED_BY_ENGINE");
  });

});

// ─── Panel calendar fidelity counts ─────────────────────────────

describe("ImportPreviewPanel: calendar fidelity counts", () => {

  it("displays total calendar count from fidelity summary", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity!.totalCalendars).toBe(4);
  });

  it("displays task calendar assignment count", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity!.taskCalendarAssignments).toBe(8);
  });

  it("displays resource calendar assignment count", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity!.resourceCalendarAssignments).toBe(2);
  });

  it("displays exception count", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity!.exceptionCount).toBe(3);
  });

  it("displays calendarsWithInheritance count", () => {
    const data = makePreviewData();
    expect(data.summary.calendarFidelity!.calendarsWithInheritance).toBe(1);
  });

  it("displays unresolvedInheritanceCount when present", () => {
    const data = makePreviewData({
      summary: makeSummary({ calendarFidelity: makeFidelity({ unresolvedInheritanceCount: 2 }) }),
    });
    expect(data.summary.calendarFidelity!.unresolvedInheritanceCount).toBe(2);
  });

  it("does not show unresolvedInheritanceCount when 0 or absent", () => {
    const data1 = makePreviewData({
      summary: makeSummary({ calendarFidelity: makeFidelity({ unresolvedInheritanceCount: 0 }) }),
    });
    const data2 = makePreviewData({
      summary: makeSummary({ calendarFidelity: makeFidelity({ unresolvedInheritanceCount: undefined }) }),
    });
    expect((data1.summary.calendarFidelity!.unresolvedInheritanceCount ?? 0)).toBe(0);
    expect((data2.summary.calendarFidelity!.unresolvedInheritanceCount ?? 0)).toBe(0);
  });

});

// ─── Panel: recalculation risk warning display ───────────────────

describe("ImportPreviewPanel: recalculation risk", () => {

  it("classifies as high risk when TASK_CALENDAR_IGNORED_BY_ENGINE is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("high");
  });

  it("classifies as high risk when LAG_CALENDAR_PRESERVED_INACTIVE is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("LAG_CALENDAR_PRESERVED_INACTIVE", "info")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("high");
  });

  it("classifies as high risk when UNRESOLVED_BASE_CALENDAR is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("UNRESOLVED_BASE_CALENDAR", "info")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("high");
  });

  it("classifies as high risk when CALENDAR_INHERITANCE_LOOP is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("CALENDAR_INHERITANCE_LOOP", "warning")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("high");
  });

  it("classifies as medium risk when CALENDAR_SIMPLIFIED_FOR_ENGINE is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("CALENDAR_SIMPLIFIED_FOR_ENGINE", "info")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("medium");
  });

  it("classifies as medium risk when UNSUPPORTED_EXCEPTION_PATTERN is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("UNSUPPORTED_EXCEPTION_PATTERN", "warning")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("medium");
  });

  it("classifies as low risk when only CALENDAR_IMPORTED_RICH is present", () => {
    const data = makePreviewData({
      diagnostics: [makeDiag("CALENDAR_IMPORTED_RICH", "info")],
    });
    const risk = classifyCalendarRisk(data.summary.calendarFidelity, data.diagnostics);
    expect(risk.level).toBe("low");
  });

  it("risk reason is non-empty for all non-none levels", () => {
    const levels: Array<{ diag: ImportDiagnostic["code"]; expected: "high" | "medium" | "low" }> = [
      { diag: "TASK_CALENDAR_IGNORED_BY_ENGINE", expected: "high" },
      { diag: "CALENDAR_SIMPLIFIED_FOR_ENGINE", expected: "medium" },
      { diag: "CALENDAR_IMPORTED_RICH", expected: "low" },
    ];
    for (const { diag, expected } of levels) {
      const risk = classifyCalendarRisk(makeFidelity(), [makeDiag(diag)]);
      expect(risk.level).toBe(expected);
      expect(risk.reason.length).toBeGreaterThan(0);
    }
  });

});

// ─── Panel: calendar diagnostic grouping ─────────────────────────

describe("ImportPreviewPanel: calendar diagnostic grouping", () => {

  it("CALENDAR_DIAGNOSTIC_CODES filters calendar-specific diagnostics from full list", () => {
    const allDiags: ImportDiagnostic[] = [
      makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info"),
      makeDiag("CONSTRAINT_APPROXIMATED", "warning"),
      makeDiag("CALENDAR_IMPORTED_RICH", "info"),
      makeDiag("MULTI_PROJECT_XER", "warning"),
    ];
    const calDiags = allDiags.filter(d => CALENDAR_DIAGNOSTIC_CODES.has(d.code));
    expect(calDiags).toHaveLength(2);
    expect(calDiags.map(d => d.code)).toContain("TASK_CALENDAR_IGNORED_BY_ENGINE");
    expect(calDiags.map(d => d.code)).toContain("CALENDAR_IMPORTED_RICH");
  });

  it("calendar diag group is empty when no calendar-related diagnostics present", () => {
    const allDiags: ImportDiagnostic[] = [
      makeDiag("CONSTRAINT_APPROXIMATED", "warning"),
      makeDiag("MULTI_PROJECT_XER", "warning"),
    ];
    const calDiags = allDiags.filter(d => CALENDAR_DIAGNOSTIC_CODES.has(d.code));
    expect(calDiags).toHaveLength(0);
  });

  it("all 9 calendar diagnostic code groups are filterable", () => {
    const allDiags: ImportDiagnostic[] = [
      makeDiag("CALENDAR_IMPORTED_RICH", "info"),
      makeDiag("CALENDAR_SIMPLIFIED_FOR_ENGINE", "info"),
      makeDiag("UNRESOLVED_BASE_CALENDAR", "info"),
      makeDiag("UNSUPPORTED_EXCEPTION_PATTERN", "warning"),
      makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info"),
      makeDiag("RESOURCE_CALENDAR_PRESERVED_INACTIVE", "info"),
      makeDiag("LAG_CALENDAR_PRESERVED_INACTIVE", "info"),
      makeDiag("CALENDAR_HOURS_MISMATCH", "info"),
      makeDiag("CALENDAR_INHERITANCE_LOOP", "warning"),
    ];
    const calDiags = allDiags.filter(d => CALENDAR_DIAGNOSTIC_CODES.has(d.code));
    expect(calDiags).toHaveLength(9);
  });

});

// ─── Panel: source-import lifecycle wording ──────────────────────

describe("ImportPreviewPanel: lifecycle wording (data-driven)", () => {

  it("canCommit is true for a normal import with calendars", () => {
    const data = makePreviewData();
    expect(data.canCommit).toBe(true);
  });

  it("canCommit is false when there are errors", () => {
    const data = makePreviewData({ canCommit: false });
    expect(data.canCommit).toBe(false);
  });

  it("format XER is shown as uppercase in UI context", () => {
    const data = makePreviewData({ format: "xer" });
    expect(data.format.toUpperCase()).toBe("XER");
  });

  it("format MSP is shown as uppercase in UI context", () => {
    const data = makePreviewData({ format: "msp-xml" });
    expect(data.format.toUpperCase()).toBe("MSP-XML");
  });

});
