import type { Assignment, ConstraintType, Dependency, DependencyType, Resource, Task } from "protocol";
import { findDependency, findResource, findTask } from "./state.js";

const VALID_DEP_TYPES: ReadonlySet<DependencyType> = new Set(["FS", "SS", "FF", "SF"]);
const VALID_CONSTRAINT_TYPES: ReadonlySet<ConstraintType> = new Set(["ASAP", "ALAP", "SNET", "FNLT", "MSO", "MFO"]);
const DATED_CONSTRAINTS: ReadonlySet<ConstraintType> = new Set(["SNET", "FNLT", "MSO", "MFO"]);

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

export const validateTaskUpdate = (taskId: string, updates: { name?: string; duration?: number; minEarlyStart?: number; parentId?: string | null; constraintType?: ConstraintType; constraintDate?: number | null }): string | null => {
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return "Task name must not be empty";
  }
  if (updates.duration !== undefined && updates.duration <= 0) {
    return "Task duration must be greater than 0";
  }
  if (updates.minEarlyStart !== undefined && updates.minEarlyStart < 0) {
    return "minEarlyStart must not be negative";
  }
  if (updates.constraintType !== undefined) {
    if (!VALID_CONSTRAINT_TYPES.has(updates.constraintType)) {
      return `Invalid constraint type: ${updates.constraintType}`;
    }
    // Dated constraint without a date is allowed — diagnosed, not rejected.
    // The kernel safely treats missing constraintDate as unconstrained.
  }
  if (updates.constraintDate !== undefined && updates.constraintDate != null) {
    if (updates.constraintDate < 0) {
      return "constraintDate must not be negative";
    }
    // If setting a date without also setting type, check existing type
    const effectiveType = updates.constraintType ?? findTask(taskId)?.constraintType ?? "ASAP";
    if (!DATED_CONSTRAINTS.has(effectiveType as ConstraintType)) {
      return `Cannot set constraintDate on ${effectiveType} constraint`;
    }
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

export const validateResource = (resource: Resource): string | null => {
  if (resource.name.trim().length === 0) {
    return "Resource name must not be empty";
  }
  if (resource.maxUnitsPerDay <= 0) {
    return "maxUnitsPerDay must be greater than 0";
  }
  return null;
};

export const validateResourceUpdate = (updates: { name?: string; maxUnitsPerDay?: number }): string | null => {
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return "Resource name must not be empty";
  }
  if (updates.maxUnitsPerDay !== undefined && updates.maxUnitsPerDay <= 0) {
    return "maxUnitsPerDay must be greater than 0";
  }
  return null;
};

export const validateAssignment = (assignment: Assignment): string | null => {
  if (!findTask(assignment.taskId)) {
    return `Task ${assignment.taskId} does not exist`;
  }
  if (!findResource(assignment.resourceId)) {
    return `Resource ${assignment.resourceId} does not exist`;
  }
  if (assignment.unitsPerDay <= 0) {
    return "unitsPerDay must be greater than 0";
  }
  return null;
};

export const validateAssignmentUpdate = (updates: { unitsPerDay?: number }): string | null => {
  if (updates.unitsPerDay !== undefined && updates.unitsPerDay <= 0) {
    return "unitsPerDay must be greater than 0";
  }
  return null;
};
