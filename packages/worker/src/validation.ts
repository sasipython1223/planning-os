import type { Dependency, DependencyType, Task } from "protocol";
import { findDependency, findTask } from "./state.js";

const VALID_DEP_TYPES: ReadonlySet<DependencyType> = new Set(["FS", "SS", "FF", "SF"]);

/**
 * Validation logic for tasks and dependencies.
 * Separated from state and worker routing.
 */

export const validateTask = (task: Task): string | null => {
  if (task.name.trim().length === 0) {
    return "Task name must not be empty";
  }
  if (task.duration <= 0) {
    return "Task duration must be greater than 0";
  }
  return null;
};

export const validateTaskUpdate = (taskId: string, updates: { name?: string; duration?: number; minEarlyStart?: number; parentId?: string | null }): string | null => {
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return "Task name must not be empty";
  }
  if (updates.duration !== undefined && updates.duration <= 0) {
    return "Task duration must be greater than 0";
  }
  if (updates.minEarlyStart !== undefined && updates.minEarlyStart < 0) {
    return "minEarlyStart must not be negative";
  }
  if (updates.parentId !== undefined && updates.parentId !== null) {
    if (updates.parentId === taskId) {
      return "Task cannot be its own parent";
    }
    if (!findTask(updates.parentId)) {
      return `Parent task ${updates.parentId} does not exist`;
    }
    // Check for ancestor cycle: walk up from proposed parent
    let pid: string | undefined = updates.parentId;
    while (pid) {
      const parent = findTask(pid);
      if (!parent) break;
      pid = parent.parentId;
      if (pid === taskId) {
        return "Setting this parent would create a hierarchy cycle";
      }
    }
  }
  return null;
};

export const validateDependency = (dep: Dependency): string | null => {
  if (dep.predId === dep.succId) {
    return "Dependency cannot point to itself";
  }
  if (!findTask(dep.predId)) {
    return `Predecessor task ${dep.predId} does not exist`;
  }
  if (!findTask(dep.succId)) {
    return `Successor task ${dep.succId} does not exist`;
  }
  if (findDependency(dep.predId, dep.succId)) {
    return "Duplicate dependency";
  }
  if (!VALID_DEP_TYPES.has(dep.type)) {
    return `Invalid dependency type: ${dep.type}`;
  }
  if (!Number.isInteger(dep.lag)) {
    return "Lag must be an integer";
  }
  return null;
};

export const validateDependencyUpdate = (updates: { type?: DependencyType; lag?: number }): string | null => {
  if (updates.type !== undefined && !VALID_DEP_TYPES.has(updates.type)) {
    return `Invalid dependency type: ${updates.type}`;
  }
  if (updates.lag !== undefined && !Number.isInteger(updates.lag)) {
    return "Lag must be an integer";
  }
  return null;
};
