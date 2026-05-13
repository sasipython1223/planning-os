import type { FloatPathMvpResponse } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { deriveFloatPathProjection, type FloatPathLayoutMode, type FloatPathViewFilter, type FloatPathWbsContextDepth } from "./floatPathProjection";

type TestRow = {
  id: string;
  name: string;
  parentId?: string | null;
  isSummary?: boolean;
  depth?: number;
};

const rows: TestRow[] = [
  { id: "S1", name: "Summary 1", parentId: null, isSummary: true, depth: 0 },
  { id: "A1", name: "Activity 1", parentId: "S1", isSummary: false, depth: 1 },
  { id: "A2", name: "Activity 2", parentId: "S1", isSummary: false, depth: 1 },
  { id: "S2", name: "Summary 2", parentId: null, isSummary: true, depth: 0 },
  { id: "A3", name: "Activity 3", parentId: "S2", isSummary: false, depth: 1 },
  { id: "A4", name: "Activity 4", parentId: "S2", isSummary: false, depth: 1 },
];

const result: FloatPathMvpResponse = {
  analysisVersion: 1,
  scheduleVersion: 1,
  mode: "total_float",
  target: {
    taskId: "A4",
    taskName: "Activity 4",
    isMilestone: false,
  },
  summary: {
    primaryPathId: "path-1",
    returnedPathCount: 3,
    requestedPathCount: 5,
    nearCriticalPathCount: 1,
  },
  warnings: [],
  paths: [
    {
      pathId: "path-1",
      floatPathNumber: 1,
      floatPathOrder: 1,
      isPrimaryDrivingPath: true,
      isNearCritical: false,
      pathTotalFloatMinutes: 0,
      orderedActivities: [
        { sequence: 1, taskId: "A1", taskName: "Activity 1", isDriving: true, totalFloatMinutes: 0 },
        { sequence: 2, taskId: "A3", taskName: "Activity 3", isDriving: true, totalFloatMinutes: 0 },
      ],
      orderedRelationships: [],
    },
    {
      pathId: "path-2",
      floatPathNumber: 2,
      floatPathOrder: 2,
      isPrimaryDrivingPath: false,
      isNearCritical: true,
      pathTotalFloatMinutes: 480,
      orderedActivities: [
        { sequence: 1, taskId: "A2", taskName: "Activity 2", isDriving: true, totalFloatMinutes: 1 },
        { sequence: 2, taskId: "A3", taskName: "Activity 3", isDriving: true, totalFloatMinutes: 1 },
      ],
      orderedRelationships: [],
    },
    {
      pathId: "path-3",
      floatPathNumber: 3,
      floatPathOrder: 3,
      isPrimaryDrivingPath: false,
      isNearCritical: false,
      pathTotalFloatMinutes: 960,
      orderedActivities: [
        { sequence: 1, taskId: "A4", taskName: "Activity 4", isDriving: true, totalFloatMinutes: 2 },
      ],
      orderedRelationships: [],
    },
  ],
};

function project(filter: FloatPathViewFilter, layout: FloatPathLayoutMode = "originalWbs", stale = false, fpResult: FloatPathMvpResponse | null = result, wbsContextDepth?: FloatPathWbsContextDepth) {
  return deriveFloatPathProjection({
    rows,
    result: fpResult,
    filter,
    layout,
    stale,
    wbsContextDepth,
  });
}

// Deep 4-level hierarchy for WBS context depth tests.
const deepRows: TestRow[] = [
  { id: "L0", name: "Level 0 Summary", parentId: null, isSummary: true, depth: 0 },
  { id: "L1", name: "Level 1 Summary", parentId: "L0", isSummary: true, depth: 1 },
  { id: "L2", name: "Level 2 Summary", parentId: "L1", isSummary: true, depth: 2 },
  { id: "ACT", name: "Deep Activity", parentId: "L2", isSummary: false, depth: 3 },
];

const deepResult: FloatPathMvpResponse = {
  ...result,
  target: { taskId: "ACT", taskName: "Deep Activity", isMilestone: false },
  paths: [
    {
      pathId: "deep-path-1",
      floatPathNumber: 1,
      floatPathOrder: 1,
      isPrimaryDrivingPath: true,
      isNearCritical: false,
      pathTotalFloatMinutes: 0,
      orderedActivities: [
        { sequence: 1, taskId: "ACT", taskName: "Deep Activity", isDriving: true, totalFloatMinutes: 0 },
      ],
      orderedRelationships: [],
    },
  ],
};

function projectDeep(wbsContextDepth: FloatPathWbsContextDepth) {
  return deriveFloatPathProjection({
    rows: deepRows,
    result: deepResult,
    filter: { mode: "allReturned" },
    layout: "originalWbs",
    stale: false,
    wbsContextDepth,
  });
}

describe("deriveFloatPathProjection", () => {
  it("off mode returns original rows unchanged", () => {
    const out = project({ mode: "off" });
    expect(out.isActive).toBe(false);
    expect(out.projectedRows).toBe(rows);
    expect(out.warnings).toEqual([]);
  });

  it("path filter returns selected activities plus WBS ancestors in originalWbs mode", () => {
    const out = project({ mode: "path", pathId: "path-1" }, "originalWbs");
    expect(out.isActive).toBe(true);
    expect(out.projectedRows.map((r) => r.id)).toEqual(["S1", "A1", "S2", "A3"]);
  });

  it("topN combines activities from first N paths", () => {
    const out = project({ mode: "topN", count: 2 }, "originalWbs");
    expect([...out.visibleTaskIds].sort()).toEqual(["A1", "A2", "A3"].sort());
  });

  it("near-critical includes only near-critical path activities", () => {
    const out = project({ mode: "nearCritical" }, "originalWbs");
    expect([...out.visibleTaskIds].sort()).toEqual(["A2", "A3"].sort());
  });

  it("all returned includes all result activities", () => {
    const out = project({ mode: "allReturned" }, "originalWbs");
    expect([...out.visibleTaskIds].sort()).toEqual(["A1", "A2", "A3", "A4"].sort());
  });

  it("activity appearing in multiple paths is deduplicated in originalWbs layout", () => {
    const out = project({ mode: "topN", count: 2 }, "originalWbs");
    const activity3Rows = out.projectedRows.filter((r) => r.id === "A3");
    expect(activity3Rows).toHaveLength(1);
  });

  it("originalWbs preserves original row order", () => {
    const out = project({ mode: "allReturned" }, "originalWbs");
    expect(out.projectedRows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("stale result returns original rows and warning", () => {
    const out = project({ mode: "allReturned" }, "originalWbs", true);
    expect(out.isActive).toBe(false);
    expect(out.projectedRows).toBe(rows);
    expect(out.warnings).toContain("Float path result is stale or unavailable. Re-run analysis to apply filter.");
  });

  it("no result returns original rows and warning when filter is active", () => {
    const out = project({ mode: "topN", count: 5 }, "originalWbs", false, null);
    expect(out.isActive).toBe(false);
    expect(out.projectedRows).toBe(rows);
    expect(out.warnings).toContain("Float path result is stale or unavailable. Re-run analysis to apply filter.");
  });

  it("projection does not mutate input rows", () => {
    const inputRows = rows.map((r) => ({ ...r }));
    const before = JSON.stringify(inputRows);
    project({ mode: "allReturned" }, "floatPathOrder", false, result);
    const after = JSON.stringify(inputRows);
    expect(after).toBe(before);
  });

  // ── WBS context depth tests ─────────────────────────────────────────────

  it("wbsContextDepth full preserves current ancestor behavior", () => {
    const out = project({ mode: "path", pathId: "path-1" }, "originalWbs", false, result, "full");
    // path-1 has A1 and A3; ancestors S1 and S2 are depth 0 → included
    expect(out.projectedRows.map((r) => r.id)).toEqual(["S1", "A1", "S2", "A3"]);
  });

  it("wbsContextDepth none omits all WBS ancestors, shows only path activities", () => {
    const out = project({ mode: "path", pathId: "path-1" }, "originalWbs", false, result, "none");
    // no summary rows; only the activities on path-1
    expect(out.projectedRows.map((r) => r.id)).toEqual(["A1", "A3"]);
    expect(out.isActive).toBe(true);
  });

  it("wbsContextDepth none with allReturned shows all path activities, no summaries", () => {
    const out = project({ mode: "allReturned" }, "originalWbs", false, result, "none");
    expect(out.projectedRows.every((r) => !r.isSummary)).toBe(true);
    expect(out.projectedRows.map((r) => r.id).sort()).toEqual(["A1", "A2", "A3", "A4"].sort());
  });

  it("deep hierarchy: wbsContextDepth none returns only the activity", () => {
    const out = projectDeep("none");
    expect(out.projectedRows.map((r) => r.id)).toEqual(["ACT"]);
    expect(out.isActive).toBe(true);
  });

  it("deep hierarchy: wbsContextDepth 1 includes only depth-0 ancestors", () => {
    const out = projectDeep(1);
    // L0 is depth 0, L1 is depth 1 (excluded), L2 is depth 2 (excluded)
    expect(out.projectedRows.map((r) => r.id)).toEqual(["L0", "ACT"]);
  });

  it("deep hierarchy: wbsContextDepth 2 includes depth 0 and 1 ancestors", () => {
    const out = projectDeep(2);
    expect(out.projectedRows.map((r) => r.id)).toEqual(["L0", "L1", "ACT"]);
  });

  it("deep hierarchy: wbsContextDepth 3 includes depth 0, 1, and 2 ancestors", () => {
    const out = projectDeep(3);
    expect(out.projectedRows.map((r) => r.id)).toEqual(["L0", "L1", "L2", "ACT"]);
  });

  it("deep hierarchy: wbsContextDepth full includes all ancestors", () => {
    const out = projectDeep("full");
    expect(out.projectedRows.map((r) => r.id)).toEqual(["L0", "L1", "L2", "ACT"]);
  });

  it("wbsContextDepth is ignored in floatPathOrder layout (no ancestor rows added)", () => {
    const out = deriveFloatPathProjection({
      rows: deepRows,
      result: deepResult,
      filter: { mode: "allReturned" },
      layout: "floatPathOrder",
      stale: false,
      wbsContextDepth: "full",
    });
    // floatPathOrder never adds ancestors regardless of depth setting
    expect(out.projectedRows.map((r) => r.id)).toEqual(["ACT"]);
  });

  it("off mode unchanged regardless of wbsContextDepth", () => {
    const out = deriveFloatPathProjection({
      rows,
      result,
      filter: { mode: "off" },
      layout: "originalWbs",
      stale: false,
      wbsContextDepth: "none",
    });
    expect(out.isActive).toBe(false);
    expect(out.projectedRows).toBe(rows);
  });
});
