import type {
    FloatPathMvpRequest,
    FloatPathMvpResponse,
} from "../../src/kernel.js";

export type FloatPathMvpGoldenFixture = {
  readonly name: string;
  readonly inputScheduleSnapshotRef: string;
  readonly request: FloatPathMvpRequest;
  readonly expected: FloatPathMvpResponse;
};

export const FLOAT_PATH_MVP_GOLDEN_FIXTURES: readonly FloatPathMvpGoldenFixture[] = [
  {
    name: "A2_two_parallel_paths_ranked",
    inputScheduleSnapshotRef: "fixture-schedule-A2",
    request: {
      analysisVersion: 1,
      scheduleVersion: 42,
      targetTaskId: "M1",
      maxPaths: 5,
      nearCriticalThresholdMinutes: 960,
      mode: "total_float",
    },
    expected: {
      analysisVersion: 1,
      scheduleVersion: 42,
      mode: "total_float",
      target: {
        taskId: "M1",
        taskName: "Phase 1 TOP",
        isMilestone: true,
      },
      summary: {
        primaryPathId: "P1",
        returnedPathCount: 2,
        requestedPathCount: 5,
        nearCriticalPathCount: 1,
      },
      paths: [
        {
          pathId: "P1",
          floatPathNumber: 1,
          floatPathOrder: 1,
          isPrimaryDrivingPath: true,
          isNearCritical: true,
          pathTotalFloatMinutes: 0,
          orderedActivities: [
            {
              sequence: 1,
              taskId: "A",
              taskName: "Start",
              isDriving: true,
              totalFloatMinutes: 0,
            },
            {
              sequence: 2,
              taskId: "B",
              taskName: "Build",
              isDriving: true,
              totalFloatMinutes: 0,
            },
            {
              sequence: 3,
              taskId: "M1",
              taskName: "Phase 1 TOP",
              isDriving: true,
              totalFloatMinutes: 0,
            },
          ],
          orderedRelationships: [
            {
              sequence: 1,
              predTaskId: "A",
              succTaskId: "B",
              depType: "FS",
              lagMinutes: 0,
              isDriving: true,
            },
            {
              sequence: 2,
              predTaskId: "B",
              succTaskId: "M1",
              depType: "FS",
              lagMinutes: 0,
              isDriving: true,
            },
          ],
        },
        {
          pathId: "P2",
          floatPathNumber: 2,
          floatPathOrder: 2,
          isPrimaryDrivingPath: false,
          isNearCritical: false,
          pathTotalFloatMinutes: 1440,
          orderedActivities: [
            {
              sequence: 1,
              taskId: "C",
              taskName: "Parallel Leg",
              isDriving: true,
              totalFloatMinutes: 1440,
            },
            {
              sequence: 2,
              taskId: "D",
              taskName: "Merge",
              isDriving: true,
              totalFloatMinutes: 1440,
            },
            {
              sequence: 3,
              taskId: "M1",
              taskName: "Phase 1 TOP",
              isDriving: true,
              totalFloatMinutes: 0,
            },
          ],
          orderedRelationships: [
            {
              sequence: 1,
              predTaskId: "C",
              succTaskId: "D",
              depType: "FS",
              lagMinutes: 0,
              isDriving: true,
            },
            {
              sequence: 2,
              predTaskId: "D",
              succTaskId: "M1",
              depType: "FS",
              lagMinutes: 0,
              isDriving: true,
            },
          ],
        },
      ],
      warnings: [],
    },
  },
  {
    name: "C4_target_unscheduled_no_paths",
    inputScheduleSnapshotRef: "fixture-schedule-C4",
    request: {
      analysisVersion: 1,
      scheduleVersion: 43,
      targetTaskId: "M2",
      maxPaths: 3,
      nearCriticalThresholdMinutes: 480,
      mode: "total_float",
    },
    expected: {
      analysisVersion: 1,
      scheduleVersion: 43,
      mode: "total_float",
      target: {
        taskId: "M2",
        taskName: "Phase 2 TOP",
        isMilestone: true,
      },
      summary: {
        primaryPathId: null,
        returnedPathCount: 0,
        requestedPathCount: 3,
        nearCriticalPathCount: 0,
      },
      paths: [],
      warnings: [
        {
          code: "TARGET_UNSCHEDULED",
          message: "Target activity exists but is not schedulable in current solution.",
          severity: "warning",
        },
        {
          code: "NO_PATHS_TO_TARGET",
          message: "No converging float paths could be identified for target.",
          severity: "info",
        },
      ],
    },
  },
];
