import { MINUTES_PER_DAY, type ConstraintDiagnosticCode, type ConstraintType, type DiagnosticsMap, type ScheduleResultMap, type Task } from "@planner/protocol";
import type { CalendarOutputContext } from "./rollup.js";
import { daySlotToProjectInstant, getWorkingDayDefinition } from "./workingTimeEngine.js";

/**
 * Constraint diagnostics — input-only (Category A) and result-derived (Category B).
 * Derived from canonical task state + schedule results; never persisted.
 * Emits codes only — React maps codes to UI messages/styles.
 */

const DATED_TYPES: ReadonlySet<ConstraintType> = new Set(["SNET", "FNLT", "MSO", "MFO"]);

export function computeConstraintDiagnostics(tasks: readonly Task[]): DiagnosticsMap {
  const map: DiagnosticsMap = {};

  // Derive summary set from parentId relationships
  const summaryIds = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) summaryIds.add(t.parentId);
  }

  for (const task of tasks) {
    if (summaryIds.has(task.id)) continue;

    const ct = task.constraintType ?? "ASAP";
    const codes: ConstraintDiagnosticCode[] = [];

    if (DATED_TYPES.has(ct) && task.constraintDateMinutes == null) {
      codes.push("MISSING_DATE_FOR_CONSTRAINT");
    }

    if (ct === "ALAP" && task.constraintDateMinutes != null) {
      codes.push("DATE_IGNORED_BY_MODE");
    }

    if (codes.length > 0) {
      map[task.id] = codes;
    }
  }

  return map;
}

/**
 * Category B — result-derived constraint diagnostics.
 * Merges into an existing DiagnosticsMap (from Category A input diagnostics).
 * Only available when schedule results exist (success path).
 *
 * D6a: minutesPerDay is a required plain number. This function no longer
 * depends on KernelTemporalAdapter or MINUTES_PER_DAY — the caller
 * (worker.ts) extracts the value from calendar services.
 */
export function mergeResultDiagnostics(
  tasks: readonly Task[],
  scheduleResults: ScheduleResultMap,
  inputDiags: DiagnosticsMap,
  nonWorkingDays?: ReadonlySet<number>,
  minutesPerDay: number = 480,
  calendarContext?: CalendarOutputContext,
): DiagnosticsMap {
  const map: DiagnosticsMap = { ...inputDiags };

  // Derive summary set from parentId relationships
  const summaryIds2 = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) summaryIds2.add(t.parentId);
  }

  for (const task of tasks) {
    if (summaryIds2.has(task.id)) continue;

    const ct = task.constraintType ?? "ASAP";
    if (!DATED_TYPES.has(ct)) continue;
    if (task.constraintDateMinutes == null) continue;

    const result = scheduleResults[task.id];
    if (!result) continue;

    // OUTPUT-SIDE comparison: schedule results are in project day-offset units.
    // When calendarContext is present, interpret the authored constraint date
    // using canonical project-day storage (MINUTES_PER_DAY) and let the
    // compiled project calendar classify the target date. Without context,
    // preserve the existing scalar fallback based on minutesPerDay.
    const constraintDaySlot = calendarContext
      ? Math.round(task.constraintDateMinutes / MINUTES_PER_DAY)
      : Math.round(task.constraintDateMinutes / minutesPerDay);

    if (result.totalFloatMinutes < 0) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "GENERATING_NEGATIVE_FLOAT"];
    }

    // SNET: superseded when network logic already pushes ES past constraintDate (strict)
    if (ct === "SNET" && result.earlyStartMinutes > constraintDaySlot) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_LOGIC"];
    }

    // FNLT: superseded when backward-pass logic already pulls LF before constraintDate (strict)
    if (ct === "FNLT" && result.lateFinishMinutes < constraintDaySlot) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_LOGIC"];
    }

    // Calendar displacement: authored date falls on a non-working day.
    const supersededByCalendar = calendarContext
      ? !getWorkingDayDefinition(
        calendarContext.calendar,
        daySlotToProjectInstant(
          calendarContext.projectStartDate,
          constraintDaySlot,
          calendarContext.calendar,
        ).date,
      ).isWorking
      : !!nonWorkingDays?.has(constraintDaySlot);

    if (supersededByCalendar) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_CALENDAR"];
    }
  }

  return map;
}
