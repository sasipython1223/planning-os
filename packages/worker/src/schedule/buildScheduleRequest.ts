import type { Dependency, Task } from "protocol";
import type { ScheduleDependency, ScheduleRequest, ScheduleTask } from "protocol/kernel";

/**
 * Build a ScheduleRequest from worker state.
 * Maps worker Task/Dependency to kernel ScheduleTask/ScheduleDependency.
 * Preserves stable task order.
 */

export const buildScheduleRequest = (
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  nonWorkingDays: readonly number[],
): ScheduleRequest => {
  const scheduleTasks: ScheduleTask[] = tasks.map(task => ({
    id: task.id,
    duration: task.duration,
    minEarlyStart: task.minEarlyStart ?? 0,
    parentId: task.parentId,
    isSummary: task.isSummary,
    ...(task.constraintType !== undefined ? { constraintType: task.constraintType } : {}),
    ...(task.constraintDate !== undefined ? { constraintDate: task.constraintDate } : {}),
  }));

  // Map all dependencies to kernel format with type and lag
  const scheduleDependencies: ScheduleDependency[] = dependencies.map(dep => ({
    predId: dep.predId,
    succId: dep.succId,
    depType: dep.type,
    lag: dep.lag,
  }));

  return {
    tasks: scheduleTasks,
    dependencies: scheduleDependencies,
    nonWorkingDays,
  };
};
