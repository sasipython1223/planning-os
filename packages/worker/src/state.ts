import type { BaselineMap, Dependency, DependencyType, ScheduleResultMap, Task } from "protocol";

/**
 * State module - owns canonical in-memory tasks and dependencies.
 * No WASM imports, no message protocol knowledge.
 */

let tasks: Task[] = [];
let dependencies: Dependency[] = [];
let projectStartDate: string = new Date().toISOString().slice(0, 10);
let excludeWeekends = true;
let baselineMap: BaselineMap = {};
let latestScheduleResults: ScheduleResultMap = {};

/**
 * Snapshot of state for atomic rollback.
 */
export type StateSnapshot = {
  tasks: Task[];
  dependencies: Dependency[];
};

export const getTasks = (): Task[] => tasks;
export const getDependencies = (): Dependency[] => dependencies;
export const getProjectStartDate = (): string => projectStartDate;
export const getExcludeWeekends = (): boolean => excludeWeekends;
export const getBaselineMap = (): BaselineMap => baselineMap;
export const setBaselineMap = (map: BaselineMap): void => { baselineMap = map; };
export const getLatestScheduleResults = (): ScheduleResultMap => latestScheduleResults;
export const setLatestScheduleResults = (results: ScheduleResultMap): void => { latestScheduleResults = results; };

export const findTask = (id: string): Task | undefined => {
  return tasks.find(t => t.id === id);
};

export const findDependency = (predId: string, succId: string): Dependency | undefined => {
  return dependencies.find(d => d.predId === predId && d.succId === succId);
};

export const findDependencyById = (id: string): Dependency | undefined => {
  return dependencies.find(d => d.id === id);
};

/**
 * Find the insertion index for a new child of the given parent.
 * Scans forward from the parent's position while depth > parent depth,
 * so the new task lands after the parent's last descendant.
 * Returns tasks.length (append) if parentId is not found.
 */
export const findInsertionIndexForParent = (parentId: string): number => {
  const parentIndex = tasks.findIndex(t => t.id === parentId);
  if (parentIndex < 0) return tasks.length;

  const parentDepth = tasks[parentIndex].depth;
  let i = parentIndex + 1;
  while (i < tasks.length && tasks[i].depth > parentDepth) {
    i++;
  }
  return i;
};

export const addTask = (task: Task): void => {
  const newTask = { ...task, depth: task.depth ?? 0, isSummary: task.isSummary ?? false };
  if (newTask.parentId) {
    const insertIndex = findInsertionIndexForParent(newTask.parentId);
    tasks.splice(insertIndex, 0, newTask);
  } else {
    tasks.push(newTask);
  }
};

export const updateTask = (id: string, updates: { name?: string; duration?: number; minEarlyStart?: number; parentId?: string | null }): boolean => {
  const task = findTask(id);
  if (!task) return false;

  if (updates.name !== undefined) {
    task.name = updates.name;
  }
  if (updates.duration !== undefined) {
    task.duration = updates.duration;
  }
  if (updates.minEarlyStart !== undefined) {
    task.minEarlyStart = updates.minEarlyStart;
  }
  if (updates.parentId !== undefined) {
    task.parentId = updates.parentId === null ? undefined : updates.parentId;
  }

  return true;
};

export const addDependency = (dependency: Dependency): void => {
  dependencies.push(dependency);
};

/** Update type/lag on an existing dependency. */
export const updateDependency = (id: string, updates: { type?: DependencyType; lag?: number }): boolean => {
  const dep = dependencies.find(d => d.id === id);
  if (!dep) return false;
  if (updates.type !== undefined) dep.type = updates.type;
  if (updates.lag !== undefined) dep.lag = updates.lag;
  return true;
};

/** Delete a task and cascade-remove all incident dependencies + baseline. */
export const deleteTask = (id: string): boolean => {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return false;
  tasks.splice(index, 1);
  dependencies = dependencies.filter(d => d.predId !== id && d.succId !== id);
  delete baselineMap[id];
  return true;
};

/** Delete a single dependency by id. */
export const deleteDependency = (id: string): boolean => {
  const index = dependencies.findIndex(d => d.id === id);
  if (index < 0) return false;
  dependencies.splice(index, 1);
  return true;
};

/** Collect all descendant task IDs (recursive). */
export const getDescendantIds = (parentId: string): string[] => {
  const result: string[] = [];
  const stack = [parentId];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    for (const t of tasks) {
      if (t.parentId === pid) {
        result.push(t.id);
        stack.push(t.id);
      }
    }
  }
  return result;
};

/** Delete a task and its entire subtree, plus all incident dependencies + baselines. */
export const deleteTaskRecursive = (id: string): boolean => {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return false;
  const idsToRemove = new Set([id, ...getDescendantIds(id)]);
  tasks = tasks.filter(t => !idsToRemove.has(t.id));
  dependencies = dependencies.filter(d => !idsToRemove.has(d.predId) && !idsToRemove.has(d.succId));
  for (const rid of idsToRemove) delete baselineMap[rid];
  return true;
};

/** Recompute depth and isSummary for all tasks in-place. */
export const computeHierarchy = (): void => {
  // Build parentId → children lookup
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.parentId) {
      const siblings = childrenOf.get(t.parentId);
      if (siblings) siblings.push(t.id);
      else childrenOf.set(t.parentId, [t.id]);
    }
  }
  // Compute depth
  for (const t of tasks) {
    let depth = 0;
    let pid = t.parentId;
    while (pid) {
      depth++;
      const parent = tasks.find(p => p.id === pid);
      pid = parent?.parentId;
    }
    t.depth = depth;
    t.isSummary = childrenOf.has(t.id);
  }
};

/**
 * Create a deep snapshot of current state for atomic rollback.
 * Performs structured deep copy of tasks and dependencies.
 */
export const createSnapshot = (): StateSnapshot => {
  return {
    tasks: tasks.map(t => ({ ...t })),
    dependencies: dependencies.map(d => ({ ...d })),
  };
};

/**
 * Restore state from a snapshot (atomic rollback).
 * Replaces current state arrays with snapshot copies.
 */
export const restoreSnapshot = (snapshot: StateSnapshot): void => {
  tasks = snapshot.tasks;
  dependencies = snapshot.dependencies;
};

export const clearState = (): void => {
  tasks = [];
  dependencies = [];
  baselineMap = {};
  latestScheduleResults = {};
};

/** Bulk-load persisted canonical state into memory. */
export const hydrateState = (persisted: {
  projectStartDate: string;
  excludeWeekends: boolean;
  tasks: Task[];
  dependencies: Dependency[];
  baselines: BaselineMap;
}): void => {
  projectStartDate = persisted.projectStartDate;
  excludeWeekends = persisted.excludeWeekends;
  tasks = persisted.tasks.map(t => ({ ...t }));
  dependencies = persisted.dependencies.map(d => ({ ...d }));
  baselineMap = { ...persisted.baselines };
  latestScheduleResults = {};
};

