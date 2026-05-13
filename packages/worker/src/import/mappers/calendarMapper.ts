/**
 * @module calendarMapper
 *
 * Calendar Extraction Utilities — W3B
 *
 * Shared helpers for extracting BaseCalendarDefinition records from
 * XER and MSP source data. Pure functions — no state mutation.
 *
 * ⚠️ SCHEDULING-NEUTRAL — output is sidecar data only.
 * Nothing in this module is read by the CPM kernel or scheduling pipeline.
 */

import type {
    BaseCalendarDefinition,
    CalendarDateException,
    CalendarFidelitySummary,
    CalendarId,
    DayOfWeek,
    ImportDiagnostic,
    TimeInterval,
    WeeklyWorkPattern,
} from "@planner/protocol";
import type { MspCalendar } from "../types/mspTypes.js";
import type { XerCalendar } from "../types/xerTypes.js";

// ─── XER Calendar Parsing ───────────────────────────────────────────

/**
 * Parse a time string "H:mm" or "HH:mm" into minutes since midnight.
 * Returns undefined if unparseable.
 */
function parseTimeToMinutes(timeStr: string): number | undefined {
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return undefined;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  return h * 60 + m;
}

/**
 * Parse a P6 XER clndr_data string into working time intervals and a
 * weekly pattern. Returns null if the format is too complex to parse safely.
 *
 * The clndr_data format is:
 *   (type||hoursPerDay|(dayIndex||timeStart1|timeEnd1|timeStart2|timeEnd2)(dayIndex||...)...)
 *
 * Day indices: 0=Sun, 1=Mon, ..., 6=Sat (same as JS Date.getDay()).
 * Non-working days have empty time blocks: (dayIndex||)
 *
 * Example: "(0||8|(0|0:00|)(1|8:00|17:00)(2|8:00|17:00)(3|8:00|17:00)(4|8:00|17:00)(5|8:00|17:00)(6|0:00|))"
 */
export function parseXerClndrData(clndrData: string): {
  weeklyPattern: WeeklyWorkPattern;
  hoursPerDay: number;
} | null {
  if (!clndrData) return null;

  try {
    // The outer wrapper is: (type||hoursPerDay|(day blocks))
    // Extract all day blocks: (dayIndex|...) — note: format varies, some use || some |
    const dayBlockRegex = /\((\d)\|+([^)]*)\)/g;
    const weeklyPattern: Record<number, TimeInterval[]> = {};
    let parsed = false;

    let match: RegExpExecArray | null;
    while ((match = dayBlockRegex.exec(clndrData)) !== null) {
      const dayIndex = parseInt(match[1], 10);
      if (dayIndex < 0 || dayIndex > 6) continue;

      const innerParts = match[2].split("|").filter(s => s.trim() !== "");

      if (innerParts.length === 0) {
        // Non-working day: empty block
        // Don't add to weeklyPattern (absence = non-working)
        parsed = true;
        continue;
      }

      // Must have pairs of times
      if (innerParts.length % 2 !== 0) continue;

      const intervals: TimeInterval[] = [];
      for (let i = 0; i < innerParts.length; i += 2) {
        const start = parseTimeToMinutes(innerParts[i]);
        const end = parseTimeToMinutes(innerParts[i + 1]);
        if (start === undefined || end === undefined || end <= start) continue;
        intervals.push({ startMinute: start, endMinute: end });
      }

      if (intervals.length > 0) {
        weeklyPattern[dayIndex as DayOfWeek] = intervals;
        parsed = true;
      }
    }

    if (!parsed) return null;

    // Extract hoursPerDay from the outer block: (type||hoursPerDay|...)
    let hoursPerDay = 8;
    const outerMatch = clndrData.match(/^\((\d+)\|+(\d+(?:\.\d+)?)\|/);
    if (outerMatch) {
      const parsed = parseFloat(outerMatch[2]);
      if (Number.isFinite(parsed) && parsed > 0) hoursPerDay = parsed;
    }

    return { weeklyPattern: weeklyPattern as WeeklyWorkPattern, hoursPerDay };
  } catch {
    return null;
  }
}

function parseFinitePositive(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function inferWorkingDayCountFromName(name: string): number | undefined {
  const normalized = name.toLowerCase();
  const m = normalized.match(/\b([567])\s*(?:d|day|days)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function inferredIntervalsForHours(dayHours: number): readonly TimeInterval[] {
  const minutes = Math.max(0, Math.round(dayHours * 60));
  if (minutes <= 0) return [];
  // Inference only needs period totals for display; avoid claiming parsed shift breaks.
  return [{ startMinute: 0, endMinute: Math.min(1440, minutes) }];
}

function inferWeeklyPatternFromPeriodHours(
  hoursPerDay: number | undefined,
  hoursPerWeek: number | undefined,
  calendarName: string,
): { pattern: WeeklyWorkPattern; source: "inferred-hours" | "inferred-name" } | null {
  let dayCount: number | undefined;

  if (hoursPerDay !== undefined && hoursPerWeek !== undefined && hoursPerDay > 0) {
    const ratio = hoursPerWeek / hoursPerDay;
    const rounded = Math.round(ratio);
    if (rounded >= 1 && rounded <= 7 && Math.abs(ratio - rounded) <= 0.25) {
      dayCount = rounded;
    }
  }

  let source: "inferred-hours" | "inferred-name" = "inferred-hours";
  if (dayCount === undefined) {
    const fromName = inferWorkingDayCountFromName(calendarName);
    if (fromName !== undefined) {
      dayCount = fromName;
      source = "inferred-name";
    }
  }

  if (dayCount === undefined || dayCount < 1 || dayCount > 7) return null;

  const perDay = hoursPerDay ?? (hoursPerWeek !== undefined ? hoursPerWeek / dayCount : undefined);
  if (perDay === undefined || perDay <= 0) return null;

  const intervals = inferredIntervalsForHours(perDay);
  if (!intervals.length) return null;

  const pattern: Partial<Record<DayOfWeek, readonly TimeInterval[]>> = {};
  if (dayCount === 7) {
    for (let d = 0; d <= 6; d++) {
      pattern[d as DayOfWeek] = intervals;
    }
  } else if (dayCount === 6) {
    for (let d = 1; d <= 6; d++) {
      pattern[d as DayOfWeek] = intervals;
    }
  } else {
    // Conservative default: Mon..Fri for 5-day and lower patterns.
    for (let d = 1; d <= Math.min(5, dayCount); d++) {
      pattern[d as DayOfWeek] = intervals;
    }
  }

  return { pattern: pattern as WeeklyWorkPattern, source };
}

/**
 * Map XER calendars to BaseCalendarDefinition records.
 * Returns the definitions keyed by CalendarId (branded from clndr_id),
 * plus diagnostics and a partial fidelity summary.
 */
export function mapXerCalendars(
  xerCalendars: readonly XerCalendar[],
  clndrIdToCanonical: Map<string, CalendarId>,
): {
  calendarDefinitions: Record<CalendarId, BaseCalendarDefinition>;
  diagnostics: ImportDiagnostic[];
  calendarsWithInheritance: number;
  calendarsSimplifiedForEngine: number;
} {
  const calendarDefinitions: Record<CalendarId, BaseCalendarDefinition> = {} as Record<CalendarId, BaseCalendarDefinition>;
  const diagnostics: ImportDiagnostic[] = [];
  let calendarsWithInheritance = 0;
  let calendarsSimplifiedForEngine = 0;

  for (const xc of xerCalendars) {
    const calId = (xc.clndr_id) as CalendarId;
    clndrIdToCanonical.set(xc.clndr_id, calId);

    const parsed = parseXerClndrData(xc.clndr_data);
    const sourceHoursPerDay = parseFinitePositive(xc.day_hr_cnt) ?? parsed?.hoursPerDay;
    const sourceHoursPerWeek = parseFinitePositive(xc.week_hr_cnt);
    const sourceHoursPerMonth = parseFinitePositive(xc.month_hr_cnt);
    const sourceHoursPerYear = parseFinitePositive(xc.year_hr_cnt);
    const sourceCalendarType =
      xc.clndr_type === "0" ? "global"
      : xc.clndr_type === "1" ? "resource"
      : xc.clndr_type === "2" ? "project"
      : (xc.clndr_type ? "unknown" : undefined);
    const hasInheritance = Boolean(xc.base_clndr_id && xc.base_clndr_id !== xc.clndr_id && xc.base_clndr_id !== "");
    if (hasInheritance) calendarsWithInheritance++;

    if (parsed && Object.keys(parsed.weeklyPattern).length > 0) {
      // Successfully parsed rich weekly pattern
      calendarDefinitions[calId] = {
        id: calId,
        name: xc.clndr_name || `Calendar ${xc.clndr_id}`,
        sourceCalendarType,
        sourceHoursPerDay,
        sourceHoursPerWeek,
        sourceHoursPerMonth,
        sourceHoursPerYear,
        workingPatternSource: "parsed",
        weeklyPattern: parsed.weeklyPattern,
        exceptions: [], // XER exception parsing deferred to W3C
        parentCalendarId: hasInheritance ? (xc.base_clndr_id as CalendarId) : undefined,
      };
      diagnostics.push({
        code: "CALENDAR_IMPORTED_RICH",
        severity: "info",
        message: `Calendar "${xc.clndr_name}" (ID: ${xc.clndr_id}) preserved with working-time pattern`,
        sourceEntityId: xc.clndr_id,
        field: "clndr_data",
      });
    } else {
      const inferred = inferWeeklyPatternFromPeriodHours(
        sourceHoursPerDay,
        sourceHoursPerWeek,
        xc.clndr_name || "",
      );

      // Fallback: preserve calendar; if possible infer a weekly pattern from period totals.
      calendarDefinitions[calId] = {
        id: calId,
        name: xc.clndr_name || `Calendar ${xc.clndr_id}`,
        sourceCalendarType,
        sourceHoursPerDay,
        sourceHoursPerWeek,
        sourceHoursPerMonth,
        sourceHoursPerYear,
        workingPatternSource: inferred?.source ?? "none",
        weeklyPattern: inferred?.pattern ?? {},
        exceptions: [],
        parentCalendarId: hasInheritance ? (xc.base_clndr_id as CalendarId) : undefined,
      };
      calendarsSimplifiedForEngine++;
      const inferredSuffix = inferred
        ? inferred.source === "inferred-hours"
          ? "; inferred weekly hours from hours/day and hours/week"
          : "; inferred weekly hours from calendar name hint"
        : "";
      diagnostics.push({
        code: "CALENDAR_SIMPLIFIED_FOR_ENGINE",
        severity: "info",
        message: `Calendar "${xc.clndr_name}" (ID: ${xc.clndr_id}) preserved — clndr_data format not fully parsed, engine uses project default${inferredSuffix}`,
        sourceEntityId: xc.clndr_id,
        field: "clndr_data",
      });
    }

    if (hasInheritance) {
      diagnostics.push({
        code: "UNRESOLVED_BASE_CALENDAR",
        severity: "info",
        message: `Calendar "${xc.clndr_name}" references base calendar ID ${xc.base_clndr_id} — inheritance not yet resolved`,
        sourceEntityId: xc.clndr_id,
        field: "base_clndr_id",
        originalValue: xc.base_clndr_id,
      });
    }
  }

  return { calendarDefinitions, diagnostics, calendarsWithInheritance, calendarsSimplifiedForEngine };
}

// ─── MSP Calendar Parsing ───────────────────────────────────────────

/**
 * Parse an MSP time string "HH:mm:ss" into minutes since midnight.
 */
function parseMspTimeToMinutes(timeStr: string): number | undefined {
  if (!timeStr) return undefined;
  const parts = timeStr.split(":");
  if (parts.length < 2) return undefined;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  return h * 60 + m;
}

/**
 * MSP DayType → JS DayOfWeek (0=Sun..6=Sat).
 * MSP: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
 */
function mspDayTypeToJsDayOfWeek(dayType: string): DayOfWeek | undefined {
  const n = parseInt(dayType, 10);
  if (n < 1 || n > 7) return undefined;
  return ((n - 1) % 7) as DayOfWeek; // 1→0(Sun), 2→1(Mon),...,7→6(Sat)
}

/**
 * Map MSP calendars to BaseCalendarDefinition records.
 * Returns definitions keyed by CalendarId (branded from MSP UID),
 * plus diagnostics and fidelity summary fields.
 */
export function mapMspCalendars(mspCalendars: readonly MspCalendar[]): {
  calendarDefinitions: Record<CalendarId, BaseCalendarDefinition>;
  calUidToCalendarId: Map<string, CalendarId>;
  diagnostics: ImportDiagnostic[];
  calendarsWithInheritance: number;
  calendarsSimplifiedForEngine: number;
  totalExceptionCount: number;
} {
  const calendarDefinitions: Record<CalendarId, BaseCalendarDefinition> = {} as Record<CalendarId, BaseCalendarDefinition>;
  const calUidToCalendarId = new Map<string, CalendarId>();
  const diagnostics: ImportDiagnostic[] = [];
  let calendarsWithInheritance = 0;
  let calendarsSimplifiedForEngine = 0;
  let totalExceptionCount = 0;

  for (const mc of mspCalendars) {
    if (!mc.uid) continue;
    const calId = mc.uid as CalendarId;
    calUidToCalendarId.set(mc.uid, calId);

    // ── Weekly pattern ──────────────────────────────────────────
    const weeklyPattern: Record<number, TimeInterval[]> = {};
    for (const wd of mc.weekDays) {
      const jsDay = mspDayTypeToJsDayOfWeek(wd.dayType);
      if (jsDay === undefined) continue;
      if (wd.dayWorking === "0") {
        // Non-working day: omit from pattern (absence = non-working)
        continue;
      }
      const intervals: TimeInterval[] = [];
      for (const wt of wd.workingTimes) {
        const start = parseMspTimeToMinutes(wt.fromTime);
        const end = parseMspTimeToMinutes(wt.toTime);
        if (start !== undefined && end !== undefined && end > start) {
          intervals.push({ startMinute: start, endMinute: end });
        }
      }
      if (intervals.length > 0) {
        weeklyPattern[jsDay] = intervals;
      }
    }

    // ── Exceptions ─────────────────────────────────────────────
    const exceptions: CalendarDateException[] = [];
    for (const ex of mc.exceptions) {
      // Only handle non-recurring, single-date exceptions safely
      const isRecurring = ex.enteredByOccurrences === "1" || (ex.type && ex.type !== "0" && ex.type !== "1");
      if (isRecurring) {
        diagnostics.push({
          code: "UNSUPPORTED_EXCEPTION_PATTERN",
          severity: "info",
          message: `Calendar "${mc.name}" has a recurring exception — preserved as raw, not expanded`,
          sourceEntityId: mc.uid,
          field: "Exception",
          originalValue: ex.name ?? ex.fromDate,
        });
        continue;
      }

      if (!ex.fromDate) continue;
      const datePart = ex.fromDate.split("T")[0];
      if (!datePart) continue;

      // Build working time intervals for this exception day
      const exIntervals: TimeInterval[] = [];
      for (const wt of ex.workingTimes) {
        const start = parseMspTimeToMinutes(wt.fromTime);
        const end = parseMspTimeToMinutes(wt.toTime);
        if (start !== undefined && end !== undefined && end > start) {
          exIntervals.push({ startMinute: start, endMinute: end });
        }
      }

      exceptions.push({
        date: datePart,
        workIntervals: exIntervals, // empty array = non-working
        name: ex.name,
      });
      totalExceptionCount++;
    }

    // ── Inheritance ─────────────────────────────────────────────
    const hasInheritance = mc.baseCalendarUID && mc.baseCalendarUID !== "-1" && mc.baseCalendarUID !== "";
    if (hasInheritance) {
      calendarsWithInheritance++;
      diagnostics.push({
        code: "UNRESOLVED_BASE_CALENDAR",
        severity: "info",
        message: `Calendar "${mc.name}" inherits from base UID ${mc.baseCalendarUID} — inheritance not yet resolved`,
        sourceEntityId: mc.uid,
        field: "BaseCalendarUID",
        originalValue: mc.baseCalendarUID,
      });
    }

    const hasRichData = Object.keys(weeklyPattern).length > 0 || exceptions.length > 0;

    calendarDefinitions[calId] = {
      id: calId,
      name: mc.name || `Calendar ${mc.uid}`,
      weeklyPattern: weeklyPattern as WeeklyWorkPattern,
      exceptions,
      parentCalendarId: hasInheritance ? (mc.baseCalendarUID as CalendarId) : undefined,
    };

    if (hasRichData) {
      diagnostics.push({
        code: "CALENDAR_IMPORTED_RICH",
        severity: "info",
        message: `Calendar "${mc.name}" (UID: ${mc.uid}) preserved with ${Object.keys(weeklyPattern).length} working days and ${exceptions.length} exception(s)`,
        sourceEntityId: mc.uid,
        field: "WeekDays",
      });
    } else {
      calendarsSimplifiedForEngine++;
      diagnostics.push({
        code: "CALENDAR_SIMPLIFIED_FOR_ENGINE",
        severity: "info",
        message: `Calendar "${mc.name}" (UID: ${mc.uid}) preserved but contains no working-time data — engine uses project default`,
        sourceEntityId: mc.uid,
      });
    }
  }

  return {
    calendarDefinitions,
    calUidToCalendarId,
    diagnostics,
    calendarsWithInheritance,
    calendarsSimplifiedForEngine,
    totalExceptionCount,
  };
}

// ─── Fidelity Summary Builder ───────────────────────────────────────

/** Build CalendarFidelitySummary from extracted counts. */
export function buildCalendarFidelitySummary(opts: {
  totalCalendars: number;
  taskCalendarAssignments: number;
  resourceCalendarAssignments: number;
  exceptionCount: number;
  calendarsWithInheritance: number;
  calendarsSimplifiedForEngine: number;
  unresolvedInheritanceCount?: number;
}): CalendarFidelitySummary {
  return {
    totalCalendars: opts.totalCalendars,
    taskCalendarAssignments: opts.taskCalendarAssignments,
    resourceCalendarAssignments: opts.resourceCalendarAssignments,
    exceptionCount: opts.exceptionCount,
    calendarsWithInheritance: opts.calendarsWithInheritance,
    calendarsSimplifiedForEngine: opts.calendarsSimplifiedForEngine,
    unresolvedInheritanceCount: opts.unresolvedInheritanceCount,
  };
}
