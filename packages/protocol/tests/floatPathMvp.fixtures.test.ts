import { describe, expect, it } from "vitest";
import type {
    FloatPathMvpRelationshipType,
    FloatPathMvpWarningCode,
    FloatPathMvpWarningSeverity,
} from "../src/kernel.js";
import { FLOAT_PATH_MVP_GOLDEN_FIXTURES } from "./fixtures/floatPathMvp.fixtures.js";

const REL_TYPES: readonly FloatPathMvpRelationshipType[] = ["FS", "SS", "FF", "SF"];
const WARNING_CODES: readonly FloatPathMvpWarningCode[] = [
  "TARGET_NOT_FOUND",
  "TARGET_UNSCHEDULED",
  "NO_PATHS_TO_TARGET",
  "MAX_PATHS_CLAMPED",
  "NEAR_CRITICAL_THRESHOLD_CLAMPED",
];
const WARNING_SEVERITIES: readonly FloatPathMvpWarningSeverity[] = ["info", "warning"];

function assertContiguousSequence(values: readonly number[], label: string): void {
  for (let i = 0; i < values.length; i++) {
    expect(values[i], `${label} at index ${i}`).toBe(i + 1);
  }
}

describe("FloatPath MVP golden fixture scaffolding", () => {
  it("contains at least one fixture", () => {
    expect(FLOAT_PATH_MVP_GOLDEN_FIXTURES.length).toBeGreaterThan(0);
  });

  it("fixtures conform to frozen MVP-v1 schema invariants", () => {
    for (const fixture of FLOAT_PATH_MVP_GOLDEN_FIXTURES) {
      const { request, expected } = fixture;

      expect(request.analysisVersion).toBe(1);
      expect(expected.analysisVersion).toBe(1);
      expect(request.mode).toBe("total_float");
      expect(expected.mode).toBe("total_float");
      expect(expected.scheduleVersion).toBe(request.scheduleVersion);
      expect(expected.target.taskId).toBe(request.targetTaskId);

      expect(expected.summary.requestedPathCount).toBe(request.maxPaths);
      expect(expected.summary.returnedPathCount).toBe(expected.paths.length);

      const nearCriticalCount = expected.paths.filter((path) => path.isNearCritical).length;
      expect(expected.summary.nearCriticalPathCount).toBe(nearCriticalCount);

      if (expected.paths.length === 0) {
        expect(expected.summary.primaryPathId).toBeNull();
      } else {
        const primary = expected.paths.filter((path) => path.isPrimaryDrivingPath);
        expect(primary.length).toBe(1);
        expect(expected.summary.primaryPathId).toBe(primary[0].pathId);
      }

      const orders = expected.paths.map((path) => path.floatPathOrder);
      const numbers = expected.paths.map((path) => path.floatPathNumber);
      assertContiguousSequence(orders, `${fixture.name}: floatPathOrder`);
      assertContiguousSequence(numbers, `${fixture.name}: floatPathNumber`);

      for (const path of expected.paths) {
        expect(path.pathTotalFloatMinutes).toBeGreaterThanOrEqual(0);

        const activitySeq = path.orderedActivities.map((activity) => activity.sequence);
        assertContiguousSequence(activitySeq, `${fixture.name}:${path.pathId}: activities`);

        const relSeq = path.orderedRelationships.map((relationship) => relationship.sequence);
        assertContiguousSequence(relSeq, `${fixture.name}:${path.pathId}: relationships`);

        expect(path.orderedRelationships.length).toBe(
          Math.max(path.orderedActivities.length - 1, 0),
        );

        for (const rel of path.orderedRelationships) {
          expect(REL_TYPES).toContain(rel.depType);
        }
      }

      for (const warning of expected.warnings) {
        expect(WARNING_CODES).toContain(warning.code);
        expect(WARNING_SEVERITIES).toContain(warning.severity);
      }
    }
  });
});
