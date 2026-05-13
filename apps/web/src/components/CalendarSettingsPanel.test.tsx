// @vitest-environment jsdom

import type { BaseCalendarDefinition, CalendarId, PlannerCalendar, SourceImportRecord, Task } from "@planner/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarSettingsPanel } from "./CalendarSettingsPanel";

const importedCalendarId = "imp-cal" as CalendarId;
const plannerCalendarId = "planner-cal" as CalendarId;

const importedDef: BaseCalendarDefinition = {
  id: importedCalendarId,
  name: "Imported Standard",
  sourceCalendarType: "project",
  sourceHoursPerDay: 8,
  sourceHoursPerWeek: 40,
  sourceHoursPerMonth: 160,
  sourceHoursPerYear: 2080,
  weeklyPattern: {
    0: [],
    1: [{ startMinute: 480, endMinute: 960 }],
    2: [{ startMinute: 480, endMinute: 960 }],
    3: [{ startMinute: 480, endMinute: 960 }],
    4: [{ startMinute: 480, endMinute: 960 }],
    5: [{ startMinute: 480, endMinute: 960 }],
    6: [],
  },
  exceptions: [],
};

const sourceImportRecord: SourceImportRecord = {
  format: "xer",
  summary: {
    taskCount: 0,
    dependencyCount: 0,
    resourceCount: 0,
    assignmentCount: 0,
    calendarInfo: "1 calendar",
  },
  diagnostics: [],
  status: "sourceImportedNotCalculated",
  importedAt: "2026-05-09T00:00:00.000Z",
  sourceFileName: "demo.xer",
  resolvedCalendarDefinitions: {
    [importedCalendarId]: importedDef,
  },
};

const plannerCalendar: PlannerCalendar = {
  calendarId: plannerCalendarId,
  name: "Planner Team Calendar",
  type: "Project",
  source: "planner-editable",
  isDefaultProjectCalendar: true,
  hoursPerDay: 8,
  hoursPerWeek: 40,
  hoursPerMonth: 160,
  hoursPerYear: 2080,
  weeklyHours: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
  weeklyWorkPeriods: importedDef.weeklyPattern,
  exceptions: [],
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const baseTasks: readonly Task[] = [];

function renderPanel(overrides?: {
  plannerCalendars?: Record<string, PlannerCalendar>;
  sourceImportRecord?: SourceImportRecord | null;
  projectDefaultCalendarId?: CalendarId;
}) {
  return render(
    <CalendarSettingsPanel
      plannerCalendars={overrides?.plannerCalendars ?? { [plannerCalendarId]: plannerCalendar }}
      sourceImportRecord={overrides?.sourceImportRecord !== undefined ? overrides.sourceImportRecord : sourceImportRecord}
      tasks={baseTasks}
      selectedTaskIds={[]}
      projectDefaultCalendarId={overrides?.projectDefaultCalendarId ?? plannerCalendarId}
      onClose={vi.fn()}
      onSavePlannerCalendar={vi.fn()}
      onCloneImportedCalendar={vi.fn()}
      onSetProjectDefault={vi.fn()}
      onAssignCalendarToActivities={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("CalendarSettingsPanel", () => {
  it("shows imported calendars as read-only with clone-first affordance", () => {
    renderPanel();

    fireEvent.click(screen.getByTestId(`calendar-settings-row-${importedCalendarId}`));

    expect(screen.getByTestId("calendar-read-only-badge")).toBeTruthy();
    expect(screen.getByTestId("clone-imported-calendar")).toBeTruthy();
    expect(screen.queryByTestId("save-planner-calendar")).toBeNull();
    expect(screen.getByTestId("assignment-inactive-notice").textContent).toContain("until W5B-B is implemented");
  });

  it("shows planner default calendar status as visible in list", () => {
    renderPanel();

    expect(screen.getByTestId(`calendar-settings-row-${plannerCalendarId}`).textContent).toContain("Default");
  });

  it("shows save action for editable planner calendar", () => {
    renderPanel();

    fireEvent.click(screen.getByTestId(`calendar-settings-row-${plannerCalendarId}`));
    expect(screen.getByTestId("save-planner-calendar")).toBeTruthy();
  });

  it("shows clear empty state when no calendars are available", () => {
    renderPanel({ plannerCalendars: {}, sourceImportRecord: null });

    expect(screen.getByTestId("calendar-settings-empty-state").textContent).toContain("No calendars available");
    expect(screen.queryByTestId("clone-imported-calendar")).toBeNull();
    expect(screen.queryByTestId("save-planner-calendar")).toBeNull();
  });
});
