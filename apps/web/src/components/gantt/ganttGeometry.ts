import type { ScheduleResultMap, Task } from "@planner/protocol";
import { DAY_WIDTH, getDensityConstants } from "./ganttConstants";
import type { TimescaleModel } from "./timescaleModel";

/**
 * Geometry information for a single task bar.
 */
export interface TaskGeometry {
  taskId: string;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerY: number;
  leftEdge: number;
  rightEdge: number;
}

/**
 * Computes render geometry for all tasks.
 * Pure function - no side effects.
 *
 * @param tasks - Ordered array of tasks
 * @param scheduleResults - Schedule results from Worker
 * @returns Map of task ID to geometry
 */
export function computeTaskGeometry(
  tasks: Task[],
  scheduleResults: ScheduleResultMap,
  timescaleModel?: TimescaleModel,
): Map<string, TaskGeometry> {
  const geometryMap = new Map<string, TaskGeometry>();
  const { rowHeight, barHeight, barVerticalPadding } = getDensityConstants();
  // Compatibility fallbacks for callers/tests that do not pass a model.
  const dateToX = timescaleModel?.dateToX ?? ((day: number) => day * DAY_WIDTH);
  const spanWidth = timescaleModel?.spanWidth ?? ((start: number, finish: number) => (finish - start) * DAY_WIDTH);

  tasks.forEach((task, index) => {
    const schedule = scheduleResults[task.id];
    if (!schedule) return;

    const span = timescaleModel?.spanToX
      ? timescaleModel.spanToX(schedule.earlyStartMinutes, schedule.earlyFinishMinutes)
      : {
          // Compatibility fallback: preserve pre-model x/width computation.
          x: dateToX(schedule.earlyStartMinutes),
          width: spanWidth(schedule.earlyStartMinutes, schedule.earlyFinishMinutes),
        };
    const x = span.x;
    const y = index * rowHeight + barVerticalPadding;
    const width = span.width;
    const height = barHeight;
    const centerY = y + height / 2;

    geometryMap.set(task.id, {
      taskId: task.id,
      rowIndex: index,
      x,
      y,
      width,
      height,
      centerY,
      leftEdge: x,
      rightEdge: x + width,
    });
  });

  return geometryMap;
}
