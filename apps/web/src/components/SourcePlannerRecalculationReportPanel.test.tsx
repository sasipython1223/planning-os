// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourcePlannerRecalculationReportViewModel } from "../services/sourcePlannerReportViewModel";
import { SourcePlannerRecalculationReportPanel } from "./SourcePlannerRecalculationReportPanel";

afterEach(() => {
  cleanup();
});

const VIEW_MODEL: SourcePlannerRecalculationReportViewModel = {
  summary: {
    projectName: "Therme",
    importedSourceRollupFinish: "2026-01-02 02:00",
    projectMustFinishBy: "2026-09-30 08:00",
    plannerRollupFinish: "2026-01-02 00:00",
    finishMovement: "-0.08d",
    activitiesCompared: 2,
    startDifferences: 1,
    finishDifferences: 1,
    majorVariances: 0,
    calendarRiskLevel: "high",
    highlightedDiagnostics: [
      "CALENDAR_SIMPLIFIED_FOR_ENGINE: calendar simplified",
      "TASK_CALENDAR_IGNORED_BY_ENGINE: task calendars preserved but inactive",
    ],
    explanatoryText: "Imported source dates are preserved. Planner-calculated dates are separate.",
  },
  rows: [
    {
      taskId: "T1",
      activityId: "A100",
      activityName: "Task 100",
      wbsPath: "Summary / Task 100",
      sourceStart: "2026-01-01 00:00",
      plannerStart: "2026-01-01 00:00",
      startVariance: "0.00d",
      sourceFinish: "2026-01-01 08:00",
      plannerFinish: "2026-01-01 08:00",
      finishVariance: "0.00d",
      sourceDuration: "1.00d",
      plannerDuration: "1.00d",
      durationVariance: "0.00d",
      sourceTotalFloat: "0",
      plannerTotalFloat: "120",
      floatVariance: "—",
      calendarId: "6726",
      calendarName: "TPID Calender _ 6 working days with PH",
      reasonTag: "calendar_risk",
      reasonLabel: "Likely calendar-related.",
    },
  ],
};

describe("SourcePlannerRecalculationReportPanel", () => {
  it("renders summary fields for source rollup, must-finish-by, and planner rollup", () => {
    render(<SourcePlannerRecalculationReportPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);

    expect(screen.getByTestId("report-source-rollup-finish").textContent).toBe("2026-01-02 02:00");
    expect(screen.getByTestId("report-must-finish-by").textContent).toBe("2026-09-30 08:00");
    expect(screen.getByTestId("report-planner-rollup-finish").textContent).toBe("2026-01-02 00:00");
  });

  it("renders source/planner start and finish columns plus reason tag", () => {
    render(<SourcePlannerRecalculationReportPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);

    const row = screen.getByTestId("report-row-T1");
    expect(row.textContent).toContain("2026-01-01 00:00");
    expect(row.textContent).toContain("2026-01-01 08:00");
    expect(row.textContent).toContain("calendar_risk");
  });

  it("shows highlighted high-risk diagnostics", () => {
    render(<SourcePlannerRecalculationReportPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);

    const diagnosticsList = screen.getByTestId("report-diagnostics-list");
    expect(diagnosticsList.textContent).toContain("CALENDAR_SIMPLIFIED_FOR_ENGINE");
    expect(diagnosticsList.textContent).toContain("TASK_CALENDAR_IGNORED_BY_ENGINE");
  });

  it("invokes onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SourcePlannerRecalculationReportPanel viewModel={VIEW_MODEL} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
