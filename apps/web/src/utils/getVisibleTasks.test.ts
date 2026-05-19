import type { Task } from "protocol";
import { describe, expect, it } from "vitest";
import { getVisibleTasks, orderTasksForHierarchyDisplay } from "./getVisibleTasks";

function task(id: string, parentId: string | undefined, depth: number, isSummary: boolean): Task {
  return {
    id,
    name: id,
    duration: isSummary ? 0 : 1,
    parentId,
    depth,
    isSummary,
  };
}

describe("W5B-UI.R5A — hierarchy display ordering", () => {
  it("projects imported WBS-first/activity-later rows into parent-before-child display order", () => {
    const tasks: Task[] = [
      task("root", undefined, 0, true),
      task("wbs-a", "root", 1, true),
      task("wbs-b", "root", 1, true),
      task("act-a1", "wbs-a", 2, false),
      task("act-b1", "wbs-b", 2, false),
    ];

    expect(orderTasksForHierarchyDisplay(tasks).map((t) => t.id)).toEqual([
      "root",
      "wbs-a",
      "act-a1",
      "wbs-b",
      "act-b1",
    ]);
  });

  it("applies collapse filtering after hierarchy display ordering", () => {
    const tasks: Task[] = [
      task("root", undefined, 0, true),
      task("wbs-a", "root", 1, true),
      task("wbs-b", "root", 1, true),
      task("act-a1", "wbs-a", 2, false),
      task("act-b1", "wbs-b", 2, false),
    ];

    expect(getVisibleTasks(tasks, new Set(["wbs-a"])).map((t) => t.id)).toEqual([
      "root",
      "wbs-a",
      "wbs-b",
      "act-b1",
    ]);
  });

  it("preserves original order for orphan roots and malformed leftovers", () => {
    const tasks: Task[] = [
      task("wbs-a", undefined, 0, true),
      task("orphan", "missing-parent", 1, false),
      task("act-a1", "wbs-a", 1, false),
    ];

    expect(orderTasksForHierarchyDisplay(tasks).map((t) => t.id)).toEqual([
      "wbs-a",
      "act-a1",
      "orphan",
    ]);
  });
});
