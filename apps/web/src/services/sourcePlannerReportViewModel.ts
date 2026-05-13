import type {
    BaseCalendarDefinition,
    ScheduleResultMap,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
    Task,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import {
    projectDateFormatted,
    projectDateFromMinutesFormatted,
    type DateDisplayFormat,
} from "../utils/dateProjection";
import { classifyCalendarRisk } from "./calendarRisk";

export type VarianceReasonTag =
  | "calendar_risk"
  | "duration_difference"
  | "actuals_or_remaining_duration"
  | "constraint_related"
  | "logic_or_relationship_difference"
  | "source_missing"
  | "planner_missing"
  | "unknown";

export type SourcePlannerReportRow = {
  readonly taskId: string;
  readonly activityId: string;
  readonly activityName: string;
  readonly wbsPath?: string;
  readonly sourceStart?: string;
  readonly plannerStart?: string;
  readonly startVariance: string;
  readonly sourceFinish?: string;
  readonly plannerFinish?: string;
  readonly finishVariance: string;
  readonly sourceDuration?: string;
  readonly plannerDuration?: string;
  readonly durationVariance: string;
  readonly sourceTotalFloat?: string;
  readonly plannerTotalFloat?: string;
  readonly floatVariance: string;
  readonly calendarId?: string;
  readonly calendarName?: string;
  readonly reasonTag: VarianceReasonTag;
  readonly reasonLabel: string;
};

export type SourcePlannerReportSummary = {
  readonly projectName: string;
  readonly importedSourceRollupFinish?: string;
  readonly projectMustFinishBy?: string;
  readonly plannerRollupFinish?: string;
  readonly finishMovement: string;
  readonly activitiesCompared: number;
  readonly startDifferences: number;
  readonly finishDifferences: number;
  readonly majorVariances: number;
  readonly calendarRiskLevel: string;
  readonly highlightedDiagnostics: readonly string[];
  readonly explanatoryText: string;
};

export type SourcePlannerRecalculationReportViewModel = {
  readonly summary: SourcePlannerReportSummary;
  readonly rows: readonly SourcePlannerReportRow[];
};

export type BuildSourcePlannerRecalculationReportInput = {
  readonly sourceImportRecord: SourceImportRecord;
  readonly sourceImportFidelityState: SourceImportFidelityState;
  readonly sourceCalculatedVarianceReport: SourceCalculatedVarianceReport;
  readonly tasks: readonly Task[];
  readonly scheduleResults: ScheduleResultMap;
  readonly projectStartDate: string;
  readonly dateDisplayFormat: DateDisplayFormat;
};

const RELEVANT_DIAG_CODES = new Set([
  "CALENDAR_SIMPLIFIED_FOR_ENGINE",
  "TASK_CALENDAR_IGNORED_BY_ENGINE",
]);

/** Calendar minutes per day: 24 hours × 60 minutes. Used for date/time movement calculations. */
const CALENDAR_MINUTES_PER_DAY = 1440;

/**
 * Format date/calendar movement variance in calendar days (1440 minutes/day).
 * Used for start variance, finish variance, and finish movement.
 */
function formatDateMovementVarianceMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const sign = minutes > 0 ? "+" : "";
  const days = minutes / CALENDAR_MINUTES_PER_DAY;
  return `${sign}${days.toFixed(2)}d`;
}

/**
 * Format duration variance in working days (480 minutes/day).
 * Used for duration-based differences.
 */
function formatDurationVarianceMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const sign = minutes > 0 ? "+" : "";
  const days = minutes / MINUTES_PER_DAY;
  return `${sign}${days.toFixed(2)}d`;
}

/**
 * Format duration display in working days (480 minutes/day).
 * Used for source and planner duration displays.
 */
function formatDurationMinutes(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined;
  return `${(minutes / MINUTES_PER_DAY).toFixed(2)}d`;
}

function buildTaskMap(tasks: readonly Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function buildWbsPath(task: Task, taskMap: ReadonlyMap<string, Task>): string {
  const parts: string[] = [task.name];
  let cursor = task.parentId;
  while (cursor) {
    const parent = taskMap.get(cursor);
    if (!parent) break;
    parts.push(parent.name);
    cursor = parent.parentId;
  }
  return parts.reverse().join(" / ");
}

function pickReasonTag(params: {
  hasCalendarRisk: boolean;
  hasDurationDifference: boolean;
  hasActualsOrRemaining: boolean;
  hasConstraintMetadata: boolean;
  hasLogicOrLagSignal: boolean;
  hasSourceMissing: boolean;
  hasPlannerMissing: boolean;
}): { tag: VarianceReasonTag; label: string } {
  if (params.hasSourceMissing) {
    return { tag: "source_missing", label: "Source values missing for this activity." };
  }
  if (params.hasPlannerMissing) {
    return { tag: "planner_missing", label: "Planner-calculated values missing for this activity." };
  }
  if (params.hasCalendarRisk) {
    return { tag: "calendar_risk", label: "Likely calendar-related (preserved/imported calendar rules not fully active)." };
  }
  if (params.hasDurationDifference) {
    return { tag: "duration_difference", label: "Duration differs between imported source and planner recalculation." };
  }
  if (params.hasActualsOrRemaining) {
    return { tag: "actuals_or_remaining_duration", label: "Potential actuals/remaining-duration impact." };
  }
  if (params.hasConstraintMetadata) {
    return { tag: "constraint_related", label: "Potential constraint-related impact." };
  }
  if (params.hasLogicOrLagSignal) {
    return { tag: "logic_or_relationship_difference", label: "Potential logic/relationship/lag impact." };
  }
  return { tag: "unknown", label: "No safe diagnostic reason available." };
}

function maxDefined(values: ReadonlyArray<number | undefined>): number | undefined {
  let max: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    if (max === undefined || value > max) max = value;
  }
  return max;
}

export function buildSourcePlannerRecalculationReport(
  input: BuildSourcePlannerRecalculationReportInput,
): SourcePlannerRecalculationReportViewModel {
  const {
    sourceImportRecord,
    sourceImportFidelityState,
    sourceCalculatedVarianceReport,
    tasks,
    scheduleResults,
    projectStartDate,
    dateDisplayFormat,
  } = input;

  const taskMap = buildTaskMap(tasks);
  const calendarDefinitions: Readonly<Record<string, BaseCalendarDefinition>> = {
    ...(sourceImportRecord.calendarDefinitions ?? {}),
    ...(sourceImportRecord.resolvedCalendarDefinitions ?? {}),
  };
  const risk = classifyCalendarRisk(sourceImportRecord.summary.calendarFidelity, sourceImportRecord.diagnostics);

  const sourceRollupFinishMinutes = maxDefined(
    sourceCalculatedVarianceReport.taskVariances.map((v) => v.sourceFinishMinutes),
  );
  const plannerRollupFinishMinutes = maxDefined(
    sourceCalculatedVarianceReport.taskVariances.map((v) => v.calculatedFinishMinutes),
  );

  const plannerRollupFinishDayOffset = maxDefined(
    sourceCalculatedVarianceReport.taskVariances.map((v) => scheduleResults[v.taskId]?.earlyFinishMinutes),
  );

  const rows: SourcePlannerReportRow[] = sourceCalculatedVarianceReport.taskVariances.map((variance) => {
      const plannerSchedule = scheduleResults[variance.taskId];

    const task = taskMap.get(variance.taskId);
    const actuals = sourceImportFidelityState.actualsByTaskId[variance.taskId];
    const sourceDurationMinutes =
      variance.sourceStartMinutes !== undefined && variance.sourceFinishMinutes !== undefined
        ? variance.sourceFinishMinutes - variance.sourceStartMinutes
        : undefined;
    const plannerDurationMinutes =
      variance.calculatedStartMinutes !== undefined && variance.calculatedFinishMinutes !== undefined
        ? variance.calculatedFinishMinutes - variance.calculatedStartMinutes
        : undefined;
    const durationVarianceMinutes =
      sourceDurationMinutes !== undefined && plannerDurationMinutes !== undefined
        ? plannerDurationMinutes - sourceDurationMinutes
        : undefined;

    const hasActualsOrRemaining = Boolean(
      actuals?.actualStartMinutes !== undefined
        || actuals?.actualFinishMinutes !== undefined
        || actuals?.remainingDurationWorkMinutes !== undefined
        || actuals?.remainingStartMinutes !== undefined
        || actuals?.remainingFinishMinutes !== undefined,
    );
    const hasConstraintMetadata = Boolean(task?.constraintType && task.constraintType !== "ASAP") || Boolean(variance.constraintRiskRelated);
    const hasLogicOrLagSignal = (variance.possibleReasons ?? []).some((reason) =>
      /dependency|logic|relationship|lag/i.test(reason),
    );
    const assignedCalendarId = task?.assignedCalendarId as string | undefined;
    const hasCalendarRisk = Boolean(variance.calendarRiskRelated)
      || sourceImportRecord.diagnostics.some((d) => RELEVANT_DIAG_CODES.has(d.code));

    const reason = pickReasonTag({
      hasCalendarRisk,
      hasDurationDifference: durationVarianceMinutes !== undefined && Math.abs(durationVarianceMinutes) > 0,
      hasActualsOrRemaining,
      hasConstraintMetadata,
      hasLogicOrLagSignal,
      hasSourceMissing: variance.sourceStartMinutes === undefined || variance.sourceFinishMinutes === undefined,
      hasPlannerMissing: variance.calculatedStartMinutes === undefined || variance.calculatedFinishMinutes === undefined,
    });

    return {
      taskId: variance.taskId,
      activityId: variance.sourceActivityId ?? task?.sourceActivityId ?? task?.id ?? variance.taskId,
      activityName: variance.taskName,
      wbsPath: task ? buildWbsPath(task, taskMap) : undefined,
      sourceStart:
        variance.sourceStartMinutes !== undefined
          ? projectDateFromMinutesFormatted(projectStartDate, variance.sourceStartMinutes, dateDisplayFormat)
          : undefined,
      plannerStart:
        plannerSchedule?.earlyStartMinutes !== undefined
          ? projectDateFormatted(projectStartDate, plannerSchedule.earlyStartMinutes, dateDisplayFormat)
          : variance.calculatedStartMinutes !== undefined
            ? projectDateFromMinutesFormatted(projectStartDate, variance.calculatedStartMinutes, dateDisplayFormat)
          : undefined,
      startVariance: formatDateMovementVarianceMinutes(variance.startVarianceMinutes),
      sourceFinish:
        variance.sourceFinishMinutes !== undefined
          ? projectDateFromMinutesFormatted(projectStartDate, variance.sourceFinishMinutes, dateDisplayFormat)
          : undefined,
      plannerFinish:
        plannerSchedule?.earlyFinishMinutes !== undefined
          ? projectDateFormatted(projectStartDate, plannerSchedule.earlyFinishMinutes, dateDisplayFormat)
          : variance.calculatedFinishMinutes !== undefined
            ? projectDateFromMinutesFormatted(projectStartDate, variance.calculatedFinishMinutes, dateDisplayFormat)
          : undefined,
      finishVariance: formatDateMovementVarianceMinutes(variance.finishVarianceMinutes),
      sourceDuration: formatDurationMinutes(sourceDurationMinutes),
      plannerDuration: formatDurationMinutes(plannerDurationMinutes),
      durationVariance: formatDurationVarianceMinutes(durationVarianceMinutes),
      sourceTotalFloat: undefined,
      plannerTotalFloat:
        plannerSchedule?.totalFloatMinutes !== undefined
          ? String(plannerSchedule.totalFloatMinutes)
          : undefined,
      floatVariance: "—",
      calendarId: assignedCalendarId,
      calendarName: assignedCalendarId ? calendarDefinitions[assignedCalendarId]?.name : undefined,
      reasonTag: reason.tag,
      reasonLabel: reason.label,
    };
  });

  const highlightedDiagnostics = sourceImportRecord.diagnostics
    .filter((d) => RELEVANT_DIAG_CODES.has(d.code))
    .map((d) => `${d.code}: ${d.message}`);

  const plannerRollupFinishMinutesFromSchedule =
    plannerRollupFinishDayOffset !== undefined
      ? plannerRollupFinishDayOffset * CALENDAR_MINUTES_PER_DAY
      : plannerRollupFinishMinutes;

  const finishMovementMinutes =
    sourceRollupFinishMinutes !== undefined && plannerRollupFinishMinutesFromSchedule !== undefined
      ? plannerRollupFinishMinutesFromSchedule - sourceRollupFinishMinutes
      : undefined;

  const summary: SourcePlannerReportSummary = {
    projectName:
      sourceImportRecord.sourceProjectSettings?.sourceProjectId
      ?? sourceImportRecord.sourceFileName
      ?? "(source project)",
    importedSourceRollupFinish:
      sourceRollupFinishMinutes !== undefined
        ? projectDateFromMinutesFormatted(projectStartDate, sourceRollupFinishMinutes, dateDisplayFormat)
        : undefined,
    projectMustFinishBy: sourceImportRecord.sourceProjectSettings?.mustFinishBy,
    plannerRollupFinish:
      plannerRollupFinishDayOffset !== undefined
        ? projectDateFormatted(projectStartDate, plannerRollupFinishDayOffset, dateDisplayFormat)
        : plannerRollupFinishMinutes !== undefined
          ? projectDateFromMinutesFormatted(projectStartDate, plannerRollupFinishMinutes, dateDisplayFormat)
        : undefined,
    finishMovement: formatDateMovementVarianceMinutes(finishMovementMinutes),
    activitiesCompared: sourceCalculatedVarianceReport.totalCompared,
    startDifferences: sourceCalculatedVarianceReport.startVarianceCount,
    finishDifferences: sourceCalculatedVarianceReport.finishVarianceCount,
    majorVariances: sourceCalculatedVarianceReport.majorVarianceCount,
    calendarRiskLevel: risk.level,
    highlightedDiagnostics,
    explanatoryText:
      "Imported source dates are preserved. Planner-calculated dates are a separate recalculation and may not match P6 when calendar, lag, actuals, or constraint semantics are not fully active.",
  };

  return { summary, rows };
}
