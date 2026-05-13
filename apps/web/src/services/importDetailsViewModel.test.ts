import type {
    BaseCalendarDefinition,
    CalendarId,
    ScheduleLifecycleState,
    SourceImportFidelityState,
    SourceImportRecord,
    SourceTaskDates,
    Task,
    VisibleRow,
    WorkMinutes,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { buildImportDetailsViewModel } from "./importDetailsViewModel";

function calId(v: string): CalendarId {
  return v as CalendarId;
}

function makeCal(
  id: string,
  name: string,
  opts: {
    parentId?: string;
    monFriHours?: number;
    sourceHoursPerDay?: number;
    sourceHoursPerWeek?: number;
    sourceHoursPerMonth?: number;
    sourceHoursPerYear?: number;
    workingPatternSource?: BaseCalendarDefinition["workingPatternSource"];
    exceptions?: Array<{ date: string; workIntervals: Array<{ startMinute: number; endMinute: number }>; name?: string }>;
  } = {},
): BaseCalendarDefinition {
  const dayHours = opts.monFriHours ?? 8;
  const weeklyPattern = dayHours > 0
    ? {
        1: [{ startMinute: 8 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: (13 + dayHours - 4) * 60 }],
        2: [{ startMinute: 8 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: (13 + dayHours - 4) * 60 }],
        3: [{ startMinute: 8 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: (13 + dayHours - 4) * 60 }],
        4: [{ startMinute: 8 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: (13 + dayHours - 4) * 60 }],
        5: [{ startMinute: 8 * 60, endMinute: 12 * 60 }, { startMinute: 13 * 60, endMinute: (13 + dayHours - 4) * 60 }],
      }
    : {};

  return {
    id: calId(id),
    name,
    sourceHoursPerDay: opts.sourceHoursPerDay,
    sourceHoursPerWeek: opts.sourceHoursPerWeek,
    sourceHoursPerMonth: opts.sourceHoursPerMonth,
    sourceHoursPerYear: opts.sourceHoursPerYear,
    workingPatternSource: opts.workingPatternSource,
    weeklyPattern,
    exceptions: (opts.exceptions ?? []).map((e) => ({ date: e.date, workIntervals: e.workIntervals, name: e.name })),
    parentCalendarId: opts.parentId ? calId(opts.parentId) : undefined,
  };
}

function makeRecord(): SourceImportRecord {
  const defs: Record<CalendarId, BaseCalendarDefinition> = {
    [calId("CAL_BASE")]: makeCal("CAL_BASE", "Base Calendar", {
      exceptions: [{ date: "2026-05-09", workIntervals: [] }],
    }),
    [calId("CAL_PROJ")]: makeCal("CAL_PROJ", "Project Calendar", { parentId: "CAL_BASE" }),
    [calId("CAL_RES")]: makeCal("CAL_RES", "Resource Calendar", { monFriHours: 6 }),
  } as Record<CalendarId, BaseCalendarDefinition>;

  const resolved: Record<CalendarId, BaseCalendarDefinition> = {
    ...defs,
    [calId("CAL_PROJ")]: {
      ...defs[calId("CAL_PROJ")],
      exceptions: [...defs[calId("CAL_BASE")].exceptions, ...defs[calId("CAL_PROJ")].exceptions],
    },
  };

  return {
    format: "xer",
    sourceFileName: "my-project.xer",
    status: "sourceImportedNotCalculated",
    importedAt: "2026-05-09T10:00:00Z",
    summary: {
      taskCount: 2,
      dependencyCount: 1,
      resourceCount: 1,
      assignmentCount: 1,
      calendarInfo: "calendar summary",
      sourceDataDate: "2026-05-08",
      sourceStatusDate: "2026-05-09",
      calendarFidelity: {
        totalCalendars: 3,
        taskCalendarAssignments: 2,
        resourceCalendarAssignments: 1,
        exceptionCount: 1,
        calendarsWithInheritance: 1,
        calendarsSimplifiedForEngine: 1,
      },
    },
    diagnostics: [
      {
        code: "CALENDAR_SIMPLIFIED_FOR_ENGINE",
        severity: "info",
        message: "Simplified resource calendar",
        sourceEntityId: "CAL_RES",
      },
      {
        code: "RESOURCE_CALENDAR_PRESERVED_INACTIVE",
        severity: "info",
        message: "Resource calendar preserved",
        sourceEntityId: "CAL_RES",
      },
    ],
    sourceProjectSettings: {
      sourceProjectId: "P6-PROJ-101",
      defaultCalendarId: "CAL_PROJ",
      defaultCalendarName: "Project Calendar",
      dataDate: "2026-05-08",
      statusDate: "2026-05-09",
      mustFinishBy: "2026-06-04",
      hoursPerDay: 8,
      hoursPerWeek: 40,
      hoursPerMonth: 160,
      rawScheduleOptions: { "critical_float": "0" },
    },
    calendarDefinitions: defs,
    resolvedCalendarDefinitions: resolved,
    sourceImportFidelityState: {
      actualsByTaskId: {},
      progressByTaskId: {},
      sourceDatesByTaskId: {},
    },
  };
}

function makeTasks(): Task[] {
  return [
    {
      id: "S1",
      name: "Summary",
      durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
      siblingOrder: "A",
    },
    {
      id: "T1",
      parentId: "S1",
      sourceActivityId: "A100",
      name: "Task 100",
      durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
      siblingOrder: "B",
      assignedCalendarId: calId("CAL_PROJ"),
    },
    {
      id: "T2",
      sourceActivityId: "A200",
      name: "Task 200",
      durationWorkMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes,
      siblingOrder: "C",
      assignedCalendarId: calId("CAL_RES"),
    },
  ];
}

function makeVisibleRows(): VisibleRow[] {
  return [
    {
      id: "T1",
      name: "Task 100",
      sourceActivityId: "A100",
      durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
      siblingOrder: "B",
      depth: 1,
      isSummary: false,
      isCollapsed: false,
      canExpand: false,
      wbsCode: "1.1",
      rollupStartMinutes: null,
      rollupFinishMinutes: null,
      rollupDurationMinutes: null,
      rollupCost: null,
      rollupWorkMinutes: null,
      rollupPercentComplete: null,
      assignedCalendarId: calId("CAL_PROJ"),
      computationalCalendarId: calId("default"),
    },
  ];
}

function makeFidelity(): SourceImportFidelityState {
  const sourceDates: Record<string, SourceTaskDates> = {
    T1: {
      sourceStartMinutes: 123 * 24 * 60,
      sourceFinishMinutes: 150 * 24 * 60,
    },
  };
  return {
    actualsByTaskId: {},
    progressByTaskId: {},
    sourceDatesByTaskId: sourceDates,
  };
}

describe("buildImportDetailsViewModel", () => {
  it("returns null when source import record is absent", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: null,
      sourceImportFidelityState: { actualsByTaskId: {}, progressByTaskId: {} },
      scheduleLifecycle: "empty",
      sourceCalculatedVarianceReport: null,
      tasks: [],
      visibleRows: [],
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });
    expect(vm).toBeNull();
  });

  it("formats project start with selected date format", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "YYYY-MM-DD",
    });
    expect(vm?.projectDetails.projectStart).toBe("2026-05-08");
  });

  it("shows data date and status date", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });
    expect(vm?.projectDetails.dataDate).toBe("08-May-26");
    expect(vm?.projectDetails.statusDate).toBe("09-May-26");
  });

  it("keeps mustFinishBy as project metadata and exposes source rollup finish separately before recalculation", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });

    expect(vm?.projectDetails.mustFinishBy).toBe("04-Jun-26");
    expect(vm?.projectDetails.sourceRollupFinish).toBe("04-Jun-26");
    expect(vm?.projectDetails.plannerRollupFinish).toBeUndefined();
  });

  it("exposes planner rollup finish after recalculation without overwriting mustFinishBy", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "plannerCalculatedWithVariance",
      sourceCalculatedVarianceReport: {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 1,
        finishVarianceCount: 1,
        majorVarianceCount: 1,
        generatedAt: "2026-05-09T10:00:00Z",
        taskVariances: [
          {
            taskId: "T1",
            taskName: "Task 100",
            sourceStartMinutes: 123 * 24 * 60,
            sourceFinishMinutes: 150 * 24 * 60,
            calculatedStartMinutes: 120 * 24 * 60,
            calculatedFinishMinutes: 140 * 24 * 60,
            startVarianceMinutes: -3 * 24 * 60,
            finishVarianceMinutes: -10 * 24 * 60,
            varianceSeverity: "major",
            possibleReasons: ["Calendar interpretation differences between source and planner calculation"],
            calendarRiskRelated: true,
            constraintRiskRelated: false,
          },
        ],
      },
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });

    expect(vm?.projectDetails.mustFinishBy).toBe("04-Jun-26");
    expect(vm?.projectDetails.sourceRollupFinish).toBe("04-Jun-26");
    expect(vm?.projectDetails.plannerRollupFinish).toBe("25-May-26");
  });

  it("shows default calendar and hours per period", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });
    expect(vm?.projectDetails.defaultCalendar).toBe("Project Calendar");
    expect(vm?.projectDetails.hoursPerDay).toBe(8);
    expect(vm?.projectDetails.hoursPerWeek).toBe(40);
    expect(vm?.projectDetails.hoursPerMonth).toBe(160);
  });

  it("builds calendar list with parent/base and exception counts", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });
    expect(vm?.calendars).toHaveLength(3);
    const proj = vm?.calendars.find((c) => c.id === "CAL_PROJ");
    expect(proj?.parentCalendarId).toBe("CAL_BASE");
    expect(proj?.exceptionCount).toBe(1);
  });

  it("calendar detail includes weekly Sun-Sat rows and inheritance status", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });
    const detail = vm?.calendarDetailsById["CAL_PROJ"];
    expect(detail?.weeklyHoursByDay).toHaveLength(7);
    expect(detail?.inheritanceResolved).toBe(true);
  });

  it("used-by activities include source start/finish formatted with selected format", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });
    const detail = vm?.calendarDetailsById["CAL_PROJ"];
    const activity = detail?.assignedActivities.find((a) => a.taskId === "T1");
    expect(activity?.sourceStart).toBe("08-May-26");
    expect(activity?.sourceFinish).toBe("04-Jun-26");
  });

  it("does not mutate lifecycle input while mapping", () => {
    const record = makeRecord();
    const lifecycle: ScheduleLifecycleState = "sourceImportedNotCalculated";
    const before = lifecycle;

    buildImportDetailsViewModel({
      sourceImportRecord: record,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: lifecycle,
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    expect(lifecycle).toBe(before);
    expect(record.status).toBe("sourceImportedNotCalculated");
  });

  it("uses inferred period totals for a 5-day calendar when detailed periods are unavailable", () => {
    const record = makeRecord();
    const fallback = makeCal("CAL_P6_INF_5D", "P6 Fallback 5 Day", {
      monFriHours: 0,
      sourceHoursPerDay: 8,
      sourceHoursPerWeek: 40,
      sourceHoursPerMonth: 160,
      sourceHoursPerYear: 2080,
      workingPatternSource: "inferred-hours",
    });
    const sourceImportRecord: SourceImportRecord = {
      ...record,
      calendarDefinitions: {
        ...(record.calendarDefinitions ?? {}),
        [calId("CAL_P6_INF_5D")]: fallback,
      },
      resolvedCalendarDefinitions: {
        ...(record.resolvedCalendarDefinitions ?? {}),
        [calId("CAL_P6_INF_5D")]: fallback,
      },
    };

    const vm = buildImportDetailsViewModel({
      sourceImportRecord,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById.CAL_P6_INF_5D;
    expect(detail?.hoursPerWeek).toBe(40);
    expect(detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Mon")?.hours).toBe(8);
    expect(detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Fri")?.hours).toBe(8);
    expect(detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Sat")?.hours).toBe(0);
    expect(detail?.workingPatternSummary).toContain("Inferred 5 working days, 40h/week");
    expect(detail?.parseWarningMessage).toContain("inferred from source P6 period totals");
  });

  it("uses inferred period totals for a 6-day calendar when ratio implies Mon-Sat work", () => {
    const record = makeRecord();
    const fallback = makeCal("CAL_P6_INF_6D", "P6 Fallback 6 Day", {
      monFriHours: 0,
      sourceHoursPerDay: 8,
      sourceHoursPerWeek: 48,
      workingPatternSource: "inferred-hours",
    });
    const sourceImportRecord: SourceImportRecord = {
      ...record,
      calendarDefinitions: {
        ...(record.calendarDefinitions ?? {}),
        [calId("CAL_P6_INF_6D")]: fallback,
      },
      resolvedCalendarDefinitions: {
        ...(record.resolvedCalendarDefinitions ?? {}),
        [calId("CAL_P6_INF_6D")]: fallback,
      },
    };

    const vm = buildImportDetailsViewModel({
      sourceImportRecord,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById.CAL_P6_INF_6D;
    expect(detail?.hoursPerWeek).toBe(48);
    expect(detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Sat")?.hours).toBe(8);
    expect(detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Sun")?.hours).toBe(0);
    expect(detail?.workingPatternSummary).toContain("Inferred 6 working days, 48h/week");
  });

  it("source activity dates in used-by activities are preserved source dates (not planner-calculated)", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "plannerCalculatedWithVariance",
      sourceCalculatedVarianceReport: {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 1,
        finishVarianceCount: 1,
        majorVarianceCount: 1,
        generatedAt: "2026-05-09T10:00:00Z",
        taskVariances: [
          {
            taskId: "T1",
            taskName: "Task 100",
            sourceStartMinutes: 123 * 24 * 60,
            sourceFinishMinutes: 150 * 24 * 60,
            calculatedStartMinutes: 120 * 24 * 60,
            calculatedFinishMinutes: 140 * 24 * 60,
            startVarianceMinutes: -3 * 24 * 60,
            finishVarianceMinutes: -10 * 24 * 60,
            varianceSeverity: "major",
            possibleReasons: ["Calendar interpretation differences"],
            calendarRiskRelated: true,
            constraintRiskRelated: false,
          },
        ],
      },
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById["CAL_PROJ"];
    const activity = detail?.assignedActivities.find((a) => a.taskId === "T1");
    // sourceStart/sourceFinish must be preserved as immutable source dates
    expect(activity?.sourceStart).toBe("08-May-26");
    expect(activity?.sourceFinish).toBe("04-Jun-26");
  });

  it("inferred calendar periods display with '— inferred' suffix, not as exact time intervals", () => {
    const record = makeRecord();
    const inferredCal = makeCal("CAL_INFERRED", "Inferred Calendar", {
      monFriHours: 0,
      sourceHoursPerDay: 8,
      sourceHoursPerWeek: 40,
      workingPatternSource: "inferred-hours",
    });
    const sourceImportRecord: SourceImportRecord = {
      ...record,
      calendarDefinitions: {
        ...(record.calendarDefinitions ?? {}),
        [calId("CAL_INFERRED")]: inferredCal,
      },
      resolvedCalendarDefinitions: {
        ...(record.resolvedCalendarDefinitions ?? {}),
        [calId("CAL_INFERRED")]: inferredCal,
      },
    };

    const vm = buildImportDetailsViewModel({
      sourceImportRecord,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById.CAL_INFERRED;
    const monRow = detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Mon");
    // Should NOT be "08:00–12:00, 13:00–17:00"
    expect(monRow?.periodsText).toBe("8h — inferred");
    expect(monRow?.periodsText).not.toContain(":");
  });

  it("source vs planner context notice is lifecycle-aware before recalculation", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    expect(vm?.sourceVsPlannerContextNotice).toContain("Task table shows the same source dates until recalculation runs");
  });

  it("source vs planner context notice explains difference after recalculation", () => {
    const vm = buildImportDetailsViewModel({
      sourceImportRecord: makeRecord(),
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "plannerCalculatedWithVariance",
      sourceCalculatedVarianceReport: {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 1,
        finishVarianceCount: 1,
        majorVarianceCount: 1,
        generatedAt: "2026-05-09T10:00:00Z",
        taskVariances: [
          {
            taskId: "T1",
            taskName: "Task 100",
            sourceStartMinutes: 123 * 24 * 60,
            sourceFinishMinutes: 150 * 24 * 60,
            calculatedStartMinutes: 120 * 24 * 60,
            calculatedFinishMinutes: 140 * 24 * 60,
            startVarianceMinutes: -3 * 24 * 60,
            finishVarianceMinutes: -10 * 24 * 60,
            varianceSeverity: "major",
            possibleReasons: ["Calendar interpretation differences"],
            calendarRiskRelated: true,
            constraintRiskRelated: false,
          },
        ],
      },
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-01-05",
      dateDisplayFormat: "DD-MMM-YY",
    });

    expect(vm?.sourceVsPlannerContextNotice).toContain("planner-calculated dates after recalculation");
    expect(vm?.sourceVsPlannerContextNotice).toContain("Source vs Planner Report");
  });

  it("parse warning is set when calendar periods are not fully parsed", () => {
    const record = makeRecord();
    const unparsedCal = makeCal("CAL_UNPARSED", "Unparsed Calendar", {
      monFriHours: 0,
      sourceHoursPerDay: 8,
      sourceHoursPerWeek: 40,
      workingPatternSource: "inferred-hours",
    });
    const sourceImportRecord: SourceImportRecord = {
      ...record,
      calendarDefinitions: {
        ...(record.calendarDefinitions ?? {}),
        [calId("CAL_UNPARSED")]: unparsedCal,
      },
      resolvedCalendarDefinitions: {
        ...(record.resolvedCalendarDefinitions ?? {}),
        [calId("CAL_UNPARSED")]: unparsedCal,
      },
    };

    const vm = buildImportDetailsViewModel({
      sourceImportRecord,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "sourceImportedNotCalculated",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById.CAL_UNPARSED;
    expect(detail?.hasParseWarning).toBe(true);
    expect(detail?.parseWarningMessage).toContain("inferred from source P6 period totals");
  });

  it("renders inferred period text instead of exact slots when workingPatternSource is inferred", () => {
    const record = makeRecord();
    const inferredWithIntervals = {
      ...makeCal("CAL_INF_INTERVALS", "Inferred With Intervals", {
        monFriHours: 8,
        sourceHoursPerDay: 8,
        sourceHoursPerWeek: 40,
        workingPatternSource: "inferred-name",
      }),
      weeklyPattern: {
        1: [{ startMinute: 0, endMinute: 8 * 60 }],
        2: [{ startMinute: 0, endMinute: 8 * 60 }],
        3: [{ startMinute: 0, endMinute: 8 * 60 }],
        4: [{ startMinute: 0, endMinute: 8 * 60 }],
        5: [{ startMinute: 0, endMinute: 8 * 60 }],
      },
    };

    const sourceImportRecord: SourceImportRecord = {
      ...record,
      calendarDefinitions: {
        ...(record.calendarDefinitions ?? {}),
        [calId("CAL_INF_INTERVALS")]: inferredWithIntervals,
      },
      resolvedCalendarDefinitions: {
        ...(record.resolvedCalendarDefinitions ?? {}),
        [calId("CAL_INF_INTERVALS")]: inferredWithIntervals,
      },
    };

    const vm = buildImportDetailsViewModel({
      sourceImportRecord,
      sourceImportFidelityState: makeFidelity(),
      scheduleLifecycle: "plannerCalculatedWithVariance",
      sourceCalculatedVarianceReport: null,
      tasks: makeTasks(),
      visibleRows: makeVisibleRows(),
      projectStartDate: "2026-05-08",
      dateDisplayFormat: "DD-MMM-YY",
    });

    const detail = vm?.calendarDetailsById.CAL_INF_INTERVALS;
    const monRow = detail?.weeklyHoursByDay.find((d) => d.dayLabel === "Mon");
    expect(monRow?.periodsText).toBe("8h — inferred");
    expect(monRow?.periodsText).not.toContain(":");
  });
});
