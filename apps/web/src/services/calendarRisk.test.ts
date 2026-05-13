/**
 * W3D: calendarRisk utility tests
 *
 * Verifies risk classification for all defined levels.
 * Pure logic tests — no DOM.
 */

import type { CalendarFidelitySummary, ImportDiagnostic } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { CALENDAR_DIAGNOSTIC_CODES, classifyCalendarRisk } from "./calendarRisk.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeFidelity(overrides: Partial<CalendarFidelitySummary> = {}): CalendarFidelitySummary {
  return {
    totalCalendars: 3,
    taskCalendarAssignments: 5,
    resourceCalendarAssignments: 2,
    exceptionCount: 4,
    calendarsWithInheritance: 1,
    calendarsSimplifiedForEngine: 0,
    ...overrides,
  };
}

function makeDiag(code: ImportDiagnostic["code"], severity: ImportDiagnostic["severity"] = "info"): ImportDiagnostic {
  return {
    code,
    severity,
    message: `Test diagnostic: ${code}`,
  };
}

// ─── High risk ───────────────────────────────────────────────────

describe("classifyCalendarRisk: high risk", () => {

  it("returns high risk for TASK_CALENDAR_IGNORED_BY_ENGINE", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info")],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("TASK_CALENDAR_IGNORED_BY_ENGINE");
  });

  it("returns high risk for LAG_CALENDAR_PRESERVED_INACTIVE", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("LAG_CALENDAR_PRESERVED_INACTIVE", "info")],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("LAG_CALENDAR_PRESERVED_INACTIVE");
  });

  it("returns high risk for UNRESOLVED_BASE_CALENDAR", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("UNRESOLVED_BASE_CALENDAR", "info")],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("UNRESOLVED_BASE_CALENDAR");
  });

  it("returns high risk for CALENDAR_INHERITANCE_LOOP", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("CALENDAR_INHERITANCE_LOOP", "warning")],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("CALENDAR_INHERITANCE_LOOP");
  });

  it("returns high risk for RESOURCE_CALENDAR_PRESERVED_INACTIVE", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("RESOURCE_CALENDAR_PRESERVED_INACTIVE", "info")],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("RESOURCE_CALENDAR_PRESERVED_INACTIVE");
  });

  it("returns high risk when unresolvedInheritanceCount > 0 (no explicit diag)", () => {
    const result = classifyCalendarRisk(
      makeFidelity({ unresolvedInheritanceCount: 2 }),
      [],
    );
    expect(result.level).toBe("high");
    expect(result.triggerCodes).toContain("UNRESOLVED_BASE_CALENDAR");
  });

  it("high risk reason mentions engine inability", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info")],
    );
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.level).toBe("high");
  });

});

// ─── Medium risk ─────────────────────────────────────────────────

describe("classifyCalendarRisk: medium risk", () => {

  it("returns medium risk for CALENDAR_SIMPLIFIED_FOR_ENGINE", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("CALENDAR_SIMPLIFIED_FOR_ENGINE", "info")],
    );
    expect(result.level).toBe("medium");
    expect(result.triggerCodes).toContain("CALENDAR_SIMPLIFIED_FOR_ENGINE");
  });

  it("returns medium risk for UNSUPPORTED_EXCEPTION_PATTERN", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("UNSUPPORTED_EXCEPTION_PATTERN", "warning")],
    );
    expect(result.level).toBe("medium");
    expect(result.triggerCodes).toContain("UNSUPPORTED_EXCEPTION_PATTERN");
  });

  it("returns medium risk for CALENDAR_HOURS_MISMATCH", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("CALENDAR_HOURS_MISMATCH", "info")],
    );
    expect(result.level).toBe("medium");
    expect(result.triggerCodes).toContain("CALENDAR_HOURS_MISMATCH");
  });

  it("returns medium risk when calendarsSimplifiedForEngine > 0 (no diag)", () => {
    const result = classifyCalendarRisk(
      makeFidelity({ calendarsSimplifiedForEngine: 2 }),
      [],
    );
    expect(result.level).toBe("medium");
  });

});

// ─── Low risk ────────────────────────────────────────────────────

describe("classifyCalendarRisk: low risk", () => {

  it("returns low risk for only CALENDAR_IMPORTED_RICH diagnostic", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [makeDiag("CALENDAR_IMPORTED_RICH", "info")],
    );
    expect(result.level).toBe("low");
    expect(result.triggerCodes).toHaveLength(0);
  });

  it("returns low risk for calendars with inheritance but no problems", () => {
    const result = classifyCalendarRisk(
      makeFidelity({ calendarsWithInheritance: 2, unresolvedInheritanceCount: 0 }),
      [makeDiag("CALENDAR_IMPORTED_RICH", "info")],
    );
    expect(result.level).toBe("low");
  });

  it("returns low risk when no diagnostics but calendars present", () => {
    const result = classifyCalendarRisk(makeFidelity(), []);
    expect(result.level).toBe("low");
  });

});

// ─── None ────────────────────────────────────────────────────────

describe("classifyCalendarRisk: none", () => {

  it("returns none when fidelity is undefined", () => {
    const result = classifyCalendarRisk(undefined, []);
    expect(result.level).toBe("none");
    expect(result.triggerCodes).toHaveLength(0);
  });

  it("returns none when totalCalendars is 0", () => {
    const result = classifyCalendarRisk(
      makeFidelity({ totalCalendars: 0 }),
      [],
    );
    expect(result.level).toBe("none");
  });

});

// ─── Priority: high beats medium ─────────────────────────────────

describe("classifyCalendarRisk: priority rules", () => {

  it("high beats medium when both codes present", () => {
    const result = classifyCalendarRisk(
      makeFidelity(),
      [
        makeDiag("CALENDAR_SIMPLIFIED_FOR_ENGINE", "info"),
        makeDiag("TASK_CALENDAR_IGNORED_BY_ENGINE", "info"),
      ],
    );
    expect(result.level).toBe("high");
  });

});

// ─── CALENDAR_DIAGNOSTIC_CODES set ───────────────────────────────

describe("CALENDAR_DIAGNOSTIC_CODES", () => {

  it("includes all expected calendar diagnostic codes", () => {
    expect(CALENDAR_DIAGNOSTIC_CODES.has("CALENDAR_IMPORTED_RICH")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("CALENDAR_SIMPLIFIED_FOR_ENGINE")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("UNRESOLVED_BASE_CALENDAR")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("UNSUPPORTED_EXCEPTION_PATTERN")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("TASK_CALENDAR_IGNORED_BY_ENGINE")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("RESOURCE_CALENDAR_PRESERVED_INACTIVE")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("LAG_CALENDAR_PRESERVED_INACTIVE")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("CALENDAR_HOURS_MISMATCH")).toBe(true);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("CALENDAR_INHERITANCE_LOOP")).toBe(true);
  });

  it("does not include non-calendar codes", () => {
    expect(CALENDAR_DIAGNOSTIC_CODES.has("CONSTRAINT_APPROXIMATED")).toBe(false);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("MULTI_PROJECT_XER")).toBe(false);
    expect(CALENDAR_DIAGNOSTIC_CODES.has("UNSUPPORTED_ACTUALS")).toBe(false);
  });

});
