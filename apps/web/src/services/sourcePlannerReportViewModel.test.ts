import type {
    CalendarId,
    ScheduleResultMap,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
    Task,
    WorkMinutes,
} from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { buildSourcePlannerRecalculationReport } from "./sourcePlannerReportViewModel";

function calId(value: string): CalendarId {
  return value as CalendarId;
}

function wm(value: number): WorkMinutes {
  return value as WorkMinutes;
}

const tasks: Task[] = [
  {
    id: "S1",
    name: "Summary",
    durationWorkMinutes: wm(0),
    siblingOrder: "A",
  },
  {
    id: "T1",
    parentId: "S1",
    sourceActivityId: "A100",
    name: "Task 100",
    durationWorkMinutes: wm(480),
    siblingOrder: "B",
    assignedCalendarId: calId("6726"),
    constraintType: "SNET",
    constraintDateMinutes: wm(0),
  },
  {
    id: "T2",
    sourceActivityId: "A200",
    name: "Task 200",
    durationWorkMinutes: wm(480),
    siblingOrder: "C",
  },
];

const scheduleResults: ScheduleResultMap = {
  T1: {
    earlyStartMinutes: wm(0),
    earlyFinishMinutes: wm(1 / 3),
    lateStartMinutes: wm(0),
    lateFinishMinutes: wm(1 / 3),
    totalFloatMinutes: wm(120),
    isCritical: false,
  },
  T2: {
    earlyStartMinutes: wm(2 / 3),
    earlyFinishMinutes: wm(1),
    lateStartMinutes: wm(2 / 3),
    lateFinishMinutes: wm(1),
    totalFloatMinutes: wm(0),
    isCritical: true,
  },
};

const sourceImportRecord: SourceImportRecord = {
  format: "xer",
  sourceFileName: "therme.xer",
  status: "plannerCalculatedWithVariance",
  importedAt: "2026-05-10T10:00:00Z",
  summary: {
    taskCount: 2,
    dependencyCount: 1,
    resourceCount: 0,
    assignmentCount: 0,
    calendarInfo: "6726",
    calendarFidelity: {
      totalCalendars: 1,
      taskCalendarAssignments: 67,
      resourceCalendarAssignments: 0,
      exceptionCount: 1,
      calendarsWithInheritance: 0,
      calendarsSimplifiedForEngine: 1,
    },
  },
  diagnostics: [
    {
      code: "CALENDAR_SIMPLIFIED_FOR_ENGINE",
      severity: "info",
      message: "calendar simplified",
    },
    {
      code: "TASK_CALENDAR_IGNORED_BY_ENGINE",
      severity: "info",
      message: "task calendars preserved but inactive",
    },
  ],
  sourceProjectSettings: {
    sourceProjectId: "Therme",
    mustFinishBy: "2026-09-30 08:00",
    defaultCalendarId: "6726",
    defaultCalendarName: "TPID Calender _ 6 working days with PH",
  },
  calendarDefinitions: {
    [calId("6726")]: {
      id: calId("6726"),
      name: "TPID Calender _ 6 working days with PH",
      weeklyPattern: {},
      exceptions: [],
    },
  },
};

const sourceImportFidelityState: SourceImportFidelityState = {
  actualsByTaskId: {
    T1: {
      actualStartMinutes: wm(0),
      remainingDurationWorkMinutes: wm(240),
    },
  },
  progressByTaskId: {},
  sourceDatesByTaskId: {
    T1: {
      sourceStartMinutes: 0,
      sourceFinishMinutes: 480,
    },
    T2: {
      sourceStartMinutes: 960,
      sourceFinishMinutes: 1560,
    },
  },
};

const varianceReport: SourceCalculatedVarianceReport = {
  totalCompared: 2,
  noVarianceCount: 0,
  startVarianceCount: 1,
  finishVarianceCount: 1,
  majorVarianceCount: 0,
  generatedAt: "2026-05-10T10:00:00Z",
  taskVariances: [
    {
      taskId: "T1",
      sourceActivityId: "A100",
      taskName: "Task 100",
      sourceStartMinutes: 0,
      sourceFinishMinutes: 480,
      calculatedStartMinutes: 0,
      calculatedFinishMinutes: 480,
      startVarianceMinutes: 0,
      finishVarianceMinutes: 0,
      varianceSeverity: "none",
      possibleReasons: [],
      calendarRiskRelated: true,
      constraintRiskRelated: false,
    },
    {
      taskId: "T2",
      sourceActivityId: "A200",
      taskName: "Task 200",
      sourceStartMinutes: 960,
      sourceFinishMinutes: 1560,
      calculatedStartMinutes: 960,
      calculatedFinishMinutes: 1440,
      startVarianceMinutes: 0,
      finishVarianceMinutes: -120,
      varianceSeverity: "minor",
      possibleReasons: ["Dependency logic and scheduling assumptions differ from source system"],
      calendarRiskRelated: false,
      constraintRiskRelated: false,
    },
  ],
};

describe("buildSourcePlannerRecalculationReport", () => {
  it("builds summary with distinct source rollup finish, must-finish-by, and planner rollup finish", () => {
    const report = buildSourcePlannerRecalculationReport({
      sourceImportRecord,
      sourceImportFidelityState,
      sourceCalculatedVarianceReport: varianceReport,
      tasks,
      scheduleResults,
      projectStartDate: "2026-01-01",
      dateDisplayFormat: "YYYY-MM-DD HH:mm",
    });

    expect(report.summary.projectName).toBe("Therme");
    expect(report.summary.importedSourceRollupFinish).toBe("2026-01-02 02:00");
    expect(report.summary.projectMustFinishBy).toBe("2026-09-30 08:00");
    expect(report.summary.plannerRollupFinish).toBe("2026-01-02 00:00");
    expect(report.summary.highlightedDiagnostics.some((d) => d.includes("CALENDAR_SIMPLIFIED_FOR_ENGINE"))).toBe(true);
    expect(report.summary.highlightedDiagnostics.some((d) => d.includes("TASK_CALENDAR_IGNORED_BY_ENGINE"))).toBe(true);
  });

  it("creates activity-level rows with source/planner starts and finishes plus reason tags", () => {
    const report = buildSourcePlannerRecalculationReport({
      sourceImportRecord,
      sourceImportFidelityState,
      sourceCalculatedVarianceReport: varianceReport,
      tasks,
      scheduleResults,
      projectStartDate: "2026-01-01",
      dateDisplayFormat: "YYYY-MM-DD HH:mm",
    });

    const rowT1 = report.rows.find((r) => r.taskId === "T1");
    expect(rowT1?.sourceStart).toBe("2026-01-01 00:00");
    expect(rowT1?.plannerStart).toBe("2026-01-01 00:00");
    expect(rowT1?.sourceFinish).toBe("2026-01-01 08:00");
    expect(rowT1?.plannerFinish).toBe("2026-01-01 08:00");
    expect(rowT1?.reasonTag).toBe("calendar_risk");

    const rowT2 = report.rows.find((r) => r.taskId === "T2");
    expect(rowT2?.sourceStart).toBe("2026-01-01 16:00");
    expect(rowT2?.plannerStart).toBe("2026-01-01 16:00");
    expect(rowT2?.sourceFinish).toBe("2026-01-02 02:00");
    expect(rowT2?.plannerFinish).toBe("2026-01-02 00:00");
    expect(rowT2?.finishVariance).toBe("-0.08d");
  });

  it("uses scheduleResults as planner date source-of-truth after recalculation", () => {
    const mismatchedVariance: SourceCalculatedVarianceReport = {
      ...varianceReport,
      taskVariances: varianceReport.taskVariances.map((v) =>
        v.taskId === "T1"
          ? {
              ...v,
              // Intentionally mismatched planner values to verify scheduleResults wins.
              calculatedStartMinutes: 9999,
              calculatedFinishMinutes: 19999,
            }
          : v,
      ),
    };

    const report = buildSourcePlannerRecalculationReport({
      sourceImportRecord,
      sourceImportFidelityState,
      sourceCalculatedVarianceReport: mismatchedVariance,
      tasks,
      scheduleResults,
      projectStartDate: "2026-01-01",
      dateDisplayFormat: "YYYY-MM-DD HH:mm",
    });

    const rowT1 = report.rows.find((r) => r.taskId === "T1");
    expect(rowT1?.plannerStart).toBe("2026-01-01 00:00");
    expect(rowT1?.plannerFinish).toBe("2026-01-01 08:00");
    expect(rowT1?.plannerStart).not.toBe("2026-01-07 22:39");
  });

  it("does not mutate source dates while building the report", () => {
    const before = JSON.stringify(sourceImportFidelityState.sourceDatesByTaskId);

    buildSourcePlannerRecalculationReport({
      sourceImportRecord,
      sourceImportFidelityState,
      sourceCalculatedVarianceReport: varianceReport,
      tasks,
      scheduleResults,
      projectStartDate: "2026-01-01",
      dateDisplayFormat: "YYYY-MM-DD",
    });

    expect(JSON.stringify(sourceImportFidelityState.sourceDatesByTaskId)).toBe(before);
  });

  describe("date movement variance calculation (calendar days, not working days)", () => {
    it("calculates finish movement using calendar days (1440 min/day), not working days (480 min/day)", () => {
      // Sep 30 08:00 (273 days * 1440 + 480) = 392160 minutes
      // Feb 20 16:00 (51 days * 1440 + 960) = 72960 minutes
      // Difference: -319200 minutes = -221.67 calendar days
      const variance: SourceCalculatedVarianceReport = {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 0,
        finishVarianceCount: 1,
        majorVarianceCount: 0,
        generatedAt: "2026-05-10T10:00:00Z",
        taskVariances: [
          {
            taskId: "TME_GN1050",
            sourceActivityId: "TME_GN1050",
            taskName: "Therme Activity",
            sourceStartMinutes: 391680, // Sep 30 08:00
            sourceFinishMinutes: 391680,
            calculatedStartMinutes: 72960, // Feb 20 08:00
            calculatedFinishMinutes: 72960 + 480, // Feb 20 16:00
            startVarianceMinutes: -318720, // -221.33 calendar days
            finishVarianceMinutes: -319200, // -221.67 calendar days
            varianceSeverity: "major",
            possibleReasons: [],
            calendarRiskRelated: false,
            constraintRiskRelated: false,
          },
        ],
      };

      const report = buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport: variance,
        tasks,
        scheduleResults,
        projectStartDate: "2026-01-01",
        dateDisplayFormat: "YYYY-MM-DD HH:mm",
      });

      // Verify finish movement is using calendar days: -318240 / 1440 = -221.00
      expect(report.summary.finishMovement).toBe("-221.00d");
      // NOT -665.00d (which would be -319200 / 480 × 3)
      expect(report.summary.finishMovement).not.toBe("-665.00d");
    });

    it("calculates activity finish variance using calendar days", () => {
      const variance: SourceCalculatedVarianceReport = {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 0,
        finishVarianceCount: 1,
        majorVarianceCount: 0,
        generatedAt: "2026-05-10T10:00:00Z",
        taskVariances: [
          {
            taskId: "TME_GN1050",
            sourceActivityId: "TME_GN1050",
            taskName: "Therme Activity",
            sourceStartMinutes: 391680, // Sep 30 08:00
            sourceFinishMinutes: 391680,
            calculatedStartMinutes: 72960, // Feb 20 08:00
            calculatedFinishMinutes: 73440, // Feb 20 16:00
            startVarianceMinutes: 0,
            finishVarianceMinutes: -318240, // 73440 - 391680 = -318240 minutes = -221.00 calendar days
            varianceSeverity: "major",
            possibleReasons: [],
            calendarRiskRelated: false,
            constraintRiskRelated: false,
          },
        ],
      };

      const report = buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport: variance,
        tasks,
        scheduleResults,
        projectStartDate: "2026-01-01",
        dateDisplayFormat: "YYYY-MM-DD HH:mm",
      });

      const row = report.rows.find((r) => r.taskId === "TME_GN1050");
      expect(row?.finishVariance).toBe("-221.00d");
      expect(row?.finishVariance).not.toBe("-665.00d");
    });

    it("calculates activity start variance using calendar days", () => {
      const variance: SourceCalculatedVarianceReport = {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 1,
        finishVarianceCount: 0,
        majorVarianceCount: 0,
        generatedAt: "2026-05-10T10:00:00Z",
        taskVariances: [
          {
            taskId: "TME_GN1050",
            sourceActivityId: "TME_GN1050",
            taskName: "Therme Activity",
            sourceStartMinutes: 391680, // Sep 30 08:00
            sourceFinishMinutes: 391680,
            calculatedStartMinutes: 72960, // Feb 20 08:00
            calculatedFinishMinutes: 73440, // Feb 20 16:00
            startVarianceMinutes: -318720, // (72960 - 391680) = -222.00 calendar days
            finishVarianceMinutes: 0,
            varianceSeverity: "major",
            possibleReasons: [],
            calendarRiskRelated: false,
            constraintRiskRelated: false,
          },
        ],
      };

      const report = buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport: variance,
        tasks,
        scheduleResults,
        projectStartDate: "2026-01-01",
        dateDisplayFormat: "YYYY-MM-DD HH:mm",
      });

      const row = report.rows.find((r) => r.taskId === "TME_GN1050");
      expect(row?.startVariance).toBe("-221.33d");
      expect(row?.startVariance).not.toBe("-666.00d");
    });

    it("separates date movement variance from duration variance", () => {
      // Task with 1-day duration in both source and planner
      // But different start/finish in calendar terms
      const variance: SourceCalculatedVarianceReport = {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 0,
        finishVarianceCount: 0,
        majorVarianceCount: 0,
        generatedAt: "2026-05-10T10:00:00Z",
        taskVariances: [
          {
            taskId: "T_DUR",
            sourceActivityId: "T_DUR",
            taskName: "Duration Test",
            sourceStartMinutes: 0, // Jan 1 00:00
            sourceFinishMinutes: 1440, // Jan 2 00:00 (1 calendar day = 1440 minutes)
            calculatedStartMinutes: 0,
            calculatedFinishMinutes: 1440,
            startVarianceMinutes: 0,
            finishVarianceMinutes: 0,
            varianceSeverity: "none",
            possibleReasons: [],
            calendarRiskRelated: false,
            constraintRiskRelated: false,
          },
        ],
      };

      const report = buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport: variance,
        tasks,
        scheduleResults,
        projectStartDate: "2026-01-01",
        dateDisplayFormat: "YYYY-MM-DD",
      });

      const row = report.rows.find((r) => r.taskId === "T_DUR");
      // Duration is displayed in working days (480 min/day): 1440 / 480 = 3.00d
      expect(row?.sourceDuration).toBe("3.00d");
      expect(row?.plannerDuration).toBe("3.00d");
      // Duration variance is 0, so displays as 0.00d
      expect(row?.durationVariance).toBe("0.00d");
    });

    it("milestone with zero duration displays correctly", () => {
      const variance: SourceCalculatedVarianceReport = {
        totalCompared: 1,
        noVarianceCount: 0,
        startVarianceCount: 0,
        finishVarianceCount: 0,
        majorVarianceCount: 0,
        generatedAt: "2026-05-10T10:00:00Z",
        taskVariances: [
          {
            taskId: "T_MS",
            sourceActivityId: "T_MS",
            taskName: "Milestone",
            sourceStartMinutes: 1440, // Jan 2
            sourceFinishMinutes: 1440, // Jan 2 (zero duration)
            calculatedStartMinutes: 1440,
            calculatedFinishMinutes: 1440,
            startVarianceMinutes: 0,
            finishVarianceMinutes: 0,
            varianceSeverity: "none",
            possibleReasons: [],
            calendarRiskRelated: false,
            constraintRiskRelated: false,
          },
        ],
      };

      const report = buildSourcePlannerRecalculationReport({
        sourceImportRecord,
        sourceImportFidelityState,
        sourceCalculatedVarianceReport: variance,
        tasks,
        scheduleResults,
        projectStartDate: "2026-01-01",
        dateDisplayFormat: "YYYY-MM-DD",
      });

      const row = report.rows.find((r) => r.taskId === "T_MS");
      // Zero duration = 0.00d (not inflated to 1 day)
      expect(row?.sourceDuration).toBe("0.00d");
      expect(row?.plannerDuration).toBe("0.00d");
      expect(row?.durationVariance).toBe("0.00d");
    });
  });
});
