// @vitest-environment jsdom
// TD-TRACE.2B — DrivingLogicPanel unit tests

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImmediateDrivingLogicResult } from "../services/drivingLogic";
import { DrivingLogicPanel, type DrivingLogicTaskDisplay } from "./DrivingLogicPanel";

afterEach(() => {
  cleanup();
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const taskLookup: Record<string, DrivingLogicTaskDisplay> = {
  "task-A": { taskId: "task-A", activityId: "A100", name: "Excavation" },
  "task-B": { taskId: "task-B", activityId: "B200", name: "Foundation" },
  "task-C": { taskId: "task-C", activityId: "C300", name: "Framing" },
};

function makeResult(overrides?: Partial<ImmediateDrivingLogicResult>): ImmediateDrivingLogicResult {
  return {
    sourceTaskId: "task-B",
    drivingPredecessorIds: ["task-A"],
    drivenSuccessorIds: ["task-C"],
    involvedTaskIds: ["task-A", "task-B", "task-C"],
    ...overrides,
  };
}

function renderPanel(
  result: ImmediateDrivingLogicResult = makeResult(),
  onClear = vi.fn(),
) {
  render(
    <DrivingLogicPanel
      result={result}
      taskLookup={taskLookup}
      onClear={onClear}
    />,
  );
  return { onClear };
}

// ── 1. Panel sections render ───────────────────────────────────────────────
describe("DrivingLogicPanel sections", () => {
  it("renders Driving Predecessors section", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: /driving predecessors/i })).toBeDefined();
  });

  it("renders Selected Activity section", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: /selected activity/i })).toBeDefined();
  });

  it("renders Driven Successors section", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: /driven successors/i })).toBeDefined();
  });

  it("renders the data-testid container", () => {
    renderPanel();
    expect(screen.getByTestId("driving-logic-panel")).toBeDefined();
  });
});

// ── 2. Activity display ────────────────────────────────────────────────────
describe("activity display", () => {
  it("shows predecessor activity ID and name", () => {
    renderPanel();
    expect(screen.getByText(/A100 — Excavation/)).toBeDefined();
  });

  it("shows source activity ID and name", () => {
    renderPanel();
    expect(screen.getByText(/B200 — Foundation/)).toBeDefined();
  });

  it("shows successor activity ID and name", () => {
    renderPanel();
    expect(screen.getByText(/C300 — Framing/)).toBeDefined();
  });

  it("falls back to taskId when lookup entry is missing", () => {
    renderPanel(makeResult({ sourceTaskId: "unknown-id", involvedTaskIds: ["unknown-id"] }));
    expect(screen.getByText("unknown-id")).toBeDefined();
  });
});

// ── 3. Empty states ────────────────────────────────────────────────────────
describe("empty states", () => {
  it("shows empty message when no driving predecessors", () => {
    renderPanel(makeResult({ drivingPredecessorIds: [], involvedTaskIds: ["task-B", "task-C"] }));
    expect(screen.getByText(/no immediate driving predecessors found/i)).toBeDefined();
  });

  it("shows empty message when no driven successors", () => {
    renderPanel(makeResult({ drivenSuccessorIds: [], involvedTaskIds: ["task-A", "task-B"] }));
    expect(screen.getByText(/no immediate driven successors found/i)).toBeDefined();
  });

  it("shows overall empty message when both sides empty", () => {
    renderPanel(makeResult({ drivingPredecessorIds: [], drivenSuccessorIds: [], involvedTaskIds: ["task-B"] }));
    expect(screen.getByText(/no immediate driving logic found/i)).toBeDefined();
  });

  it("does not show overall empty message when at least one side has results", () => {
    renderPanel();
    expect(screen.queryByText(/no immediate driving logic found/i)).toBeNull();
  });
});

// ── 4. Clear Trace button ──────────────────────────────────────────────────
describe("Clear Trace button", () => {
  it("renders Clear Trace button", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /clear driving logic trace/i })).toBeDefined();
  });

  it("calls onClear when Clear Trace is clicked", () => {
    const { onClear } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /clear driving logic trace/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
