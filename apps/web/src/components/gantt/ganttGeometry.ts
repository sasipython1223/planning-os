import type { ScheduleResultMap, Task } from "protocol";
import { DAY_WIDTH, getDensityConstants } from "./ganttConstants";

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
  scheduleResults: ScheduleResultMap
): Map<string, TaskGeometry> {
  const geometryMap = new Map<string, TaskGeometry>();
  const { rowHeight, barHeight, barVerticalPadding } = getDensityConstants();

  tasks.forEach((task, index) => {
    const schedule = scheduleResults[task.id];
    if (!schedule) return;

    const x = schedule.earlyStart * DAY_WIDTH;
    const y = index * rowHeight + barVerticalPadding;
    const width = (schedule.earlyFinish - schedule.earlyStart) * DAY_WIDTH;
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
