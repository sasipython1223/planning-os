/**
 * @module calendarRisk
 *
 * W3D: Calendar Import Risk Classification
 *
 * Pure, stateless utility that classifies the calendar recalculation risk
 * for an imported schedule based on fidelity summary and diagnostics.
 *
 * Risk levels:
 *   "none"   – no calendars imported at all
 *   "low"    – calendars imported rich, no inactive/unsupported issues
 *   "medium" – calendars simplified or have unsupported exceptions/hour mismatches
 *   "high"   – task/resource/lag calendars ignored by engine, or inheritance issues
 *
 * SCHEDULING-NEUTRAL: output is display/UI data only. Nothing here influences
 * scheduling or the CPM kernel.
 */

import type { CalendarFidelitySummary, ImportDiagnostic, ImportDiagnosticCode } from "@planner/protocol";

// ─── Types ────────────────────────────────────────────────────────

export type CalendarRiskLevel = "none" | "low" | "medium" | "high";

export type CalendarRiskResult = {
  readonly level: CalendarRiskLevel;
  /** Human-readable summary of why this risk level was assigned. */
  readonly reason: string;
  /** Diagnostic codes that contributed to a high or medium classification. */
  readonly triggerCodes: readonly ImportDiagnosticCode[];
};

// ─── Classification rules ─────────────────────────────────────────

const HIGH_RISK_CODES: readonly ImportDiagnosticCode[] = [
  "TASK_CALENDAR_IGNORED_BY_ENGINE",
  "LAG_CALENDAR_PRESERVED_INACTIVE",
  "UNRESOLVED_BASE_CALENDAR",
  "CALENDAR_INHERITANCE_LOOP",
  "RESOURCE_CALENDAR_PRESERVED_INACTIVE",
];

const MEDIUM_RISK_CODES: readonly ImportDiagnosticCode[] = [
  "CALENDAR_SIMPLIFIED_FOR_ENGINE",
  "UNSUPPORTED_EXCEPTION_PATTERN",
  "CALENDAR_HOURS_MISMATCH",
  "CALENDAR_SIMPLIFIED",
];

// ─── Main classifier ─────────────────────────────────────────────

/**
 * Classify calendar recalculation risk from fidelity summary and diagnostics.
 *
 * @param fidelity  CalendarFidelitySummary from ImportSummary (may be undefined)
 * @param diagnostics  Full diagnostic array from the import
 */
export function classifyCalendarRisk(
  fidelity: CalendarFidelitySummary | undefined,
  diagnostics: readonly ImportDiagnostic[],
): CalendarRiskResult {
  // No calendars at all
  if (!fidelity || fidelity.totalCalendars === 0) {
    return { level: "none", reason: "No calendars imported.", triggerCodes: [] };
  }

  const presentCodes = new Set(diagnostics.map(d => d.code));

  // High risk: any code that directly signals engine cannot honour the calendar
  const highTriggers = HIGH_RISK_CODES.filter(c => presentCodes.has(c));
  if (highTriggers.length > 0) {
    return {
      level: "high",
      reason: "Recalculation dates may differ significantly — one or more calendars cannot be applied by the engine.",
      triggerCodes: highTriggers,
    };
  }

  // Also high if unresolved inheritance count is non-zero
  if (
    fidelity.unresolvedInheritanceCount !== undefined &&
    fidelity.unresolvedInheritanceCount > 0
  ) {
    return {
      level: "high",
      reason: `${fidelity.unresolvedInheritanceCount} calendar(s) have unresolved inheritance — recalculation dates may differ.`,
      triggerCodes: ["UNRESOLVED_BASE_CALENDAR"],
    };
  }

  // Medium risk
  const mediumTriggers = MEDIUM_RISK_CODES.filter(c => presentCodes.has(c));
  if (mediumTriggers.length > 0) {
    return {
      level: "medium",
      reason: "Calendars imported with simplifications — minor date variance possible if recalculated.",
      triggerCodes: mediumTriggers,
    };
  }

  // Also medium if any calendars were simplified for engine (fidelity field)
  if (fidelity.calendarsSimplifiedForEngine > 0) {
    return {
      level: "medium",
      reason: `${fidelity.calendarsSimplifiedForEngine} calendar(s) simplified for engine — minor date variance possible if recalculated.`,
      triggerCodes: [],
    };
  }

  // Low: calendars imported rich, no known issues
  return {
    level: "low",
    reason: "Calendars imported. Planner-Studio recalculation does not yet use all task/resource/lag calendars — minor date variance possible.",
    triggerCodes: [],
  };
}

// ─── Display helpers ──────────────────────────────────────────────

export const RISK_LEVEL_LABEL: Record<CalendarRiskLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Tailored badge colour for each risk level (CSS colour strings). */
export const RISK_LEVEL_COLOR: Record<CalendarRiskLevel, string> = {
  none: "#888",
  low: "#2e7d32",
  medium: "#ed6c02",
  high: "#d32f2f",
};

/** Planner-facing calendar diagnostic codes that are surfaced in the grouped summary. */
export const CALENDAR_DIAGNOSTIC_CODES = new Set<ImportDiagnosticCode>([
  "CALENDAR_IMPORTED_RICH",
  "CALENDAR_SIMPLIFIED_FOR_ENGINE",
  "UNRESOLVED_BASE_CALENDAR",
  "UNSUPPORTED_EXCEPTION_PATTERN",
  "TASK_CALENDAR_IGNORED_BY_ENGINE",
  "RESOURCE_CALENDAR_PRESERVED_INACTIVE",
  "LAG_CALENDAR_PRESERVED_INACTIVE",
  "CALENDAR_HOURS_MISMATCH",
  "CALENDAR_INHERITANCE_LOOP",
]);
