import type {
    BaseCalendarDefinition,
    CalendarId,
    ImportDiagnostic,
    ScheduleLifecycleState,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
    Task,
    VisibleRow,
} from "@planner/protocol";
import {
    formatSourceDateString,
    projectDateFromMinutesFormatted,
    type DateDisplayFormat,
} from "../utils/dateProjection";

export type CalendarEngineFidelityStatus = "ACTIVE" | "SIMPLIFIED" | "PRESERVED_ONLY";
export type CalendarTypeLabel = "Global" | "Project" | "Resource" | "Unknown";

export type ImportDetailsProjectDetails = {
  readonly sourceFormat: string;
  readonly fileName: string;
  readonly projectName: string;
  readonly sourceProjectId?: string;
  readonly projectStart: string;
  readonly dataDate?: string;
  readonly statusDate?: string;
  readonly mustFinishBy?: string;
  readonly sourceRollupFinish?: string;
  readonly plannerRollupFinish?: string;
  readonly defaultCalendar?: string;
  readonly hoursPerDay?: number;
  readonly hoursPerWeek?: number;
  readonly hoursPerMonth?: number;
  readonly hoursPerYear?: number;
  readonly scheduleOptionsPreservedInactive: boolean;
  readonly importLifecycle: ScheduleLifecycleState;
  readonly recalculationStatus: string;
  readonly varianceStatus: string;
};

export type ImportDetailsUsedByActivity = {
  readonly taskId: string;
  readonly activityId: string;
  readonly activityName: string;
  readonly wbsPath?: string;
  readonly sourceStart?: string;
  readonly sourceFinish?: string;
  readonly assignmentFidelity: "Preserved only" | "Active in engine" | "Simplified";
};

export type ImportDetailsUsedByResource = {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly assignmentFidelity: "Preserved only" | "Active in engine" | "Simplified";
};

export type ImportDetailsCalendarException = {
  readonly date: string;
  readonly type: "Nonwork" | "Exception Workday" | "Partial Day" | "Unknown";
  readonly hours?: number;
  readonly source: "Local" | "Inherited" | "Unknown";
  readonly parseStatus: string;
};

export type ImportDetailsCalendarDetail = {
  readonly id: string;
  readonly sourceCalendarId: string;
  readonly name: string;
  readonly type: CalendarTypeLabel;
  readonly parentCalendarId?: string;
  readonly parentCalendarName?: string;
  readonly inheritanceResolved: boolean;
  readonly rawSourcePreserved: boolean;
  readonly engineStatus: CalendarEngineFidelityStatus;
  readonly hasParseWarning: boolean;
  readonly parseWarningMessage?: string;
  readonly hoursPerDay?: number;
  readonly hoursPerWeek?: number;
  readonly hoursPerMonth?: number;
  readonly hoursPerYear?: number;
  readonly weeklyHoursByDay: ReadonlyArray<{ dayLabel: string; hours: number; periodsText: string }>;
  readonly workingPatternSummary: string;
  readonly exceptionCount: number;
  readonly exceptionCountLocal: number;
  readonly exceptionCountInherited: number;
  readonly exceptions: readonly ImportDetailsCalendarException[];
  readonly assignedActivities: readonly ImportDetailsUsedByActivity[];
  readonly assignedResources: readonly ImportDetailsUsedByResource[];
};

export type ImportDetailsCalendarListItem = {
  readonly id: string;
  readonly name: string;
  readonly type: CalendarTypeLabel;
  readonly isDefault: boolean;
  readonly parentCalendarId?: string;
  readonly parentCalendarName?: string;
  readonly usageTaskCount: number;
  readonly usageResourceCount: number;
  readonly exceptionCount: number;
  readonly engineStatus: CalendarEngineFidelityStatus;
};

export type ImportDetailsViewModel = {
  readonly projectDetails: ImportDetailsProjectDetails;
  readonly diagnostics: readonly string[];
  readonly calendars: readonly ImportDetailsCalendarListItem[];
  readonly calendarDetailsById: Readonly<Record<string, ImportDetailsCalendarDetail>>;
  readonly sourceSettingsNotice: string;
  readonly engineNotice: string;
  readonly assignmentNotice: string;
  readonly parseNotice: string;
  readonly recalculationNotice: string;
  readonly sourceVsPlannerContextNotice: string;
};

export type BuildImportDetailsViewModelInput = {
  readonly sourceImportRecord: SourceImportRecord | null;
  readonly sourceImportFidelityState: SourceImportFidelityState;
  readonly scheduleLifecycle: ScheduleLifecycleState;
  readonly sourceCalculatedVarianceReport: SourceCalculatedVarianceReport | null;
  readonly tasks: readonly Task[];
  readonly visibleRows: readonly VisibleRow[];
  readonly projectStartDate: string;
  readonly dateDisplayFormat: DateDisplayFormat;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function minutesToTime(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function sumIntervalHours(intervals: readonly { startMinute: number; endMinute: number }[]): number {
  return intervals.reduce((sum, iv) => sum + (iv.endMinute - iv.startMinute), 0) / 60;
}

function formatPeriods(intervals: readonly { startMinute: number; endMinute: number }[]): string {
  if (!intervals.length) return "non-working";
  return intervals.map((iv) => `${minutesToTime(iv.startMinute)}-${minutesToTime(iv.endMinute)}`).join(", ");
}

function buildTaskNameMap(tasks: readonly Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

function buildWbsPath(task: Task, taskMap: ReadonlyMap<string, Task>): string {
  const parts: string[] = [task.name];
  let parentId = task.parentId;
  while (parentId) {
    const parent = taskMap.get(parentId);
    if (!parent) break;
    parts.push(parent.name);
    parentId = parent.parentId;
  }
  return parts.reverse().join(" / ");
}

function findCalendarDiag(
  diagnostics: readonly ImportDiagnostic[],
  calendarId: string,
  code: ImportDiagnostic["code"],
): boolean {
  return diagnostics.some((d) => d.code === code && d.sourceEntityId === calendarId);
}

function inferCalendarType(
  sourceCalendarType: BaseCalendarDefinition["sourceCalendarType"] | undefined,
  calendarId: string,
  defaultCalendarId: string | undefined,
  usageTaskCount: number,
  diagnostics: readonly ImportDiagnostic[],
): CalendarTypeLabel {
  if (sourceCalendarType === "project") return "Project";
  if (sourceCalendarType === "resource") return "Resource";
  if (sourceCalendarType === "global") return "Global";
  if (sourceCalendarType === "unknown") return "Unknown";
  if (defaultCalendarId && calendarId === defaultCalendarId) return "Project";
  if (usageTaskCount > 0) return "Project";
  if (findCalendarDiag(diagnostics, calendarId, "RESOURCE_CALENDAR_PRESERVED_INACTIVE")) return "Resource";
  if (calendarId) return "Global";
  return "Unknown";
}

function inferEngineStatus(
  calendarId: string,
  diagnostics: readonly ImportDiagnostic[],
  visibleRows: readonly VisibleRow[],
): CalendarEngineFidelityStatus {
  if (visibleRows.some((r) => r.computationalCalendarId === (calendarId as CalendarId))) {
    return "ACTIVE";
  }
  if (findCalendarDiag(diagnostics, calendarId, "CALENDAR_SIMPLIFIED_FOR_ENGINE")) {
    return "SIMPLIFIED";
  }
  return "PRESERVED_ONLY";
}

function formatProjectDate(raw: string | undefined, format: DateDisplayFormat): string | undefined {
  if (!raw) return undefined;
  return formatSourceDateString(raw, format) ?? raw;
}

function maxDefined(values: ReadonlyArray<number | undefined>): number | undefined {
  let maxValue: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    if (maxValue === undefined || value > maxValue) {
      maxValue = value;
    }
  }
  return maxValue;
}

function inferredWorkingDaysFromHours(hoursPerDay: number | undefined, hoursPerWeek: number | undefined): number | undefined {
  if (hoursPerDay === undefined || hoursPerWeek === undefined || hoursPerDay <= 0) return undefined;
  const ratio = hoursPerWeek / hoursPerDay;
  const rounded = Math.round(ratio);
  if (rounded < 1 || rounded > 7) return undefined;
  return Math.abs(ratio - rounded) <= 0.25 ? rounded : undefined;
}

function buildWeeklyHoursByDay(
  sourceDef: BaseCalendarDefinition,
  resolvedDef: BaseCalendarDefinition,
  forceInferredText = false,
): { rows: ReadonlyArray<{ dayLabel: string; hours: number; periodsText: string }>; inferred: boolean } {
  const parsedRows = DAY_LABELS.map((dayLabel, dayIndex) => {
    const intervals = resolvedDef.weeklyPattern[dayIndex as 0 | 1 | 2 | 3 | 4 | 5 | 6] ?? [];
    const hours = sumIntervalHours(intervals);
    return {
      dayLabel,
      hours,
      periodsText: forceInferredText
        ? (hours > 0 ? `${hours}h — inferred` : "non-working")
        : formatPeriods(intervals),
    };
  });

  const parsedHours = parsedRows.reduce((sum, d) => sum + d.hours, 0);
  if (parsedHours > 0) {
    return { rows: parsedRows, inferred: false };
  }

  const hoursPerDay = resolvedDef.sourceHoursPerDay ?? sourceDef.sourceHoursPerDay;
  const hoursPerWeek = resolvedDef.sourceHoursPerWeek ?? sourceDef.sourceHoursPerWeek;
  const workingDays = inferredWorkingDaysFromHours(hoursPerDay, hoursPerWeek);
  if (workingDays === undefined || hoursPerDay === undefined) {
    return { rows: parsedRows, inferred: false };
  }

  const rows = DAY_LABELS.map((dayLabel, dayIndex) => {
    const isWorking =
      workingDays === 7
        ? true
        : workingDays === 6
          ? dayIndex >= 1 && dayIndex <= 6
          : dayIndex >= 1 && dayIndex <= Math.min(5, workingDays);
    return {
      dayLabel,
      hours: isWorking ? hoursPerDay : 0,
      periodsText: isWorking ? `${hoursPerDay}h — inferred` : "non-working",
    };
  });
  return { rows, inferred: true };
}

export function buildImportDetailsViewModel(input: BuildImportDetailsViewModelInput): ImportDetailsViewModel | null {
  const {
    sourceImportRecord,
    sourceImportFidelityState,
    scheduleLifecycle,
    sourceCalculatedVarianceReport,
    tasks,
    visibleRows,
    projectStartDate,
    dateDisplayFormat,
  } = input;

  if (!sourceImportRecord) return null;

  const settings = sourceImportRecord.sourceProjectSettings;
  const diagnostics = sourceImportRecord.diagnostics;
  const sourceDatesByTaskId = sourceImportFidelityState.sourceDatesByTaskId ?? sourceImportRecord.sourceImportFidelityState?.sourceDatesByTaskId ?? {};

  const defaultCalendarId = settings?.defaultCalendarId ?? settings?.defaultCalendarUID;
  const defaultCalendar = settings?.defaultCalendarName ?? defaultCalendarId;
  const hasScheduleOptionsPreserved = Boolean(
    settings?.rawScheduleOptions
      || settings?.outOfSequenceProgressMode !== undefined
      || settings?.criticalFloatThreshold !== undefined
      || settings?.useExpectedFinishDates !== undefined
      || settings?.scheduleFrom !== undefined,
  );

  const sourceRollupFinishMinutesFromSource = maxDefined(
    Object.values(sourceDatesByTaskId).map((d) => d.sourceFinishMinutes),
  );
  const sourceRollupFinishMinutesFromVariance = sourceCalculatedVarianceReport
    ? maxDefined(sourceCalculatedVarianceReport.taskVariances.map((v) => v.sourceFinishMinutes))
    : undefined;
  const plannerRollupFinishMinutes = sourceCalculatedVarianceReport
    ? maxDefined(sourceCalculatedVarianceReport.taskVariances.map((v) => v.calculatedFinishMinutes))
    : undefined;

  const sourceRollupFinishMinutes = sourceRollupFinishMinutesFromSource ?? sourceRollupFinishMinutesFromVariance;

  const projectDetails: ImportDetailsProjectDetails = {
    sourceFormat: sourceImportRecord.format.toUpperCase(),
    fileName: sourceImportRecord.sourceFileName ?? "(unknown file)",
    projectName:
      settings?.sourceProjectId
      ?? sourceImportRecord.sourceFileName?.replace(/\.[^.]+$/, "")
      ?? "(source project)",
    sourceProjectId: settings?.sourceProjectId,
    projectStart:
      formatProjectDate(settings?.planStartDate ?? projectStartDate, dateDisplayFormat)
      ?? (settings?.planStartDate ?? projectStartDate),
    dataDate: formatProjectDate(settings?.dataDate ?? sourceImportRecord.summary.sourceDataDate, dateDisplayFormat),
    statusDate: formatProjectDate(settings?.statusDate ?? sourceImportRecord.summary.sourceStatusDate, dateDisplayFormat),
    mustFinishBy: formatProjectDate(settings?.mustFinishBy, dateDisplayFormat),
    sourceRollupFinish:
      sourceRollupFinishMinutes !== undefined
        ? projectDateFromMinutesFormatted(projectStartDate, sourceRollupFinishMinutes, dateDisplayFormat)
        : undefined,
    plannerRollupFinish:
      plannerRollupFinishMinutes !== undefined
        ? projectDateFromMinutesFormatted(projectStartDate, plannerRollupFinishMinutes, dateDisplayFormat)
        : undefined,
    defaultCalendar,
    hoursPerDay: settings?.hoursPerDay,
    hoursPerWeek: settings?.hoursPerWeek,
    hoursPerMonth: settings?.hoursPerMonth,
    hoursPerYear:
      settings?.hoursPerDay !== undefined && settings?.hoursPerWeek !== undefined
        ? settings.hoursPerWeek * 52
        : undefined,
    scheduleOptionsPreservedInactive: hasScheduleOptionsPreserved,
    importLifecycle: scheduleLifecycle,
    recalculationStatus:
      scheduleLifecycle === "sourceImportedNotCalculated"
        ? "Not recalculated yet"
        : scheduleLifecycle === "plannerCalculated" || scheduleLifecycle === "plannerCalculatedWithVariance"
          ? "Planner recalculation has been run"
          : "N/A",
    varianceStatus:
      sourceCalculatedVarianceReport
        ? `Variance report generated (${sourceCalculatedVarianceReport.totalCompared} compared)`
        : "No variance report",
  };

  const sourceDefs = sourceImportRecord.calendarDefinitions ?? {};
  const resolvedDefs = sourceImportRecord.resolvedCalendarDefinitions ?? sourceDefs;
  const defById = sourceDefs as Readonly<Record<string, BaseCalendarDefinition>>;
  const resolvedById = resolvedDefs as Readonly<Record<string, BaseCalendarDefinition>>;

  const taskMap = buildTaskNameMap(tasks);
  const usageByCalendar: Record<string, { tasks: Task[] }> = {};
  for (const t of tasks) {
    if (!t.assignedCalendarId) continue;
    const key = t.assignedCalendarId as string;
    usageByCalendar[key] ??= { tasks: [] };
    usageByCalendar[key].tasks.push(t);
  }

  const calendars: ImportDetailsCalendarListItem[] = [];
  const calendarDetailsById: Record<string, ImportDetailsCalendarDetail> = {};

  for (const [calendarId, sourceDef] of Object.entries(defById)) {
    const resolvedDef = resolvedById[calendarId] ?? sourceDef;
    const parentId = sourceDef.parentCalendarId as string | undefined;
    const parentName = parentId ? (defById[parentId]?.name ?? resolvedById[parentId]?.name) : undefined;
    const assignedTasks = usageByCalendar[calendarId]?.tasks ?? [];
    const usageTaskCount = assignedTasks.length;
    const usageResourceCount = 0;

    const type = inferCalendarType(
      sourceDef.sourceCalendarType,
      calendarId,
      defaultCalendarId,
      usageTaskCount,
      diagnostics,
    );
    const engineStatus = inferEngineStatus(calendarId, diagnostics, visibleRows);
    const workingPatternSource = resolvedDef.workingPatternSource ?? sourceDef.workingPatternSource;
    const inferredPattern = workingPatternSource === "inferred-hours" || workingPatternSource === "inferred-name";
    const hasParseWarning = findCalendarDiag(diagnostics, calendarId, "CALENDAR_SIMPLIFIED_FOR_ENGINE")
      || findCalendarDiag(diagnostics, calendarId, "UNSUPPORTED_EXCEPTION_PATTERN")
      || inferredPattern;

    const weeklyHoursResult = buildWeeklyHoursByDay(sourceDef, resolvedDef, inferredPattern);
    const weeklyHoursByDay = weeklyHoursResult.rows;

    const derivedHoursPerWeek = weeklyHoursByDay.reduce((sum, d) => sum + d.hours, 0);
    const derivedHoursPerDay = derivedHoursPerWeek > 0 ? Math.max(...weeklyHoursByDay.map((d) => d.hours)) : undefined;
    const hoursPerDay = resolvedDef.sourceHoursPerDay ?? sourceDef.sourceHoursPerDay ?? derivedHoursPerDay;
    const hoursPerWeek = resolvedDef.sourceHoursPerWeek ?? sourceDef.sourceHoursPerWeek ?? derivedHoursPerWeek;
    const hoursPerMonth = resolvedDef.sourceHoursPerMonth ?? sourceDef.sourceHoursPerMonth ?? (hoursPerWeek ? (hoursPerWeek * 4) : undefined);
    const hoursPerYear = resolvedDef.sourceHoursPerYear ?? sourceDef.sourceHoursPerYear ?? (hoursPerWeek ? (hoursPerWeek * 52) : undefined);

    const localExceptionDates = new Set(sourceDef.exceptions.map((e) => e.date));
    const exceptions: ImportDetailsCalendarException[] = resolvedDef.exceptions.map((ex) => {
      const local = localExceptionDates.has(ex.date);
      const dayOfWeek = new Date(`${ex.date}T00:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const baseIntervals = resolvedDef.weeklyPattern[dayOfWeek] ?? [];
      const baseHours = sumIntervalHours(baseIntervals);
      const exHours = sumIntervalHours(ex.workIntervals);

      let typeLabel: ImportDetailsCalendarException["type"] = "Unknown";
      if (ex.workIntervals.length === 0) typeLabel = "Nonwork";
      else if (baseIntervals.length === 0) typeLabel = "Exception Workday";
      else if (Math.abs(exHours - baseHours) > 0.0001) typeLabel = "Partial Day";

      return {
        date: formatProjectDate(ex.date, dateDisplayFormat) ?? ex.date,
        type: typeLabel,
        hours: ex.workIntervals.length ? exHours : undefined,
        source: local ? "Local" : "Inherited",
        parseStatus: hasParseWarning ? "Partially parsed" : "Parsed",
      };
    });

    const assignedActivities: ImportDetailsUsedByActivity[] = assignedTasks.map((t) => {
      const srcDates = sourceDatesByTaskId[t.id];
      return {
        taskId: t.id,
        activityId: t.sourceActivityId ?? t.activityCode ?? t.id,
        activityName: t.name,
        wbsPath: buildWbsPath(t, taskMap),
        sourceStart: srcDates?.sourceStartMinutes != null
          ? projectDateFromMinutesFormatted(projectStartDate, srcDates.sourceStartMinutes, dateDisplayFormat)
          : undefined,
        sourceFinish: srcDates?.sourceFinishMinutes != null
          ? projectDateFromMinutesFormatted(projectStartDate, srcDates.sourceFinishMinutes, dateDisplayFormat)
          : undefined,
        assignmentFidelity:
          engineStatus === "ACTIVE"
            ? "Active in engine"
            : engineStatus === "SIMPLIFIED"
              ? "Simplified"
              : "Preserved only",
      };
    });

    const assignedResources: ImportDetailsUsedByResource[] = [];

    const detail: ImportDetailsCalendarDetail = {
      id: calendarId,
      sourceCalendarId: calendarId,
      name: sourceDef.name,
      type,
      parentCalendarId: parentId,
      parentCalendarName: parentName,
      inheritanceResolved: sourceDef.parentCalendarId
        ? !!resolvedById[calendarId]
          && (
            JSON.stringify(sourceDef.weeklyPattern) !== JSON.stringify(resolvedDef.weeklyPattern)
            || JSON.stringify(sourceDef.exceptions) !== JSON.stringify(resolvedDef.exceptions)
          )
        : true,
      rawSourcePreserved: true,
      engineStatus,
      hasParseWarning,
      parseWarningMessage: hasParseWarning
        ? inferredPattern || weeklyHoursResult.inferred
          ? "Detailed calendar periods were not fully parsed. Weekly hours are inferred from source P6 period totals."
          : "Detailed P6/MSP calendar data has been preserved. Some custom time periods or complex rules could not be fully resolved."
        : undefined,
      hoursPerDay,
      hoursPerWeek,
      hoursPerMonth,
      hoursPerYear,
      weeklyHoursByDay,
      workingPatternSummary:
        hoursPerWeek > 0
          ? `${inferredPattern || weeklyHoursResult.inferred ? "Inferred " : ""}${weeklyHoursByDay.filter((d) => d.hours > 0).length} working days, ${hoursPerWeek}h/week`
          : "No parsed working-time pattern",
      exceptionCount: resolvedDef.exceptions.length,
      exceptionCountLocal: sourceDef.exceptions.length,
      exceptionCountInherited: Math.max(0, resolvedDef.exceptions.length - sourceDef.exceptions.length),
      exceptions,
      assignedActivities,
      assignedResources,
    };

    calendarDetailsById[calendarId] = detail;

    calendars.push({
      id: calendarId,
      name: sourceDef.name,
      type,
      isDefault: Boolean(defaultCalendarId && calendarId === defaultCalendarId),
      parentCalendarId: parentId,
      parentCalendarName: parentName,
      usageTaskCount,
      usageResourceCount,
      exceptionCount: detail.exceptionCount,
      engineStatus,
    });
  }

  const sourceSettingsNotice = "Source project settings are preserved for verification.";
  const engineNotice = "Planner-Studio recalculation does not yet apply all imported P6/MSP project settings.";
  const assignmentNotice = "Activity calendar assignments are preserved, but Planner-Studio recalculation may still use the project/default calendar until engine support is enabled.";
  const parseNotice = "Raw source calendar data is preserved, but detailed exceptions are not fully parsed yet.";
  const recalculationNotice = "Planner-Calculated Dates are a separate interpretation and may differ due to inactive calendar rules or schedule options.";
  const sourceVsPlannerContextNotice = scheduleLifecycle === "sourceImportedNotCalculated"
    ? "This view shows imported source dates. Task table shows the same source dates until recalculation runs."
    : scheduleLifecycle === "plannerCalculatedWithVariance" || scheduleLifecycle === "plannerCalculated"
      ? "This view shows imported source dates (preserved from the original file). Task table shows planner-calculated dates after recalculation. Use the Source vs Planner Report to compare."
      : "This view shows imported source dates. Refer to the Task table for planner-calculated dates.";

  return {
    projectDetails,
    diagnostics: diagnostics.slice(0, 6).map((d) => d.message),
    calendars,
    calendarDetailsById,
    sourceSettingsNotice,
    engineNotice,
    assignmentNotice,
    parseNotice,
    recalculationNotice,
    sourceVsPlannerContextNotice,
  };
}
