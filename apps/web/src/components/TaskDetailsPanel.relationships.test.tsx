/* @vitest-environment jsdom */

import type {
    Assignment,
    Dependency,
    DependencyDiagnosticsMap,
    Resource,
    ScheduleResultMap,
    Task,
    VisibleRow,
    WorkMinutes,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskDetailsPanel, type TaskDetailsPanelProps } from "./TaskDetailsPanel";

const D = MINUTES_PER_DAY as number;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
});

function wm(n: number): WorkMinutes {
  return n as WorkMinutes;
}

function mkTask(id: string, name: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name,
    durationWorkMinutes: wm(5 * D),
    siblingOrder: "V",
    ...overrides,
  };
}

function mkVisible(task: Task): VisibleRow {
  return {
    ...task,
    depth: 0,
    isSummary: false,
    isCollapsed: false,
    canExpand: false,
    wbsCode: "1",
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
    rollupWorkMinutes: null,
    rollupPercentComplete: null,
  };
}

function mkSchedule(esDays: number, efDays: number, isCritical = false): ScheduleResultMap[string] {
  return {
    earlyStartMinutes: wm(esDays * D),
    earlyFinishMinutes: wm(efDays * D),
    lateStartMinutes: wm(esDays * D),
    lateFinishMinutes: wm(efDays * D),
    totalFloatMinutes: wm(2 * D),
    isCritical,
  };
}

function baseProps(overrides: Partial<TaskDetailsPanelProps> = {}): TaskDetailsPanelProps {
  const tasks: Task[] = [
    mkTask("A", "Task A"),
    mkTask("B", "Task B"),
    mkTask("C", "Task C"),
    mkTask("D", "Task D"),
    mkTask("E", "Task E"),
    mkTask("S", "Summary S", { isStructuralSummary: true }),
  ];

  const dependencies: Dependency[] = [
    { id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) },
    { id: "d2", predId: "B", succId: "C", type: "FS", lagWorkMinutes: wm(0) },
    { id: "d3", predId: "D", succId: "E", type: "FS", lagWorkMinutes: wm(0) },
    { id: "d4", predId: "S", succId: "B", type: "FS", lagWorkMinutes: wm(0) },
  ];

  const scheduleResults: ScheduleResultMap = {
    A: mkSchedule(0, 5),
    B: mkSchedule(5, 10),
    C: mkSchedule(10, 15),
    D: mkSchedule(0, 4),
    E: mkSchedule(4, 8),
    // S intentionally omitted in some scenarios (summary/unavailable)
  };

  const dependencyDiagnosticsMap: DependencyDiagnosticsMap = {
    d1: { dependencyId: "d1", isDriving: true, linkSlackMinutes: 0, controllingDate: "ES" },
    d2: { dependencyId: "d2", isDriving: false, linkSlackMinutes: D, controllingDate: "ES" },
    d4: { dependencyId: "d4" },
  };

  const resources: Resource[] = [{ id: "r1", name: "Crew 1", maxUnitsPerDay: 1 }];
  const assignments: Assignment[] = [{ id: "a1", taskId: "B", resourceId: "r1", unitsPerDay: 1 }];

  return {
    dependencies,
    tasks,
    getTaskName: (id: string) => tasks.find((t) => t.id === id)?.name ?? id,
    onUpdateDependencyType: vi.fn(),
    onUpdateDependencyLag: vi.fn(),
    onDeleteDependency: vi.fn(),
    onAddDependency: vi.fn(),
    resources,
    assignments,
    resourceName: "",
    onResourceNameChange: vi.fn(),
    onAddResource: vi.fn(),
    onDeleteResource: vi.fn(),
    onAddAssignment: vi.fn(),
    onDeleteAssignment: vi.fn(),
    selectedTask: mkVisible(tasks[1]), // Task B
    onUpdateTask: vi.fn(),
    diagnosticsMap: {},
    dependencyDiagnosticsMap,
    scheduleResults,
    projectStartDate: "2026-01-01",
    onGoToTask: vi.fn(),
    canDeleteRelationships: true,
    relationshipDeleteDisabledReason: undefined,
    ...overrides,
  };
}

function openRelationshipsTab(): void {
  fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
}

describe("TaskDetailsPanel Relationships Driving column", () => {
  it("isDriving true renders Yes", () => {
    render(<TaskDetailsPanel {...baseProps()} />);
    openRelationshipsTab();
    expect(screen.getByTitle("Driving relationship — link slack is 0")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("isDriving false renders No", () => {
    render(<TaskDetailsPanel {...baseProps()} />);
    openRelationshipsTab();
    expect(screen.getByTitle("Non-driving — positive link slack")).toBeTruthy();
  });

  it("missing diagnostic renders unavailable dash", () => {
    const props = baseProps({ dependencyDiagnosticsMap: {} });
    render(<TaskDetailsPanel {...props} />);
    openRelationshipsTab();
    // B has predecessor d1 and successor d2 in scope, both missing diagnostics -> unavailable
    expect(screen.getAllByTitle("Driving status unavailable").length).toBeGreaterThanOrEqual(2);
  });

  it("Driving column is display-only and does not infer from schedule dates", () => {
    const props = baseProps({
      dependencyDiagnosticsMap: {
        d1: { dependencyId: "d1", isDriving: false, linkSlackMinutes: D, controllingDate: "ES" },
        d2: { dependencyId: "d2", isDriving: false, linkSlackMinutes: D, controllingDate: "ES" },
      },
    });
    // d1 schedule would imply driving under FS math (A.EF == B.ES), but UI must trust worker-provided false.
    render(<TaskDetailsPanel {...props} />);
    openRelationshipsTab();
    expect(screen.getAllByTitle("Non-driving — positive link slack").length).toBeGreaterThanOrEqual(2);
  });

  it("Delete relationship action still works", () => {
    const onDeleteDependency = vi.fn();
    render(<TaskDetailsPanel {...baseProps({ onDeleteDependency })} />);
    openRelationshipsTab();

    const removeButtons = screen.getAllByRole("button", { name: "✕" });
    fireEvent.click(removeButtons[0]);

    expect(onDeleteDependency).toHaveBeenCalledWith("d1");
  });

  it("Go To action still works", () => {
    const onGoToTask = vi.fn();
    render(<TaskDetailsPanel {...baseProps({ onGoToTask })} />);
    openRelationshipsTab();

    const goButtons = screen.getAllByRole("button", { name: "↗" });
    fireEvent.click(goButtons[0]);

    expect(onGoToTask).toHaveBeenCalledWith("A");
  });

  it("No unrelated relationships appear for selected activity", () => {
    render(<TaskDetailsPanel {...baseProps()} />);
    openRelationshipsTab();

    expect(screen.queryByText("Task D")).toBeNull();
    expect(screen.queryByText("Task E")).toBeNull();
    expect(screen.getByText("Task A")).toBeTruthy();
    expect(screen.getByText("Task C")).toBeTruthy();
  });

  it("Resources tab remains unaffected", () => {
    render(<TaskDetailsPanel {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Resources" }));
    expect(screen.getAllByText("Crew 1").length).toBeGreaterThan(0);
  });
});
