// @vitest-environment jsdom

import type { Assignment, Dependency, Resource, ScheduleResultMap, Task, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskDetailsPanel, type TaskDetailsPanelProps } from "./TaskDetailsPanel";

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
});

const tasks: Task[] = [
  { id: "A1", name: "Task 1", durationWorkMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "A" },
  { id: "A2", name: "Task 2", durationWorkMinutes: (2 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "B" },
  { id: "A3", name: "Task 3", durationWorkMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "C" },
  { id: "A4", name: "Task 4", durationWorkMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "D" },
  { id: "A5", name: "Task 5", durationWorkMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "E" },
];

const dependencies: Dependency[] = [
  { id: "d1", predId: "A1", succId: "A2", type: "FS", lagWorkMinutes: 0 as WorkMinutes },
  { id: "d2", predId: "A2", succId: "A3", type: "SS", lagWorkMinutes: 0 as WorkMinutes },
  { id: "d3", predId: "A4", succId: "A5", type: "FF", lagWorkMinutes: 0 as WorkMinutes },
];

const resources: Resource[] = [
  { id: "R1", name: "Crew 1", maxUnitsPerDay: 1 },
  { id: "R2", name: "Crew 2", maxUnitsPerDay: 1 },
];

const assignments: Assignment[] = [
  { id: "as1", taskId: "A2", resourceId: "R1", unitsPerDay: 1 },
];

const scheduleResults: ScheduleResultMap = {
  A1: {
    earlyStartMinutes: (0 * MINUTES_PER_DAY) as WorkMinutes,
    earlyFinishMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes,
    lateStartMinutes: (0 * MINUTES_PER_DAY) as WorkMinutes,
    lateFinishMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes,
    totalFloatMinutes: (0 * MINUTES_PER_DAY) as WorkMinutes,
    isCritical: true,
  },
  A2: {
    earlyStartMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes,
    earlyFinishMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes,
    lateStartMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes,
    lateFinishMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes,
    totalFloatMinutes: (0 * MINUTES_PER_DAY) as WorkMinutes,
    isCritical: true,
  },
  A3: {
    earlyStartMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes,
    earlyFinishMinutes: (4 * MINUTES_PER_DAY) as WorkMinutes,
    lateStartMinutes: (4 * MINUTES_PER_DAY) as WorkMinutes,
    lateFinishMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
    totalFloatMinutes: (1 * MINUTES_PER_DAY) as WorkMinutes,
    isCritical: false,
  },
};

function buildSelectedTask(): VisibleRow {
  return {
    id: "A2",
    name: "Task 2",
    durationWorkMinutes: (2 * MINUTES_PER_DAY) as WorkMinutes,
    siblingOrder: "B",
    depth: 0,
    isSummary: false,
    isCollapsed: false,
    canExpand: false,
    wbsCode: "1.2",
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
  } as VisibleRow;
}

function buildProps(overrides: Partial<TaskDetailsPanelProps> = {}): TaskDetailsPanelProps {
  return {
    dependencies,
    tasks,
    getTaskName: (id: string) => tasks.find((t) => t.id === id)?.name ?? id,
    onUpdateDependencyType: () => {},
    onUpdateDependencyLag: () => {},
    onDeleteDependency: () => {},
    onAddDependency: () => {},
    resources,
    assignments,
    resourceName: "",
    onResourceNameChange: () => {},
    onAddResource: () => {},
    onDeleteResource: () => {},
    onAddAssignment: () => {},
    onDeleteAssignment: () => {},
    selectedTask: buildSelectedTask(),
    onUpdateTask: () => {},
    diagnosticsMap: {},
    scheduleResults,
    projectStartDate: "2026-01-01",
    onGoToTask: () => {},
    canDeleteRelationships: true,
    relationshipDeleteDisabledReason: "Disabled while Float Path filtered view is active.",
    ...overrides,
  };
}

describe("TaskDetailsPanel layout tabs", () => {
  it("shows empty guidance when no non-summary activity is selected", () => {
    render(<TaskDetailsPanel {...buildProps({ selectedTask: null })} />);
    expect(screen.getByText("Select an activity to view relationships and resources.")).toBeTruthy();
  });

  it("renders local tabs and defaults to General", () => {
    render(<TaskDetailsPanel {...buildProps()} />);

    expect(screen.getByRole("button", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relationships" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resources" })).toBeTruthy();
    expect(screen.getByText("Constraint")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("splits relationships into predecessors and successors for selected activity", () => {
    render(<TaskDetailsPanel {...buildProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    expect(screen.getByText("Predecessors")).toBeTruthy();
    expect(screen.getByText("Successors")).toBeTruthy();
    expect(screen.getAllByText("Activity ID").length).toBe(2);
    expect(screen.getAllByText("Activity Name").length).toBe(2);
    expect(screen.getAllByText("Relationship").length).toBe(2);
    expect(screen.getAllByText("Lag").length).toBe(2);
    expect(screen.getAllByText("Start").length).toBe(2);
    expect(screen.getAllByText("Finish").length).toBe(2);
    expect(screen.getAllByText("Total Float").length).toBe(2);
    expect(screen.getAllByText("Critical").length).toBe(2);
    expect(screen.getAllByText("Constraint").length).toBe(2);
    expect(screen.getAllByText("Driving").length).toBe(2);
    expect(screen.getAllByText("Actions").length).toBe(2);
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 3")).toBeTruthy();
    expect(screen.queryByText("Task 4")).toBeNull();
  });

  it("invokes go-to and remove callbacks from relationship row actions", () => {
    const onGoToTask = vi.fn();
    const onDeleteDependency = vi.fn();
    render(<TaskDetailsPanel {...buildProps({ onGoToTask, onDeleteDependency })} />);

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    fireEvent.click(screen.getAllByTitle("Go to activity")[0]);
    fireEvent.click(screen.getAllByTitle("Remove relationship")[0]);

    expect(onGoToTask).toHaveBeenCalledWith("A1");
    expect(onDeleteDependency).toHaveBeenCalledWith("d1");
  });

  it("invokes remove callback for successor rows too", () => {
    const onDeleteDependency = vi.fn();
    render(<TaskDetailsPanel {...buildProps({ onDeleteDependency })} />);

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    // Order is predecessor row first (d1), successor row second (d2)
    fireEvent.click(screen.getAllByTitle("Remove relationship")[1]);

    expect(onDeleteDependency).toHaveBeenCalledWith("d2");
  });

  it("refreshes relationship panes correctly across delete -> undo -> redo for predecessor delete", () => {
    const selectedTask = buildSelectedTask();
    const before = dependencies;
    const afterDelete = dependencies.filter((d) => d.id !== "d1");
    const afterUndo = before;
    const afterRedo = afterDelete;

    const { rerender } = render(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: before,
          selectedTask,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy(); // predecessor present
    expect(screen.getByText("Task 3")).toBeTruthy(); // successor present

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterDelete,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.queryByText("Task 1")).toBeNull(); // predecessor removed
    expect(screen.getByText("Task 3")).toBeTruthy(); // unrelated successor remains
    expect(screen.queryByText("Task 4")).toBeNull(); // unrelated dependency remains excluded

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterUndo,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy(); // restored on undo
    expect(screen.getByText("Task 3")).toBeTruthy();

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterRedo,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.queryByText("Task 1")).toBeNull(); // removed again on redo
    expect(screen.getByText("Task 3")).toBeTruthy();

    // Selection stability: panel still bound to same selected activity details.
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByText("Task 2")).toBeTruthy();
  });

  it("refreshes relationship panes correctly across delete -> undo -> redo for successor delete", () => {
    const selectedTask = buildSelectedTask();
    const before = dependencies;
    const afterDelete = dependencies.filter((d) => d.id !== "d2");
    const afterUndo = before;
    const afterRedo = afterDelete;

    const { rerender } = render(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: before,
          selectedTask,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 3")).toBeTruthy();

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterDelete,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy(); // predecessor remains
    expect(screen.queryByText("Task 3")).toBeNull(); // successor removed
    expect(screen.queryByText("Task 4")).toBeNull();

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterUndo,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 3")).toBeTruthy(); // restored on undo

    rerender(
      <TaskDetailsPanel
        {...buildProps({
          dependencies: afterRedo,
          selectedTask,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.queryByText("Task 3")).toBeNull(); // removed again on redo
  });

  it("keeps remove action enabled for Float Path filtered view when delete is allowed", () => {
    const onDeleteDependency = vi.fn();
    render(
      <TaskDetailsPanel
        {...buildProps({
          onDeleteDependency,
          canDeleteRelationships: true,
          relationshipDeleteDisabledReason: "Disabled while Float Path filtered view is active.",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    const removeButtons = screen.getAllByTitle("Remove relationship");
    expect(removeButtons.length).toBeGreaterThan(0);
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(removeButtons[0]);
    expect(onDeleteDependency).toHaveBeenCalledWith("d1");
  });

  it("disables remove action when relationship delete is blocked", () => {
    render(
      <TaskDetailsPanel
        {...buildProps({
          canDeleteRelationships: false,
          relationshipDeleteDisabledReason: "Disabled while Float Path filtered view is active.",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));

    const removeButtons = screen.getAllByTitle("Disabled while Float Path filtered view is active.");
    expect(removeButtons.length).toBeGreaterThan(0);
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches to Resources tab and hides relationship panes", () => {
    render(<TaskDetailsPanel {...buildProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Resources" }));

    expect(screen.getAllByText("Crew 1").length).toBeGreaterThan(0);
    expect(screen.queryByText("Predecessors")).toBeNull();
    expect(screen.queryByText("Successors")).toBeNull();
  });
});
