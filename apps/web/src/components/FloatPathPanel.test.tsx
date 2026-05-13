// @vitest-environment jsdom

import type { FloatPathMvpResponse, VisibleRow } from "@planner/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatPathPanel } from "./FloatPathPanel";

afterEach(() => {
  cleanup();
});

const selectedTask = {
  id: "T-M1",
  name: "Milestone A",
  wbsCode: "1.2",
  parentId: "P1",
  depth: 1,
  isSummary: false,
  durationWorkMinutes: 480,
  siblingOrder: "a",
  isCollapsed: false,
  canExpand: false,
  rollupStartMinutes: null,
  rollupFinishMinutes: null,
  rollupDurationMinutes: null,
  rollupCost: null,
  rollupWorkMinutes: null,
  rollupPercentComplete: null,
} as VisibleRow;

const resultFixture: FloatPathMvpResponse = {
  analysisVersion: 1,
  scheduleVersion: 1,
  mode: "total_float",
  target: {
    taskId: "f1155d47-5555-4f1f-a1b2-111111111111",
    taskName: "Milestone A",
    isMilestone: false,
  },
  summary: {
    primaryPathId: "path-1",
    returnedPathCount: 1,
    requestedPathCount: 5,
    nearCriticalPathCount: 1,
  },
  warnings: [
    {
      code: "SEARCH_CAPPED",
      severity: "warning",
      message: "Search was capped.",
    },
    {
      code: "MAX_PATHS_CLAMPED",
      severity: "warning",
      message: "result clamped to 100 paths; 5000 candidate paths found",
    },
  ],
  paths: [
    {
      pathId: "path-1",
      floatPathNumber: 1,
      floatPathOrder: 1,
      isPrimaryDrivingPath: true,
      isNearCritical: true,
      pathTotalFloatMinutes: 204,
      orderedActivities: [
        {
          sequence: 1,
          taskId: "f1155d47-5555-4f1f-a1b2-111111111111",
          taskName: "Activity One",
          isDriving: true,
          totalFloatMinutes: 0,
        },
        {
          sequence: 2,
          taskId: "A2-UUID-0000-0000-000000000002",
          taskName: "Activity Two",
          isDriving: true,
          totalFloatMinutes: 1.5,
        },
      ],
      orderedRelationships: [
        {
          sequence: 1,
          predTaskId: "f1155d47-5555-4f1f-a1b2-111111111111",
          succTaskId: "A2-UUID-0000-0000-000000000002",
          depType: "SS",
          lagMinutes: 5280,
          isDriving: true,
        },
      ],
    },
  ],
};

const targetOnlyFixture: FloatPathMvpResponse = {
  ...resultFixture,
  warnings: [],
  paths: [
    {
      pathId: "path-target-only",
      floatPathNumber: 1,
      floatPathOrder: 1,
      isPrimaryDrivingPath: true,
      isNearCritical: true,
      pathTotalFloatMinutes: 0,
      orderedActivities: [
        {
          sequence: 1,
          taskId: "f1155d47-5555-4f1f-a1b2-111111111111",
          taskName: "Milestone A",
          isDriving: true,
          totalFloatMinutes: 0,
        },
      ],
      orderedRelationships: [],
    },
  ],
};

const taskLookup = {
  "f1155d47-5555-4f1f-a1b2-111111111111": {
    taskId: "f1155d47-5555-4f1f-a1b2-111111111111",
    activityId: "GG0610",
    name: "CLSD - Phase 1",
    isMilestone: false,
    isSummary: false,
    totalFloat: 0,
  },
  "A2-UUID-0000-0000-000000000002": {
    taskId: "A2-UUID-0000-0000-000000000002",
    activityId: "A1020",
    name: "Material Delivery",
    isMilestone: false,
    isSummary: false,
    totalFloat: 1.5,
  },
};

function renderPanel(overrides?: Partial<ComponentProps<typeof FloatPathPanel>>) {
  const onRun = vi.fn();
  const onViewFilterChange = vi.fn();
  const onLayoutModeChange = vi.fn();
  const onWbsContextDepthChange = vi.fn();
  render(
    <FloatPathPanel
      workerReady={true}
      selectedTask={selectedTask}
      isRunning={false}
      isStale={false}
      result={null}
      error={null}
      onRun={onRun}
      taskLookup={taskLookup}
      viewFilter={{ mode: "off" }}
      layoutMode="originalWbs"
      onViewFilterChange={onViewFilterChange}
      onLayoutModeChange={onLayoutModeChange}
      wbsContextDepth="full"
      onWbsContextDepthChange={onWbsContextDepthChange}
      projectionActive={false}
      {...overrides}
    />,
  );
  return { onRun, onViewFilterChange, onLayoutModeChange, onWbsContextDepthChange };
}

describe("FloatPathPanel", () => {
  it("empty state says select a milestone/activity first", () => {
    renderPanel({ workerReady: true, selectedTask: null });
    expect(screen.getByText("Select a milestone/activity first.")).toBeTruthy();
  });

  it("Analyze button disabled when no selected task", () => {
    renderPanel({ workerReady: true, selectedTask: null });
    const button = screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("Analyze button enabled when selected task and worker ready", () => {
    renderPanel({ workerReady: true, selectedTask });
    const button = screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("loading state renders", () => {
    renderPanel({ isRunning: true });
    expect(screen.getByText("Running float path analysis...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Analyzing..." })).toBeTruthy();
  });

  it("error state renders", () => {
    renderPanel({
      error: { type: "ComputationFailed", message: "No solved schedule" },
    });
    expect(screen.getByText(/ComputationFailed/)).toBeTruthy();
    expect(screen.getByText(/No solved schedule/)).toBeTruthy();
  });

  it("stale note renders", () => {
    renderPanel({ isStale: true });
    expect(
      screen.getByText("Schedule changed after this analysis. Re-run analysis for the latest result."),
    ).toBeTruthy();
  });

  it("result summary renders", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/Returned 1 of 5 requested paths; 1 near-critical\./)).toBeTruthy();
  });

  it("renders activity names with planner-readable labels instead of UUID-only chains", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/GG0610 \| Activity One \| TF 0d/)).toBeTruthy();
    expect(screen.getByText(/A1020 \| Activity Two \| TF 1.5d/)).toBeTruthy();
    expect(screen.queryByText(/Activity One -> Activity Two/)).toBeNull();
  });

  it("prefers source/visible activity ID over raw UUID", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/GG0610 \| Activity One/)).toBeTruthy();
    expect(screen.getByText(/A1020 \| Activity Two/)).toBeTruthy();
  });

  it("path float displays in days, not minutes", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/Float 204d/)).toBeTruthy();
    expect(screen.queryByText(/Float 204m/)).toBeNull();
  });

  it("relationship lag displays as working days", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/GG0610 → A1020 \| SS \+11d/)).toBeTruthy();
  });

  it("threshold control shows working-day labels", () => {
    renderPanel();
    const select = screen.getByLabelText("Near-critical threshold") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(screen.getByText("0 days")).toBeTruthy();
    expect(screen.getByText("1 working day")).toBeTruthy();
    expect(screen.getByText("5 working days")).toBeTruthy();
    expect(screen.getByText("10 working days")).toBeTruthy();
    expect(screen.getByText("15 working days")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("threshold control still sends minutes internally", () => {
    const { onRun } = renderPanel({ workerReady: true, selectedTask });

    fireEvent.change(screen.getByLabelText("Max Paths"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Near-critical threshold"), { target: { value: "2400" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith({
      targetTaskId: "T-M1",
      maxPaths: 7,
      nearCriticalThresholdMinutes: 2400,
    });
  });

  it("target-only path explanation renders for one activity and zero relationships", () => {
    renderPanel({ result: targetOnlyFixture });
    expect(
      screen.getByText("No predecessor path was found to this target. Showing the selected target activity only."),
    ).toBeTruthy();
  });

  it("user-readable warning text renders for SEARCH_CAPPED", () => {
    renderPanel({ result: resultFixture });
    expect(
      screen.getByText("Search capped: The schedule has many possible paths. The system returned the best deterministic subset found."),
    ).toBeTruthy();
    expect(screen.getByText(/Code: SEARCH_CAPPED/)).toBeTruthy();
  });

  it("user-readable warning text renders for MAX_PATHS_CLAMPED", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText("Result clamped: 1 paths were returned from 5000 candidates.")).toBeTruthy();
    expect(screen.getByText(/Code: MAX_PATHS_CLAMPED/)).toBeTruthy();
  });

  it("renders target-only clarification text", () => {
    renderPanel({ result: resultFixture });
    expect(
      screen.getByText(
        /This analysis traces predecessor paths ending at the selected target only\. It is not the overall project critical path unless the selected target is the final completion milestone\./,
      ),
    ).toBeTruthy();
  });

  it("clicking Analyze sends selected id, max paths and threshold", () => {
    const { onRun } = renderPanel({ workerReady: true, selectedTask });

    fireEvent.change(screen.getByLabelText("Max Paths"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Near-critical threshold"), { target: { value: "2400" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith({
      targetTaskId: "T-M1",
      maxPaths: 7,
      nearCriticalThresholdMinutes: 2400,
    });
  });

  it("contains no AI explanation text and no Gantt highlight controls", () => {
    renderPanel({ result: resultFixture });
    expect(screen.queryByText(/AI explanation/i)).toBeNull();
    expect(screen.queryByText(/Explain/i)).toBeNull();
    expect(screen.queryByText(/Highlight/i)).toBeNull();
    expect(screen.queryByText(/Gantt/i)).toBeNull();
  });

  it("target display is planner-readable", () => {
    renderPanel({ result: resultFixture });
    expect(screen.getByText(/GG0610 - Milestone A/)).toBeTruthy();
    expect(screen.getAllByText("Activity").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Selected target is an activity. This analysis traces paths ending at this activity only."),
    ).toBeTruthy();
  });

  it("filter controls render", () => {
    renderPanel();
    expect(screen.getByLabelText("Float Path Filter")).toBeTruthy();
    expect(screen.getByLabelText("Arrange By")).toBeTruthy();
  });

  it("non-off filters are disabled when no result", () => {
    renderPanel({ result: null });
    const topFive = screen.getByRole("option", { name: "Top 5 paths" }) as HTMLOptionElement;
    const nearCritical = screen.getByRole("option", { name: "Near-critical paths" }) as HTMLOptionElement;
    const allReturned = screen.getByRole("option", { name: "All returned paths" }) as HTMLOptionElement;

    expect(topFive.disabled).toBe(true);
    expect(nearCritical.disabled).toBe(true);
    expect(allReturned.disabled).toBe(true);
    expect(screen.getByText("Run analysis before applying a float path filter.")).toBeTruthy();
  });

  it("path filter options are generated from result paths", () => {
    const multiPathResult: FloatPathMvpResponse = {
      ...resultFixture,
      summary: {
        ...resultFixture.summary,
        returnedPathCount: 3,
      },
      paths: [
        resultFixture.paths[0],
        {
          ...resultFixture.paths[0],
          pathId: "path-2",
          floatPathNumber: 2,
          floatPathOrder: 2,
          isPrimaryDrivingPath: false,
        },
        {
          ...resultFixture.paths[0],
          pathId: "path-3",
          floatPathNumber: 3,
          floatPathOrder: 3,
          isPrimaryDrivingPath: false,
        },
      ],
    };

    renderPanel({ result: multiPathResult });
    expect(screen.getByRole("option", { name: "Float Path 1 - Primary" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Float Path 2" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Float Path 3" })).toBeTruthy();
  });

  it("active filtered-view banner renders", () => {
    renderPanel({ projectionActive: true });
    expect(
      screen.getByText("Float Path filtered view is active. This is a temporary view and does not change the programme."),
    ).toBeTruthy();
  });

  it("layout options render only implemented modes", () => {
    renderPanel();
    expect(screen.getByRole("option", { name: "Original WBS" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Float Path Order" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Float Path → WBS/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /WBS → Float Path/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Near-critical first/i })).toBeNull();
  });

  it("shows note when near-critical filter matches all returned paths", () => {
    const allNearCriticalResult: FloatPathMvpResponse = {
      ...resultFixture,
      paths: resultFixture.paths.map((p) => ({ ...p, isNearCritical: true })),
    };
    renderPanel({
      result: allNearCriticalResult,
      isStale: false,
      viewFilter: { mode: "nearCritical" },
    });
    expect(
      screen.getByText("Near-critical filter matches all returned paths for this analysis."),
    ).toBeTruthy();
  });

  it("does not show the note when not all paths are near-critical", () => {
    const mixedResult: FloatPathMvpResponse = {
      ...resultFixture,
      paths: [
        { ...resultFixture.paths[0], isNearCritical: true },
        {
          ...resultFixture.paths[0],
          pathId: "path-2",
          floatPathNumber: 2,
          floatPathOrder: 2,
          isNearCritical: false,
        },
      ],
    };
    renderPanel({
      result: mixedResult,
      isStale: false,
      viewFilter: { mode: "nearCritical" },
    });
    expect(
      screen.queryByText("Near-critical filter matches all returned paths for this analysis."),
    ).toBeNull();
  });

  it("does not show the note when a different filter is active", () => {
    const allNearCriticalResult: FloatPathMvpResponse = {
      ...resultFixture,
      paths: resultFixture.paths.map((p) => ({ ...p, isNearCritical: true })),
    };
    renderPanel({
      result: allNearCriticalResult,
      isStale: false,
      viewFilter: { mode: "allReturned" },
    });
    expect(
      screen.queryByText("Near-critical filter matches all returned paths for this analysis."),
    ).toBeNull();
  });

  // ── WBS Context Depth selector ──────────────────────────────────────────

  it("WBS Context Depth selector renders when layoutMode is originalWbs", () => {
    renderPanel({ layoutMode: "originalWbs" });
    expect(screen.getByLabelText("WBS Context Depth")).toBeTruthy();
  });

  it("WBS Context Depth selector is hidden when layoutMode is floatPathOrder", () => {
    renderPanel({ layoutMode: "floatPathOrder" });
    expect(screen.queryByLabelText("WBS Context Depth")).toBeNull();
  });

  it("WBS Context Depth selector shows all options", () => {
    renderPanel({ layoutMode: "originalWbs" });
    expect(screen.getByRole("option", { name: "Activities only" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "1 level" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "2 levels" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "3 levels" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Full WBS" })).toBeTruthy();
  });

  it("WBS Context Depth selector defaults to Full WBS", () => {
    renderPanel({ layoutMode: "originalWbs", wbsContextDepth: "full" });
    const select = screen.getByLabelText("WBS Context Depth") as HTMLSelectElement;
    expect(select.value).toBe("full");
  });

  it("WBS Context Depth selector reflects passed depth value", () => {
    renderPanel({ layoutMode: "originalWbs", wbsContextDepth: 2 });
    const select = screen.getByLabelText("WBS Context Depth") as HTMLSelectElement;
    expect(select.value).toBe("2");
  });

  it("changing WBS Context Depth calls onWbsContextDepthChange with correct value", () => {
    const { onWbsContextDepthChange } = renderPanel({ layoutMode: "originalWbs", wbsContextDepth: "full" });
    fireEvent.change(screen.getByLabelText("WBS Context Depth"), { target: { value: "none" } });
    expect(onWbsContextDepthChange).toHaveBeenCalledWith("none");
  });

  it("changing WBS Context Depth to a numeric level calls onWbsContextDepthChange with number", () => {
    const { onWbsContextDepthChange } = renderPanel({ layoutMode: "originalWbs", wbsContextDepth: "full" });
    fireEvent.change(screen.getByLabelText("WBS Context Depth"), { target: { value: "1" } });
    expect(onWbsContextDepthChange).toHaveBeenCalledWith(1);
  });
});
