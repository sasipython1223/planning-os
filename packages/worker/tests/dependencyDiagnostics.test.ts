/**
 * TD-REL.6A — Tests for computeDependencyDiagnostics
 *
 * All relationship types, driving/non-driving, missing results, summary tasks,
 * tie scenarios, and lag handling.
 */

import type { Dependency, ScheduleResultMap, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import {
    buildSummaryTaskIds,
    computeDependencyDiagnostics,
} from "../src/dependencyDiagnostics";

const D = MINUTES_PER_DAY as number; // 480

/** Build a minimal schedule result entry. */
function sched(es: number, ef: number): ScheduleResultMap[string] {
  return {
    earlyStartMinutes: es as WorkMinutes,
    earlyFinishMinutes: ef as WorkMinutes,
    lateStartMinutes: es as WorkMinutes,
    lateFinishMinutes: ef as WorkMinutes,
    totalFloatMinutes: 0 as WorkMinutes,
    isCritical: true,
  };
}

/** Build a minimal Dependency. */
function dep(
  id: string,
  predId: string,
  succId: string,
  type: "FS" | "SS" | "FF" | "SF",
  lagDays = 0,
): Dependency {
  return {
    id,
    predId,
    succId,
    type,
    lagWorkMinutes: (lagDays * D) as WorkMinutes,
  };
}

const NO_SUMMARIES = new Set<string>();

// ── FS ───────────────────────────────────────────────────────────────────────

describe("FS relationship", () => {
  it("FS driving: pred.EF + 0 lag == succ.ES", () => {
    const deps = [dep("d1", "A", "B", "FS")];
    // A: ES=0, EF=5D; B: ES=5D, EF=10D  → 5D+0=5D == 5D → driving
    const results: ScheduleResultMap = { A: sched(0, 5 * D), B: sched(5 * D, 10 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d1"].linkSlackMinutes).toBe(0);
    expect(diag["d1"].controllingDate).toBe("ES");
  });

  it("FS non-driving: pred.EF + 0 lag < succ.ES (another predecessor controls)", () => {
    const deps = [dep("d1", "A", "B", "FS")];
    // A.EF=3D, B.ES=5D → linkSlack=2D → not driving
    const results: ScheduleResultMap = { A: sched(0, 3 * D), B: sched(5 * D, 10 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(false);
    expect(diag["d1"].linkSlackMinutes).toBe(2 * D);
    expect(diag["d1"].controllingDate).toBe("ES");
  });

  it("FS with positive lag, driving: pred.EF + 3d lag == succ.ES", () => {
    const deps = [dep("d1", "A", "B", "FS", 3)];
    // A.EF=2D, lag=3D → 5D; B.ES=5D → driving
    const results: ScheduleResultMap = { A: sched(0, 2 * D), B: sched(5 * D, 10 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d1"].linkSlackMinutes).toBe(0);
  });

  it("FS with positive lag, non-driving", () => {
    const deps = [dep("d1", "A", "B", "FS", 2)];
    // A.EF=2D, lag=2D → 4D; B.ES=5D → linkSlack=1D → not driving
    const results: ScheduleResultMap = { A: sched(0, 2 * D), B: sched(5 * D, 10 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(false);
    expect(diag["d1"].linkSlackMinutes).toBe(D);
  });
});

// ── SS ───────────────────────────────────────────────────────────────────────

describe("SS relationship", () => {
  it("SS driving: pred.ES + 0 lag == succ.ES", () => {
    const deps = [dep("d1", "A", "B", "SS")];
    // A.ES=3D; B.ES=3D → 3D+0=3D == 3D → driving
    const results: ScheduleResultMap = { A: sched(3 * D, 8 * D), B: sched(3 * D, 7 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d1"].controllingDate).toBe("ES");
  });

  it("SS non-driving: pred.ES + lag < succ.ES", () => {
    const deps = [dep("d1", "A", "B", "SS")];
    // A.ES=2D; B.ES=5D → linkSlack=3D → not driving
    const results: ScheduleResultMap = { A: sched(2 * D, 7 * D), B: sched(5 * D, 10 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(false);
    expect(diag["d1"].linkSlackMinutes).toBe(3 * D);
  });
});

// ── FF ───────────────────────────────────────────────────────────────────────

describe("FF relationship", () => {
  it("FF driving: pred.EF + 0 lag == succ.EF", () => {
    const deps = [dep("d1", "A", "B", "FF")];
    // A.EF=8D; B.EF=8D → driving
    const results: ScheduleResultMap = { A: sched(3 * D, 8 * D), B: sched(5 * D, 8 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d1"].controllingDate).toBe("EF");
  });

  it("FF non-driving: pred.EF + lag < succ.EF", () => {
    const deps = [dep("d1", "A", "B", "FF")];
    // A.EF=6D; B.EF=8D → linkSlack=2D
    const results: ScheduleResultMap = { A: sched(1 * D, 6 * D), B: sched(4 * D, 8 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(false);
    expect(diag["d1"].linkSlackMinutes).toBe(2 * D);
  });
});

// ── SF ───────────────────────────────────────────────────────────────────────

describe("SF relationship", () => {
  it("SF driving: pred.ES + 0 lag == succ.EF", () => {
    const deps = [dep("d1", "A", "B", "SF")];
    // A.ES=8D; B.EF=8D → driving
    const results: ScheduleResultMap = { A: sched(8 * D, 12 * D), B: sched(3 * D, 8 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d1"].controllingDate).toBe("EF");
  });

  it("SF non-driving", () => {
    const deps = [dep("d1", "A", "B", "SF")];
    // A.ES=6D; B.EF=8D → linkSlack=2D
    const results: ScheduleResultMap = { A: sched(6 * D, 11 * D), B: sched(3 * D, 8 * D) };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(false);
    expect(diag["d1"].linkSlackMinutes).toBe(2 * D);
  });
});

// ── Multiple predecessors / tie ───────────────────────────────────────────────

describe("Multiple predecessors tie", () => {
  it("both predecessors Driving when both arrive at same date with zero slack", () => {
    // P1 → C FS+0, P2 → C FS+0, both P1.EF == C.ES and P2.EF == C.ES
    const deps = [
      dep("d1", "P1", "C", "FS"),
      dep("d2", "P2", "C", "FS"),
    ];
    const results: ScheduleResultMap = {
      P1: sched(0, 5 * D),
      P2: sched(1 * D, 5 * D),
      C: sched(5 * D, 10 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d2"].isDriving).toBe(true);
  });

  it("one driving, one non-driving among multiple predecessors", () => {
    const deps = [
      dep("d1", "P1", "C", "FS"),
      dep("d2", "P2", "C", "FS"),
    ];
    // P1.EF=5D == C.ES=5D → driving; P2.EF=3D < C.ES=5D → not driving
    const results: ScheduleResultMap = {
      P1: sched(0, 5 * D),
      P2: sched(0, 3 * D),
      C: sched(5 * D, 10 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
    expect(diag["d2"].isDriving).toBe(false);
  });

  it("non-critical activity can have a Driving predecessor", () => {
    // Both P and A have TF > 0 but P.EF == A.ES → Driving
    const deps = [dep("d1", "P", "A", "FS")];
    const results: ScheduleResultMap = {
      P: { earlyStartMinutes: 0 as WorkMinutes, earlyFinishMinutes: (5 * D) as WorkMinutes, lateStartMinutes: (5 * D) as WorkMinutes, lateFinishMinutes: (10 * D) as WorkMinutes, totalFloatMinutes: (5 * D) as WorkMinutes, isCritical: false },
      A: { earlyStartMinutes: (5 * D) as WorkMinutes, earlyFinishMinutes: (10 * D) as WorkMinutes, lateStartMinutes: (10 * D) as WorkMinutes, lateFinishMinutes: (15 * D) as WorkMinutes, totalFloatMinutes: (5 * D) as WorkMinutes, isCritical: false },
    };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBe(true);
  });
});

// ── Missing data ──────────────────────────────────────────────────────────────

describe("Missing schedule data → unavailable", () => {
  it("missing predecessor schedule result → isDriving undefined", () => {
    const deps = [dep("d1", "A", "B", "FS")];
    const results: ScheduleResultMap = { B: sched(5 * D, 10 * D) }; // A missing
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBeUndefined();
    expect(diag["d1"].linkSlackMinutes).toBeUndefined();
    expect(diag["d1"].controllingDate).toBeUndefined();
  });

  it("missing successor schedule result → isDriving undefined", () => {
    const deps = [dep("d1", "A", "B", "FS")];
    const results: ScheduleResultMap = { A: sched(0, 5 * D) }; // B missing
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBeUndefined();
  });

  it("empty schedule results → all isDriving undefined", () => {
    const deps = [dep("d1", "A", "B", "FS"), dep("d2", "B", "C", "FS")];
    const diag = computeDependencyDiagnostics(deps, {}, NO_SUMMARIES);
    expect(diag["d1"].isDriving).toBeUndefined();
    expect(diag["d2"].isDriving).toBeUndefined();
  });
});

// ── Summary/WBS tasks ─────────────────────────────────────────────────────────

describe("Summary/WBS task dependencies → unavailable", () => {
  it("predecessor is summary → isDriving undefined", () => {
    const deps = [dep("d1", "S", "A", "FS")];
    const results: ScheduleResultMap = {
      S: sched(0, 10 * D),
      A: sched(10 * D, 15 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, new Set(["S"]));
    expect(diag["d1"].isDriving).toBeUndefined();
  });

  it("successor is summary → isDriving undefined", () => {
    const deps = [dep("d1", "A", "S", "FS")];
    const results: ScheduleResultMap = {
      A: sched(0, 5 * D),
      S: sched(5 * D, 15 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, new Set(["S"]));
    expect(diag["d1"].isDriving).toBeUndefined();
  });

  it("non-summary dependency in same list still gets correct result", () => {
    const deps = [
      dep("d1", "S", "A", "FS"),
      dep("d2", "A", "B", "FS"),
    ];
    const results: ScheduleResultMap = {
      S: sched(0, 5 * D),
      A: sched(5 * D, 10 * D),
      B: sched(10 * D, 15 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, new Set(["S"]));
    expect(diag["d1"].isDriving).toBeUndefined();
    expect(diag["d2"].isDriving).toBe(true);
  });
});

// ── buildSummaryTaskIds ──────────────────────────────────────────────────────

describe("buildSummaryTaskIds", () => {
  it("marks isStructuralSummary tasks as summary", () => {
    const tasks = [
      { id: "s1", isStructuralSummary: true },
      { id: "a1" },
    ];
    const ids = buildSummaryTaskIds(tasks);
    expect(ids.has("s1")).toBe(true);
    expect(ids.has("a1")).toBe(false);
  });

  it("marks tasks that are parents (have children) as summary", () => {
    const tasks = [
      { id: "parent" },
      { id: "child", parentId: "parent" },
    ];
    const ids = buildSummaryTaskIds(tasks);
    expect(ids.has("parent")).toBe(true);
    expect(ids.has("child")).toBe(false);
  });

  it("marks both structural and computed summaries", () => {
    const tasks = [
      { id: "s1", isStructuralSummary: true },
      { id: "s2" },
      { id: "c1", parentId: "s2" },
      { id: "leaf" },
    ];
    const ids = buildSummaryTaskIds(tasks);
    expect(ids.has("s1")).toBe(true);
    expect(ids.has("s2")).toBe(true);
    expect(ids.has("c1")).toBe(false);
    expect(ids.has("leaf")).toBe(false);
  });

  it("returns empty set for flat task list with no summaries", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(buildSummaryTaskIds(tasks).size).toBe(0);
  });
});

// ── Output shape completeness ─────────────────────────────────────────────────

describe("Output shape", () => {
  it("every dependency gets an entry in the map", () => {
    const deps = [
      dep("d1", "A", "B", "FS"),
      dep("d2", "B", "C", "SS"),
      dep("d3", "missing", "C", "FS"),
    ];
    const results: ScheduleResultMap = {
      A: sched(0, 5 * D),
      B: sched(5 * D, 10 * D),
      C: sched(10 * D, 15 * D),
    };
    const diag = computeDependencyDiagnostics(deps, results, NO_SUMMARIES);
    expect(Object.keys(diag)).toHaveLength(3);
    expect(diag["d1"].dependencyId).toBe("d1");
    expect(diag["d2"].dependencyId).toBe("d2");
    expect(diag["d3"].dependencyId).toBe("d3");
  });

  it("empty dependency list returns empty map", () => {
    const diag = computeDependencyDiagnostics([], {}, NO_SUMMARIES);
    expect(Object.keys(diag)).toHaveLength(0);
  });
});
