import type {
    DiagnosticsMap,
    ImportDiagnostic,
    ScheduleResultMap,
    SourceTaskDates,
    Task,
    WorkMinutes,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { computeSourceVarianceReport } from "../../src/import/computeVarianceReport.js";

const makeTask = (id: string, name: string, sourceActivityId?: string): Task => ({
  id,
  name,
  sourceActivityId,
  durationWorkMinutes: MINUTES_PER_DAY,
  siblingOrder: "a",
  constraintType: "ASAP",
  constraintDateMinutes: null,
});

const makeScheduleResult = (earlyStart: number, earlyFinish: number) => ({
  earlyStartMinutes: earlyStart as WorkMinutes,
  earlyFinishMinutes: earlyFinish as WorkMinutes,
  lateStartMinutes: earlyStart as WorkMinutes,
  lateFinishMinutes: earlyFinish as WorkMinutes,
  totalFloatMinutes: 0 as WorkMinutes,
  isCritical: false,
});

describe("computeSourceVarianceReport", () => {
  it("normalizes day-based calculated offsets before comparing to source minute offsets", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = {
      // Day offsets (0d -> 6d) from planner projection
      t1: makeScheduleResult(0, 6),
    };
    const sourceDates: Record<string, SourceTaskDates> = {
      // Same span in minutes (0 -> 6 days)
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: MINUTES_PER_DAY * 6 },
    };

    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.totalCompared).toBe(1);
    expect(report.noVarianceCount).toBe(1);
    expect(report.startVarianceCount).toBe(0);
    expect(report.finishVarianceCount).toBe(0);
    expect(report.majorVarianceCount).toBe(0);
    expect(report.taskVariances[0].calculatedFinishMinutes).toBe(MINUTES_PER_DAY * 6);
    expect(report.taskVariances[0].finishVarianceMinutes).toBe(0);
  });

  it("keeps minute-based calculated offsets unchanged when already aligned to source", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = {
      // Minute offsets
      t1: makeScheduleResult(60, 540),
    };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };

    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.totalCompared).toBe(1);
    expect(report.taskVariances[0].calculatedStartMinutes).toBe(60);
    expect(report.taskVariances[0].calculatedFinishMinutes).toBe(540);
    expect(report.taskVariances[0].startVarianceMinutes).toBe(60);
    expect(report.taskVariances[0].finishVarianceMinutes).toBe(60);
  });

  it("returns empty report when no source dates are supplied", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(0, 480) };
    const sourceDates: Record<string, SourceTaskDates> = {};
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.totalCompared).toBe(0);
    expect(report.taskVariances).toHaveLength(0);
  });

  it("reports no variance when calculated dates match source dates exactly", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(0, 480) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.totalCompared).toBe(1);
    expect(report.noVarianceCount).toBe(1);
    expect(report.startVarianceCount).toBe(0);
    expect(report.finishVarianceCount).toBe(0);
    expect(report.majorVarianceCount).toBe(0);
    expect(report.taskVariances[0].varianceSeverity).toBe("none");
  });

  it("classifies minor variance when difference is less than 1 day", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(60, 540) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.taskVariances[0].varianceSeverity).toBe("minor");
    expect(report.taskVariances[0].startVarianceMinutes).toBe(60);
    expect(report.taskVariances[0].finishVarianceMinutes).toBe(60);
  });

  it("classifies moderate variance between 1 and 5 days", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const twoDays = MINUTES_PER_DAY * 2;
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(twoDays, twoDays + 480) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.taskVariances[0].varianceSeverity).toBe("moderate");
  });

  it("classifies major variance above 5 days", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const sixDays = MINUTES_PER_DAY * 6;
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(sixDays, sixDays + 480) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.taskVariances[0].varianceSeverity).toBe("major");
    expect(report.majorVarianceCount).toBe(1);
  });

  it("sorts task variances by descending magnitude", () => {
    const tasks = [makeTask("t1", "Small"), makeTask("t2", "Large")];
    const scheduleResults: ScheduleResultMap = {
      t1: makeScheduleResult(240, 720),   // 0.5d variance from source
      t2: makeScheduleResult(MINUTES_PER_DAY * 10, MINUTES_PER_DAY * 11), // 10d variance
    };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
      t2: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.taskVariances[0].taskName).toBe("Large");
    expect(report.taskVariances[1].taskName).toBe("Small");
  });

  it("marks calendarRiskRelated when task has SUPERSEDED_BY_CALENDAR diagnostic", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(MINUTES_PER_DAY, MINUTES_PER_DAY * 2) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const diagnosticsMap: DiagnosticsMap = { t1: ["SUPERSEDED_BY_CALENDAR"] };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, diagnosticsMap, []);
    expect(report.taskVariances[0].calendarRiskRelated).toBe(true);
  });

  it("marks calendarRiskRelated from import diagnostics calendar code", () => {
    const tasks = [makeTask("t1", "Task 1")];
    const scheduleResults: ScheduleResultMap = { t1: makeScheduleResult(MINUTES_PER_DAY, MINUTES_PER_DAY * 2) };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
    };
    const importDiagnostics: ImportDiagnostic[] = [{
      code: "CALENDAR_SIMPLIFIED_FOR_ENGINE",
      severity: "info",
      message: "calendar simplified",
      canonicalEntityId: "t1",
    }];
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, importDiagnostics);
    expect(report.taskVariances[0].calendarRiskRelated).toBe(true);
  });

  it("skips tasks with no source dates entry", () => {
    const tasks = [makeTask("t1", "Task 1"), makeTask("t2", "Task 2")];
    const scheduleResults: ScheduleResultMap = {
      t1: makeScheduleResult(0, 480),
      t2: makeScheduleResult(0, 480),
    };
    const sourceDates: Record<string, SourceTaskDates> = {
      t1: { sourceStartMinutes: 0, sourceFinishMinutes: 480 },
      // t2 has no source dates
    };
    const report = computeSourceVarianceReport(tasks, scheduleResults, sourceDates, {}, []);
    expect(report.totalCompared).toBe(1);
  });

  it("populates generatedAt as ISO string", () => {
    const before = new Date().toISOString();
    const report = computeSourceVarianceReport([], {}, {}, {}, []);
    expect(report.generatedAt >= before).toBe(true);
  });
});
