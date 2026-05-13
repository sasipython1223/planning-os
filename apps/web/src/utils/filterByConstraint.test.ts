import type { Task, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { filterByConstraint } from "./filterByConstraint";

const mkTask = (id: string, ct?: string, cd?: number | null): Task => ({
  id,
  name: id,
  durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
  siblingOrder: "V",
  ...(ct != null ? { constraintType: ct as Task["constraintType"] } : {}),
  ...(cd !== undefined ? { constraintDateMinutes: cd != null ? (cd * MINUTES_PER_DAY) as WorkMinutes : null } : {}),
});

const tasks: Task[] = [
  mkTask("A"),                          // no constraintType → unconstrained
  mkTask("B", "ASAP"),                  // explicit ASAP → unconstrained
  mkTask("C", "SNET", 10),             // SNET → constrained
  mkTask("D", "MFO", 20),              // MFO → constrained
  mkTask("E", "ALAP"),                 // ALAP → constrained
];

describe("Phase V.7 — filterByConstraint", () => {
  it('"all" returns all tasks', () => {
    expect(filterByConstraint(tasks, "all")).toHaveLength(5);
  });

  it('"constrained" returns tasks with non-ASAP constraintType', () => {
    const result = filterByConstraint(tasks, "constrained");
    expect(result.map((t) => t.id)).toEqual(["C", "D", "E"]);
  });

  it('"unconstrained" returns tasks with no constraint or ASAP', () => {
    const result = filterByConstraint(tasks, "unconstrained");
    expect(result.map((t) => t.id)).toEqual(["A", "B"]);
  });

  it("specific type SNET returns only SNET tasks", () => {
    const result = filterByConstraint(tasks, "SNET");
    expect(result.map((t) => t.id)).toEqual(["C"]);
  });

  it("specific type ALAP returns only ALAP tasks", () => {
    const result = filterByConstraint(tasks, "ALAP");
    expect(result.map((t) => t.id)).toEqual(["E"]);
  });

  it("specific type FNLT returns empty when none match", () => {
    expect(filterByConstraint(tasks, "FNLT")).toHaveLength(0);
  });

  it("empty task list returns empty for all filters", () => {
    expect(filterByConstraint([], "all")).toHaveLength(0);
    expect(filterByConstraint([], "constrained")).toHaveLength(0);
    expect(filterByConstraint([], "unconstrained")).toHaveLength(0);
    expect(filterByConstraint([], "SNET")).toHaveLength(0);
  });
});
