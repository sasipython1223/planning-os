import type { Assignment, Dependency, VisibleRow, WorkMinutes } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { getSelectedActivityId, getSelectedTaskAssignments, getSelectedTaskDependencies } from "./taskDetailsScope";

describe("taskDetailsScope", () => {
  const dependencies: Dependency[] = [
    { id: "d1", predId: "A1", succId: "A2", type: "FS", lagWorkMinutes: 0 as WorkMinutes },
    { id: "d2", predId: "A2", succId: "A3", type: "SS", lagWorkMinutes: 0 as WorkMinutes },
    { id: "d3", predId: "A4", succId: "A5", type: "FF", lagWorkMinutes: 0 as WorkMinutes },
  ];

  const assignments: Assignment[] = [
    { id: "as1", taskId: "A2", resourceId: "R1", unitsPerDay: 1 },
    { id: "as2", taskId: "A2", resourceId: "R2", unitsPerDay: 0.5 },
    { id: "as3", taskId: "A3", resourceId: "R1", unitsPerDay: 1 },
  ];

  it("returns null when no selected task", () => {
    expect(getSelectedActivityId(null)).toBeNull();
  });

  it("returns null for summary selection", () => {
    const summary = { id: "WBS-1", isSummary: true } as VisibleRow;
    expect(getSelectedActivityId(summary)).toBeNull();
  });

  it("returns selected id for non-summary activity", () => {
    const activity = { id: "A2", isSummary: false } as VisibleRow;
    expect(getSelectedActivityId(activity)).toBe("A2");
  });

  it("returns predecessor and successor rows for selected activity only", () => {
    const scoped = getSelectedTaskDependencies(dependencies, "A2");
    expect(scoped.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("returns empty dependencies when selected activity is null", () => {
    expect(getSelectedTaskDependencies(dependencies, null)).toEqual([]);
  });

  it("returns only assignments for selected activity", () => {
    const scoped = getSelectedTaskAssignments(assignments, "A2");
    expect(scoped.map((a) => a.id)).toEqual(["as1", "as2"]);
  });

  it("returns empty assignments when selected activity is null", () => {
    expect(getSelectedTaskAssignments(assignments, null)).toEqual([]);
  });
});
