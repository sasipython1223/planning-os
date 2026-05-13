// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportDetailsViewModel } from "../services/importDetailsViewModel";
import { ImportDetailsPanel } from "./ImportDetailsPanel";

afterEach(() => {
  cleanup();
});

const VIEW_MODEL: ImportDetailsViewModel = {
  projectDetails: {
    sourceFormat: "XER",
    fileName: "demo.xer",
    projectName: "Demo",
    sourceProjectId: "P-1",
    projectStart: "08-May-26",
    dataDate: "08-May-26",
    statusDate: "09-May-26",
    mustFinishBy: "04-Jun-26",
    sourceRollupFinish: "04-Jun-26",
    defaultCalendar: "Project Calendar",
    hoursPerDay: 8,
    hoursPerWeek: 40,
    hoursPerMonth: 160,
    hoursPerYear: 2080,
    scheduleOptionsPreservedInactive: true,
    importLifecycle: "sourceImportedNotCalculated",
    recalculationStatus: "Not recalculated yet",
    varianceStatus: "No variance report",
  },
  diagnostics: [],
  calendars: [
    {
      id: "CAL_GLOBAL",
      name: "Global 5d",
      type: "Global",
      isDefault: false,
      usageTaskCount: 0,
      usageResourceCount: 0,
      exceptionCount: 0,
      engineStatus: "PRESERVED_ONLY",
    },
    {
      id: "CAL_PROJECT",
      name: "Project Calendar",
      type: "Project",
      isDefault: true,
      parentCalendarId: "CAL_GLOBAL",
      parentCalendarName: "Global 5d",
      usageTaskCount: 2,
      usageResourceCount: 0,
      exceptionCount: 1,
      engineStatus: "SIMPLIFIED",
    },
    {
      id: "CAL_RESOURCE",
      name: "Resource Calendar",
      type: "Resource",
      isDefault: false,
      usageTaskCount: 0,
      usageResourceCount: 0,
      exceptionCount: 0,
      engineStatus: "PRESERVED_ONLY",
    },
  ],
  calendarDetailsById: {
    CAL_GLOBAL: {
      id: "CAL_GLOBAL",
      sourceCalendarId: "CAL_GLOBAL",
      name: "Global 5d",
      type: "Global",
      inheritanceResolved: true,
      rawSourcePreserved: true,
      engineStatus: "PRESERVED_ONLY",
      hasParseWarning: false,
      weeklyHoursByDay: [
        { dayLabel: "Sun", hours: 0, periodsText: "non-working" },
        { dayLabel: "Mon", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Tue", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Wed", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Thu", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Fri", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Sat", hours: 0, periodsText: "non-working" },
      ],
      workingPatternSummary: "5 working days, 40h/week",
      exceptionCount: 0,
      exceptionCountLocal: 0,
      exceptionCountInherited: 0,
      exceptions: [],
      assignedActivities: [],
      assignedResources: [],
    },
    CAL_PROJECT: {
      id: "CAL_PROJECT",
      sourceCalendarId: "CAL_PROJECT",
      name: "Project Calendar",
      type: "Project",
      parentCalendarId: "CAL_GLOBAL",
      parentCalendarName: "Global 5d",
      inheritanceResolved: true,
      rawSourcePreserved: true,
      engineStatus: "SIMPLIFIED",
      hasParseWarning: true,
      parseWarningMessage: "Detailed P6 calendar data preserved; some rules unresolved.",
      hoursPerDay: 8,
      hoursPerWeek: 40,
      hoursPerMonth: 160,
      hoursPerYear: 2080,
      weeklyHoursByDay: [
        { dayLabel: "Sun", hours: 0, periodsText: "non-working" },
        { dayLabel: "Mon", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Tue", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Wed", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Thu", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Fri", hours: 8, periodsText: "08:00-12:00, 13:00-17:00" },
        { dayLabel: "Sat", hours: 0, periodsText: "non-working" },
      ],
      workingPatternSummary: "5 working days, 40h/week",
      exceptionCount: 1,
      exceptionCountLocal: 1,
      exceptionCountInherited: 0,
      exceptions: [
        {
          date: "09-May-26",
          type: "Nonwork",
          source: "Local",
          parseStatus: "Parsed",
        },
      ],
      assignedActivities: [
        {
          taskId: "T1",
          activityId: "A100",
          activityName: "Task 100",
          wbsPath: "Summary / Task 100",
          sourceStart: "08-May-26",
          sourceFinish: "04-Jun-26",
          assignmentFidelity: "Simplified",
        },
      ],
      assignedResources: [],
    },
    CAL_RESOURCE: {
      id: "CAL_RESOURCE",
      sourceCalendarId: "CAL_RESOURCE",
      name: "Resource Calendar",
      type: "Resource",
      inheritanceResolved: true,
      rawSourcePreserved: true,
      engineStatus: "PRESERVED_ONLY",
      hasParseWarning: false,
      weeklyHoursByDay: [
        { dayLabel: "Sun", hours: 0, periodsText: "non-working" },
        { dayLabel: "Mon", hours: 6, periodsText: "08:00-12:00, 13:00-15:00" },
        { dayLabel: "Tue", hours: 6, periodsText: "08:00-12:00, 13:00-15:00" },
        { dayLabel: "Wed", hours: 6, periodsText: "08:00-12:00, 13:00-15:00" },
        { dayLabel: "Thu", hours: 6, periodsText: "08:00-12:00, 13:00-15:00" },
        { dayLabel: "Fri", hours: 6, periodsText: "08:00-12:00, 13:00-15:00" },
        { dayLabel: "Sat", hours: 0, periodsText: "non-working" },
      ],
      workingPatternSummary: "5 working days, 30h/week",
      exceptionCount: 0,
      exceptionCountLocal: 0,
      exceptionCountInherited: 0,
      exceptions: [],
      assignedActivities: [],
      assignedResources: [],
    },
  },
  sourceSettingsNotice: "Source project settings are preserved for verification.",
  engineNotice: "Planner-Studio recalculation does not yet apply all imported P6/MSP project settings.",
  assignmentNotice: "Activity calendar assignments are preserved, but Planner-Studio recalculation may still use the project/default calendar until engine support is enabled.",
  parseNotice: "Raw source calendar data is preserved, but detailed exceptions are not fully parsed yet.",
  recalculationNotice: "Recalculation may result in different dates due to inactive calendar rules or schedule options.",
  sourceVsPlannerContextNotice: "This view shows imported source dates. Task table shows the same source dates until recalculation runs.",
};

describe("ImportDetailsPanel", () => {
  it("renders project details start date from view model", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    expect(screen.getByTestId("project-details-start").textContent).toBe("08-May-26");
  });

  it("shows Source Rollup Finish before recalculation", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    expect(screen.getByTestId("project-details-source-rollup-finish").textContent).toBe("04-Jun-26");
    expect(screen.queryByTestId("project-details-planner-rollup-finish")).toBeNull();
  });

  it("shows Planner Rollup Finish after recalculation", () => {
    const plannerVm: ImportDetailsViewModel = {
      ...VIEW_MODEL,
      projectDetails: {
        ...VIEW_MODEL.projectDetails,
        importLifecycle: "plannerCalculatedWithVariance",
        plannerRollupFinish: "25-May-26",
      },
    };

    render(<ImportDetailsPanel viewModel={plannerVm} onClose={vi.fn()} />);
    expect(screen.getByTestId("project-details-planner-rollup-finish").textContent).toBe("25-May-26");
    expect(screen.queryByTestId("project-details-source-rollup-finish")).toBeNull();
  });

  it("shows calendar list entries", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    expect(screen.getByTestId("calendar-row-CAL_GLOBAL")).toBeTruthy();
    expect(screen.getByTestId("calendar-row-CAL_PROJECT")).toBeTruthy();
    expect(screen.getByTestId("calendar-row-CAL_RESOURCE")).toBeTruthy();
  });

  it("filters calendars by Global / Project / Resource", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));

    const filter = screen.getByTestId("calendar-filter") as HTMLSelectElement;

    fireEvent.change(filter, { target: { value: "global" } });
    expect(screen.queryByTestId("calendar-row-CAL_GLOBAL")).toBeTruthy();
    expect(screen.queryByTestId("calendar-row-CAL_PROJECT")).toBeNull();

    fireEvent.change(filter, { target: { value: "project" } });
    expect(screen.queryByTestId("calendar-row-CAL_PROJECT")).toBeTruthy();
    expect(screen.queryByTestId("calendar-row-CAL_RESOURCE")).toBeNull();

    fireEvent.change(filter, { target: { value: "resource" } });
    expect(screen.queryByTestId("calendar-row-CAL_RESOURCE")).toBeTruthy();
    expect(screen.queryByTestId("calendar-row-CAL_GLOBAL")).toBeNull();
  });

  it("shows weekly Sun-Sat grid and inheritance resolved status", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    expect(screen.getByTestId("calendar-week-grid").textContent).toContain("Sun");
    expect(screen.getByTestId("calendar-week-grid").textContent).toContain("Sat");
    expect(screen.getByTestId("calendar-detail-inheritance").textContent).toBe("Yes");
  });

  it("shows Used By activities with source start/finish", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    const row = screen.getByTestId("used-by-activity-T1");
    expect(row.textContent).toContain("A100");
    expect(row.textContent).toContain("08-May-26");
    expect(row.textContent).toContain("04-Jun-26");
  });

  it("displays 'Preserved Source Activity Dates' heading in calendars details", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    const heading = screen.getByText("Preserved Source Activity Dates");
    expect(heading).toBeTruthy();
  });

  it("shows helper text explaining that dates in Used By section are source dates", () => {
    render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    const helperText = screen.getByText(/imported source dates from the file.*differ from Planner-calculated/i);
    expect(helperText).toBeTruthy();
  });

  it("activity date cells have tooltips indicating source dates", () => {
    const { container } = render(<ImportDetailsPanel viewModel={VIEW_MODEL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    const sourceStartCell = container.querySelector('td[title*="Imported source start"]');
    const sourceFinishCell = container.querySelector('td[title*="Imported source finish"]');
    expect(sourceStartCell).toBeTruthy();
    expect(sourceFinishCell).toBeTruthy();
  });

  it("inferred calendar periods display with '— inferred' not exact time intervals", () => {
    const inferredVm: ImportDetailsViewModel = {
      ...VIEW_MODEL,
      calendarDetailsById: {
        ...VIEW_MODEL.calendarDetailsById,
        CAL_PROJECT: {
          ...VIEW_MODEL.calendarDetailsById.CAL_PROJECT,
          workingPatternSummary: "Inferred 5 working days, 40h/week",
          weeklyHoursByDay: [
            { dayLabel: "Sun", hours: 0, periodsText: "non-working" },
            { dayLabel: "Mon", hours: 8, periodsText: "8h — inferred" },
            { dayLabel: "Tue", hours: 8, periodsText: "8h — inferred" },
            { dayLabel: "Wed", hours: 8, periodsText: "8h — inferred" },
            { dayLabel: "Thu", hours: 8, periodsText: "8h — inferred" },
            { dayLabel: "Fri", hours: 8, periodsText: "8h — inferred" },
            { dayLabel: "Sat", hours: 0, periodsText: "non-working" },
          ],
          hasParseWarning: true,
          parseWarningMessage: "Detailed calendar periods were not fully parsed.",
        },
      },
    };

    const { container } = render(<ImportDetailsPanel viewModel={inferredVm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    // Check that the display shows "8h — inferred" not exact times
    expect(container.textContent).toContain("8h — inferred");
    expect(container.textContent).not.toContain("08:00–");
  });

  it("parse warning is displayed with 'Parsing note:' prefix when calendar periods not fully parsed", () => {
    const inferredVm: ImportDetailsViewModel = {
      ...VIEW_MODEL,
      calendarDetailsById: {
        ...VIEW_MODEL.calendarDetailsById,
        CAL_PROJECT: {
          ...VIEW_MODEL.calendarDetailsById.CAL_PROJECT,
          hasParseWarning: true,
          parseWarningMessage: "Detailed calendar periods were not fully parsed.",
        },
      },
    };

    render(<ImportDetailsPanel viewModel={inferredVm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));
    fireEvent.click(screen.getByTestId("calendar-row-CAL_PROJECT"));

    const warning = screen.getByTestId("calendar-parse-warning");
    expect(warning?.textContent).toContain("Parsing note:");
    expect(warning?.textContent).toContain("not fully parsed");
  });

  it("shows contextual helper text for source vs planner distinction", () => {
    const vmWithPlanner: ImportDetailsViewModel = {
      ...VIEW_MODEL,
      projectDetails: {
        ...VIEW_MODEL.projectDetails,
        importLifecycle: "plannerCalculatedWithVariance",
        plannerRollupFinish: "25-May-26",
      },
    };

    const { container } = render(<ImportDetailsPanel viewModel={vmWithPlanner} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-details-tab-calendars"));

    // Should mention both source and planner dates
    const content = container.textContent;
    expect(content).toContain("imported source dates");
    expect(content?.toLowerCase()).toContain("planner-calculated");
  });
});
