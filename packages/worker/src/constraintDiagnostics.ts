import type { ConstraintDiagnosticCode, ConstraintType, DiagnosticsMap, ScheduleResultMap, Task } from "protocol";

/**
 * Constraint diagnostics — input-only (Category A) and result-derived (Category B).
 * Derived from canonical task state + schedule results; never persisted.
 * Emits codes only — React maps codes to UI messages/styles.
 */

const DATED_TYPES: ReadonlySet<ConstraintType> = new Set(["SNET", "FNLT", "MSO", "MFO"]);

export function computeConstraintDiagnostics(tasks: readonly Task[]): DiagnosticsMap {
  const map: DiagnosticsMap = {};

  for (const task of tasks) {
    if (task.isSummary) continue;

    const ct = task.constraintType ?? "ASAP";
    const codes: ConstraintDiagnosticCode[] = [];

    if (DATED_TYPES.has(ct) && task.constraintDate == null) {
      codes.push("MISSING_DATE_FOR_CONSTRAINT");
    }

    if (ct === "ALAP" && task.constraintDate != null) {
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
 */
export function mergeResultDiagnostics(
  tasks: readonly Task[],
  scheduleResults: ScheduleResultMap,
  inputDiags: DiagnosticsMap,
  nonWorkingDays?: ReadonlySet<number>,
): DiagnosticsMap {
  const map: DiagnosticsMap = { ...inputDiags };

  for (const task of tasks) {
    if (task.isSummary) continue;

    const ct = task.constraintType ?? "ASAP";
    if (!DATED_TYPES.has(ct)) continue;
    if (task.constraintDate == null) continue;

    const result = scheduleResults[task.id];
    if (!result) continue;

    if (result.totalFloat < 0) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "GENERATING_NEGATIVE_FLOAT"];
    }

    // SNET: superseded when network logic already pushes ES past constraintDate (strict)
    if (ct === "SNET" && result.earlyStart > task.constraintDate!) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_LOGIC"];
    }

    // FNLT: superseded when backward-pass logic already pulls LF before constraintDate (strict)
    if (ct === "FNLT" && result.lateFinish < task.constraintDate!) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_LOGIC"];
    }

    // Calendar displacement: authored date falls on a non-working day
    if (nonWorkingDays && nonWorkingDays.has(task.constraintDate!)) {
      const existing = map[task.id] ?? [];
      map[task.id] = [...existing, "SUPERSEDED_BY_CALENDAR"];
    }
  }

  return map;
}
