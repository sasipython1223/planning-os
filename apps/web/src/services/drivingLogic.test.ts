import type { Dependency, DependencyDiagnosticsMap, WorkMinutes } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { deriveImmediateDrivingLogic } from "./drivingLogic";

// ── Fixtures ──────────────────────────────────────────────────────────────

const wm = (n: number) => n as WorkMinutes;

function dep(id: string, predId: string, succId: string): Dependency {
  return { id, predId, succId, type: "FS", lagWorkMinutes: wm(0) };
}

function diag(isDriving: boolean | undefined): DependencyDiagnosticsMap[string] {
  return { dependencyId: "x", isDriving };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("deriveImmediateDrivingLogic", () => {
  it("returns driving predecessor when isDriving===true", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: { d1: diag(true) },
    });
    expect(result.drivingPredecessorIds).toEqual(["A"]);
    expect(result.drivenSuccessorIds).toEqual([]);
  });

  it("excludes non-driving predecessor (isDriving===false)", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: { d1: diag(false) },
    });
    expect(result.drivingPredecessorIds).toEqual([]);
  });

  it("excludes predecessor when diagnostic is missing", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: {},
    });
    expect(result.drivingPredecessorIds).toEqual([]);
  });

  it("excludes predecessor when isDriving is undefined", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: { d1: { dependencyId: "d1", isDriving: undefined } },
    });
    expect(result.drivingPredecessorIds).toEqual([]);
  });

  it("returns multiple driving predecessors when both drive", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "C",
      dependencies: [dep("d1", "A", "C"), dep("d2", "B", "C")],
      dependencyDiagnosticsMap: { d1: diag(true), d2: diag(true) },
    });
    expect(result.drivingPredecessorIds).toEqual(["A", "B"]);
  });

  it("returns only the driving predecessor among mixed predecessors", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "C",
      dependencies: [dep("d1", "A", "C"), dep("d2", "B", "C")],
      dependencyDiagnosticsMap: { d1: diag(true), d2: diag(false) },
    });
    expect(result.drivingPredecessorIds).toEqual(["A"]);
  });

  it("returns driven successor when isDriving===true", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "A",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: { d1: diag(true) },
    });
    expect(result.drivenSuccessorIds).toEqual(["B"]);
    expect(result.drivingPredecessorIds).toEqual([]);
  });

  it("excludes non-driving successor", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "A",
      dependencies: [dep("d1", "A", "B")],
      dependencyDiagnosticsMap: { d1: diag(false) },
    });
    expect(result.drivenSuccessorIds).toEqual([]);
  });

  it("handles both predecessors and successors simultaneously", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B"), dep("d2", "B", "C")],
      dependencyDiagnosticsMap: { d1: diag(true), d2: diag(true) },
    });
    expect(result.drivingPredecessorIds).toEqual(["A"]);
    expect(result.drivenSuccessorIds).toEqual(["C"]);
  });

  it("returns involvedTaskIds = preds + source + succs", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B"), dep("d2", "B", "C")],
      dependencyDiagnosticsMap: { d1: diag(true), d2: diag(true) },
    });
    expect(result.involvedTaskIds).toEqual(["A", "B", "C"]);
    expect(result.sourceTaskId).toBe("B");
  });

  it("returns empty result when dependencyDiagnosticsMap is empty", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "A", "B"), dep("d2", "B", "C")],
      dependencyDiagnosticsMap: {},
    });
    expect(result.drivingPredecessorIds).toEqual([]);
    expect(result.drivenSuccessorIds).toEqual([]);
    expect(result.involvedTaskIds).toEqual(["B"]);
  });

  it("returns empty result when dependencies list is empty", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [],
      dependencyDiagnosticsMap: { d1: diag(true) },
    });
    expect(result.drivingPredecessorIds).toEqual([]);
    expect(result.drivenSuccessorIds).toEqual([]);
  });

  it("ignores unrelated dependencies", () => {
    const result = deriveImmediateDrivingLogic({
      sourceTaskId: "B",
      dependencies: [dep("d1", "X", "Y")],
      dependencyDiagnosticsMap: { d1: diag(true) },
    });
    expect(result.drivingPredecessorIds).toEqual([]);
    expect(result.drivenSuccessorIds).toEqual([]);
  });
});
