import type { Dependency, Task, WorkMinutes } from "@planner/protocol";
import type { ScheduleDependency, ScheduleRequest, ScheduleTask } from "@planner/protocol/kernel";
import { ENGINE_ABI_VERSION } from "@planner/protocol/kernel";
import type { IEngineCoordinateTranslator } from "./IEngineCoordinateTranslator.js";

/**
 * Build a ScheduleRequest from worker state and a coordinate translator.
 *
 * Maps worker Task/Dependency to kernel ScheduleTask/ScheduleDependency.
 * Preserves stable task order.
 *
 * Phase D5: all coordinate conversion (WorkMinutes → engine primitives)
 * is delegated to the translator. This function no longer knows whether
 * the output is day-slots, minutes, or any other unit. Constraint
 * snapping is also the translator's responsibility.
 *
 * The translator is constructed by the engine adapter, not the worker.
 */

export const buildScheduleRequest = (
  tasks: readonly Task[],
  dependencies: readonly Dependency[],
  nonWorkingDays: readonly number[],
  translator: IEngineCoordinateTranslator,
): ScheduleRequest => {
  // Derive summary set from parentId relationships
  const summaryIds = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) summaryIds.add(t.parentId);
  }

  const scheduleTasks: ScheduleTask[] = tasks.map(task => {
    // D5: engine-agnostic — the translator decides the output unit.
    const constraintValue = task.constraintDateMinutes != null
      ? translator.convertConstraintDate(task.constraintDateMinutes, task.constraintType) as WorkMinutes
      : undefined;

    return {
      id: task.id,
      durationWorkMinutes: translator.convertDuration(task.durationWorkMinutes) as WorkMinutes,
      minEarlyStartMinutes: translator.convertMinEarlyStart(task.minEarlyStartMinutes ?? 0 as WorkMinutes) as WorkMinutes,
      parentId: task.parentId,
      isSummary: summaryIds.has(task.id),
      ...(task.constraintType !== undefined ? { constraintType: task.constraintType } : {}),
      ...(constraintValue !== undefined ? { constraintDateMinutes: constraintValue } : {}),
    };
  });

  // Map all dependencies to kernel format with type and lag
  const scheduleDependencies: ScheduleDependency[] = dependencies.map(dep => ({
    predId: dep.predId,
    succId: dep.succId,
    depType: dep.type,
    lagWorkMinutes: translator.convertLag(dep.lagWorkMinutes) as WorkMinutes,
  }));

  return {
    abiVersion: ENGINE_ABI_VERSION,
    tasks: scheduleTasks,
    dependencies: scheduleDependencies,
    nonWorkingDays,
  };
};
