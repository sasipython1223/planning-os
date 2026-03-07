import type { Dependency, Task } from "protocol";
import type { ScheduleDependency, ScheduleRequest, ScheduleTask } from "protocol/kernel";

/**
 * Build a ScheduleRequest from worker state.
 * Maps worker Task/Dependency to kernel ScheduleTask/ScheduleDependency.
 * Preserves stable task order.
 */

export const buildScheduleRequest = (
  tasks: readonly Task[],
  dependencies: readonly Dependency[]
): ScheduleRequest => {
  const scheduleTasks: ScheduleTask[] = tasks.map(task => ({
    id: task.id,
    duration: task.duration,
    minEarlyStart: task.minEarlyStart ?? 0,
    parentId: task.parentId,
    isSummary: task.isSummary,
  }));

  // Map dependencies to kernel format (only FS dependencies for now)
  const scheduleDependencies: ScheduleDependency[] = dependencies
    .filter(dep => dep.type === "FS")
    .map(dep => ({
      predId: dep.predId,
      succId: dep.succId,
    }));

  return {
    tasks: scheduleTasks,
    dependencies: scheduleDependencies,
  };
};
