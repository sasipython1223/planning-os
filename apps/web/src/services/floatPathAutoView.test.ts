import type { FloatPathMvpResponse } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { deriveDefaultFloatPathAutoViewFilter } from "./floatPathAutoView";

function makeResult(paths: FloatPathMvpResponse["paths"]): FloatPathMvpResponse {
  return {
    analysisVersion: 1,
    scheduleVersion: 1,
    mode: "total_float",
    target: { taskId: "t-target", taskName: "Target", isMilestone: true },
    summary: {
      primaryPathId: paths.find((path) => path.floatPathNumber === 1)?.pathId ?? null,
      requestedPathCount: 5,
      returnedPathCount: paths.length,
      nearCriticalPathCount: paths.filter((path) => path.isNearCritical).length,
    },
    paths,
    warnings: [],
  };
}

describe("deriveDefaultFloatPathAutoViewFilter", () => {
  it("returns Path 1 filter when Path 1 exists", () => {
    const result = makeResult([
      {
        pathId: "p2",
        floatPathNumber: 2,
        floatPathOrder: 2,
        isPrimaryDrivingPath: false,
        isNearCritical: true,
        pathTotalFloatMinutes: 120,
        orderedActivities: [],
        orderedRelationships: [],
      },
      {
        pathId: "p1",
        floatPathNumber: 1,
        floatPathOrder: 1,
        isPrimaryDrivingPath: true,
        isNearCritical: true,
        pathTotalFloatMinutes: 0,
        orderedActivities: [],
        orderedRelationships: [],
      },
    ]);

    expect(deriveDefaultFloatPathAutoViewFilter(result)).toEqual({ mode: "path", pathId: "p1" });
  });

  it("falls back to allReturned when paths exist but Path 1 is absent", () => {
    const result = makeResult([
      {
        pathId: "p7",
        floatPathNumber: 7,
        floatPathOrder: 1,
        isPrimaryDrivingPath: false,
        isNearCritical: false,
        pathTotalFloatMinutes: 240,
        orderedActivities: [],
        orderedRelationships: [],
      },
    ]);

    expect(deriveDefaultFloatPathAutoViewFilter(result)).toEqual({ mode: "allReturned" });
  });

  it("returns null when no paths are returned", () => {
    const result = makeResult([]);
    expect(deriveDefaultFloatPathAutoViewFilter(result)).toBeNull();
  });
});
