import type {
    DiagnosticsMap,
    ImportDiagnostic,
    ScheduleResultMap,
    SourceCalculatedVarianceReport,
    SourceTaskDates,
    Task,
    TaskDateVariance,
    VarianceSeverity,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";

const MAJOR_VARIANCE_THRESHOLD = MINUTES_PER_DAY * 5;

const CALENDAR_IMPORT_CODES = new Set([
  "CALENDAR_SIMPLIFIED",
  "CALENDAR_SIMPLIFIED_FOR_ENGINE",
  "UNRESOLVED_BASE_CALENDAR",
  "UNSUPPORTED_EXCEPTION_PATTERN",
  "TASK_CALENDAR_IGNORED_BY_ENGINE",
  "RESOURCE_CALENDAR_PRESERVED_INACTIVE",
  "LAG_CALENDAR_PRESERVED_INACTIVE",
  "CALENDAR_HOURS_MISMATCH",
  "CALENDAR_INHERITANCE_LOOP",
] as const);

const CONSTRAINT_DIAGNOSTICS = new Set([
  "MISSING_DATE_FOR_CONSTRAINT",
  "DATE_IGNORED_BY_MODE",
  "GENERATING_NEGATIVE_FLOAT",
  "SUPERSEDED_BY_LOGIC",
  "SUPERSEDED_BY_CALENDAR",
] as const);

/**
 * ScheduleResultMap offsets are day-based in current projection output while
 * source import offsets are minute-based. For reporting, normalize calculated
 * values into minute space by choosing the interpretation closest to source.
 */
const normalizeCalculatedOffsetToSourceMinutes = (
  calculatedOffset: number,
  sourceOffset: number,
): number => {
  const asMinutes = Math.round(calculatedOffset * MINUTES_PER_DAY);
  const diffAsMinutes = Math.abs(asMinutes - sourceOffset);
  const diffAsRaw = Math.abs(calculatedOffset - sourceOffset);
  return diffAsMinutes <= diffAsRaw ? asMinutes : calculatedOffset;
};

const toSeverity = (magnitude: number): VarianceSeverity => {
  if (magnitude === 0) return "none";
  if (magnitude < MINUTES_PER_DAY) return "minor";
  if (magnitude <= MAJOR_VARIANCE_THRESHOLD) return "moderate";
  return "major";
};

export function computeSourceVarianceReport(
  tasks: readonly Task[],
  scheduleResults: ScheduleResultMap,
  sourceDatesByTaskId: Readonly<Record<string, SourceTaskDates>>,
  diagnosticsMap: DiagnosticsMap,
  importDiagnostics: readonly ImportDiagnostic[],
): SourceCalculatedVarianceReport {
  const taskVariances: TaskDateVariance[] = [];

  for (const task of tasks) {
    const sourceDates = sourceDatesByTaskId[task.id];
    const calculated = scheduleResults[task.id];
    if (!sourceDates || !calculated) continue;

    const hasSourceStart = sourceDates.sourceStartMinutes !== undefined;
    const hasSourceFinish = sourceDates.sourceFinishMinutes !== undefined;
    if (!hasSourceStart && !hasSourceFinish) continue;

    const calculatedStartMinutes = hasSourceStart
      ? normalizeCalculatedOffsetToSourceMinutes(calculated.earlyStartMinutes, sourceDates.sourceStartMinutes!)
      : undefined;
    const calculatedFinishMinutes = hasSourceFinish
      ? normalizeCalculatedOffsetToSourceMinutes(calculated.earlyFinishMinutes, sourceDates.sourceFinishMinutes!)
      : undefined;

    const startVarianceMinutes = hasSourceStart
      ? calculatedStartMinutes! - sourceDates.sourceStartMinutes!
      : undefined;
    const finishVarianceMinutes = hasSourceFinish
      ? calculatedFinishMinutes! - sourceDates.sourceFinishMinutes!
      : undefined;

    const maxMagnitude = Math.max(
      Math.abs(startVarianceMinutes ?? 0),
      Math.abs(finishVarianceMinutes ?? 0),
    );
    const varianceSeverity = toSeverity(maxMagnitude);

    const taskDiagnostics = diagnosticsMap[task.id] ?? [];
    const calendarRiskRelated = taskDiagnostics.includes("SUPERSEDED_BY_CALENDAR")
      || importDiagnostics.some(d => d.canonicalEntityId === task.id && CALENDAR_IMPORT_CODES.has(d.code as never));
    const constraintRiskRelated = taskDiagnostics.some(code => CONSTRAINT_DIAGNOSTICS.has(code as never));

    const possibleReasons: string[] = [];
    if (calendarRiskRelated) {
      possibleReasons.push("Calendar interpretation differences between source and planner calculation");
    }
    if (constraintRiskRelated) {
      possibleReasons.push("Constraint interaction changed calculated start/finish");
    }
    if (possibleReasons.length === 0 && varianceSeverity !== "none") {
      possibleReasons.push("Dependency logic and scheduling assumptions differ from source system");
    }

    taskVariances.push({
      taskId: task.id,
      sourceActivityId: task.sourceActivityId,
      taskName: task.name,
      sourceStartMinutes: sourceDates.sourceStartMinutes,
      sourceFinishMinutes: sourceDates.sourceFinishMinutes,
      calculatedStartMinutes,
      calculatedFinishMinutes,
      startVarianceMinutes,
      finishVarianceMinutes,
      varianceSeverity,
      possibleReasons,
      calendarRiskRelated,
      constraintRiskRelated,
    });
  }

  taskVariances.sort((a, b) => {
    const aMagnitude = Math.max(Math.abs(a.finishVarianceMinutes ?? 0), Math.abs(a.startVarianceMinutes ?? 0));
    const bMagnitude = Math.max(Math.abs(b.finishVarianceMinutes ?? 0), Math.abs(b.startVarianceMinutes ?? 0));
    return bMagnitude - aMagnitude;
  });

  const noVarianceCount = taskVariances.filter(v => v.varianceSeverity === "none").length;
  const startVarianceCount = taskVariances.filter(v => (v.startVarianceMinutes ?? 0) !== 0).length;
  const finishVarianceCount = taskVariances.filter(v => (v.finishVarianceMinutes ?? 0) !== 0).length;
  const majorVarianceCount = taskVariances.filter(v => v.varianceSeverity === "major").length;

  return {
    totalCompared: taskVariances.length,
    noVarianceCount,
    startVarianceCount,
    finishVarianceCount,
    majorVarianceCount,
    taskVariances,
    generatedAt: new Date().toISOString(),
  };
}
