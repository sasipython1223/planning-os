import type {
    Assignment,
    AssumptionSet,
    AuthoredActivity,
    BaseCalendarDefinition,
    BaselineMap,
    CalendarAssignmentState,
    CalendarConfig,
    CalendarId,
    ConstraintType,
    Dependency,
    DependencyType,
    PlannerCalendar,
    Resource,
    ScheduleLifecycleState,
    ScheduleResultMap,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
    SourceTaskDates,
    Task,
    WorkMinutes,
} from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import { DEFAULT_CALENDAR_CONFIG, STANDARD_CALENDAR } from "./calendarTypes.js";
import { compareSiblingOrder, generateMigrationKey, initialKey, keyAfter, keyBefore, midpoint } from "./ordering.js";

/**
 * State module - owns canonical in-memory tasks and dependencies.
 * No WASM imports, no message protocol knowledge.
 */

let tasks: Task[] = [];
let dependencies: Dependency[] = [];
let resources: Resource[] = [];
let assignments: Assignment[] = [];
let projectStartDate: string = new Date().toISOString().slice(0, 10);
/**
 * Phase B canonical project calendar configuration.
 * This is the single source of truth for the project's working-time rules
 * (workingWeekPattern + holidays). The legacy excludeWeekends boolean is
 * derived from this value via getExcludeWeekends() for backward compatibility.
 * Before Phase D, only one computationally active calendar exists.
 */
let projectCalendar: CalendarConfig = DEFAULT_CALENDAR_CONFIG;
/** Phase B: project-level calendar identity. Defaults to DEFAULT_CALENDAR_ID. */
let calendarId: CalendarId = DEFAULT_CALENDAR_ID;
let baselineMap: BaselineMap = {};
let latestScheduleResults: ScheduleResultMap = {};
let scheduleLifecycle: ScheduleLifecycleState = "empty";
let sourceImportRecord: SourceImportRecord | null = null;
let sourceImportFidelityState: SourceImportFidelityState = {
  actualsByTaskId: {},
  progressByTaskId: {},
};
let sourceDatesByTaskId: Record<string, SourceTaskDates> = {};
let varianceReport: SourceCalculatedVarianceReport | null = null;
/**
 * Phase C: calendar dictionary — all known calendars keyed by CalendarId.
 * The project calendar (DEFAULT_CALENDAR_CONFIG) is always implicitly available;
 * this dictionary holds additional calendars that tasks may be assigned to.
 * Before Phase D, only the project calendar is used for computation.
 */
let calendars: Record<string, CalendarConfig> = {};

const makeDefaultPlannerCalendar = (): PlannerCalendar => {
  const now = new Date().toISOString();
  return {
    calendarId: DEFAULT_CALENDAR_ID,
    name: "Default 5-Day / 8h",
    type: "Project",
    source: "planner-editable",
    isDefaultProjectCalendar: true,
    hoursPerDay: 8,
    hoursPerWeek: 40,
    hoursPerMonth: 160,
    hoursPerYear: 2080,
    weeklyHours: {
      0: 0,
      1: 8,
      2: 8,
      3: 8,
      4: 8,
      5: 8,
      6: 0,
    },
    weeklyWorkPeriods: {
      1: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
      2: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
      3: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
      4: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
      5: [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1020 }],
      0: [],
      6: [],
    },
    exceptions: [],
    createdAt: now,
    updatedAt: now,
  };
};

let plannerCalendars: Record<string, PlannerCalendar> = {
  [DEFAULT_CALENDAR_ID as string]: makeDefaultPlannerCalendar(),
};

// ─── Track A Step 1: Calendar definition + assignment state ─────────
// Canonical storage only. Not yet read by any resolver or pipeline.

/**
 * Track A: rich calendar definitions keyed by CalendarId.
 * The STANDARD_CALENDAR is always present at DEFAULT_CALENDAR_ID.
 * Future steps will wire a resolver to read these.
 */
let calendarDefinitions: Record<string, BaseCalendarDefinition> = {
  [DEFAULT_CALENDAR_ID as string]: STANDARD_CALENDAR,
};

/**
 * Track A W3C: resolved (flattened) calendar definitions after inheritance resolution.
 * Populated on import; absent until first import with calendars.
 */
let resolvedCalendarDefinitions: Record<string, BaseCalendarDefinition> = {};

/**
 * Track A: task → calendar assignments.
 * Empty until tasks are explicitly assigned non-default calendars.
 * Complements Task.assignedCalendarId (Phase C per-task field).
 */
let taskCalendarIds: Record<string, CalendarId> = {};

/**
 * Track A: resource → calendar assignments (placeholder).
 * Empty until resource calendar support is activated.
 */
let resourceCalendarIds: Record<string, CalendarId> = {};

/**
 * Snapshot of state for atomic rollback.
 */
export type StateSnapshot = {
  tasks: Task[];
  dependencies: Dependency[];
  resources: Resource[];
  assignments: Assignment[];
  projectStartDate?: string;
  scheduleLifecycle?: ScheduleLifecycleState;
  sourceImportRecord?: SourceImportRecord | null;
  sourceImportFidelityState?: SourceImportFidelityState;
  sourceDatesByTaskId?: Record<string, SourceTaskDates>;
  varianceReport?: SourceCalculatedVarianceReport | null;
  /** W3A: Rich calendar definitions (Track A Step 1). */
  calendarDefinitions?: Record<string, BaseCalendarDefinition>;
  /** W3C: Resolved calendar definitions after inheritance resolution. */
  resolvedCalendarDefinitions?: Record<string, BaseCalendarDefinition>;
  /** C1A/C1B: Editable planner calendars. */
  plannerCalendars?: Record<string, PlannerCalendar>;
};

const cloneSourceImportFidelityState = (
  value: SourceImportFidelityState,
): SourceImportFidelityState => ({
  projectStatus: value.projectStatus ? { ...value.projectStatus } : undefined,
  actualsByTaskId: Object.fromEntries(
    Object.entries(value.actualsByTaskId).map(([taskId, actuals]) => [taskId, {
      ...actuals,
      raw: actuals.raw ? { ...actuals.raw } : undefined,
    }]),
  ),
  progressByTaskId: Object.fromEntries(
    Object.entries(value.progressByTaskId).map(([taskId, progress]) => [taskId, {
      ...progress,
      raw: progress.raw ? { ...progress.raw } : undefined,
    }]),
  ),
  sourceDatesByTaskId: value.sourceDatesByTaskId
    ? Object.fromEntries(
      Object.entries(value.sourceDatesByTaskId).map(([taskId, sourceDates]) => [taskId, { ...sourceDates }]),
    )
    : undefined,
});

export const getTasks = (): Task[] => tasks;
export const getDependencies = (): Dependency[] => dependencies;
export const getProjectStartDate = (): string => projectStartDate;
/** Phase B: derived from projectCalendar.workingWeekPattern for backward compat. */
export const getExcludeWeekends = (): boolean => projectCalendar.workingWeekPattern === "MON_FRI";
export const getProjectCalendar = (): CalendarConfig => projectCalendar;
export const setProjectCalendar = (config: CalendarConfig): void => { projectCalendar = config; };
export const getCalendarId = (): CalendarId => calendarId;
export const setCalendarId = (id: CalendarId): void => { calendarId = id; };
export const getBaselineMap = (): BaselineMap => baselineMap;
export const setBaselineMap = (map: BaselineMap): void => { baselineMap = map; };
export const getResources = (): Resource[] => resources;
export const getAssignments = (): Assignment[] => assignments;
export const getLatestScheduleResults = (): ScheduleResultMap => latestScheduleResults;
export const setLatestScheduleResults = (results: ScheduleResultMap): void => { latestScheduleResults = results; };
export const getScheduleLifecycle = (): ScheduleLifecycleState => scheduleLifecycle;
export const setScheduleLifecycle = (value: ScheduleLifecycleState): void => { scheduleLifecycle = value; };
export const getSourceImportRecord = (): SourceImportRecord | null => sourceImportRecord;
export const setSourceImportRecord = (value: SourceImportRecord | null): void => { sourceImportRecord = value; };
export const getSourceImportFidelityState = (): SourceImportFidelityState => sourceImportFidelityState;
export const setSourceImportFidelityState = (value: SourceImportFidelityState): void => {
  sourceImportFidelityState = cloneSourceImportFidelityState(value);
};
export const getSourceDatesByTaskId = (): Record<string, SourceTaskDates> => sourceDatesByTaskId;
export const setSourceDatesByTaskId = (value: Record<string, SourceTaskDates>): void => {
  sourceDatesByTaskId = { ...value };
};
export const getVarianceReport = (): SourceCalculatedVarianceReport | null => varianceReport;
export const setVarianceReport = (value: SourceCalculatedVarianceReport | null): void => { varianceReport = value; };
/** Phase C: all known calendars beyond the project default. */
export const getCalendars = (): Record<string, CalendarConfig> => calendars;
export const setCalendars = (cals: Record<string, CalendarConfig>): void => { calendars = cals; };
/** Phase C: look up a calendar by ID; returns undefined if not in dictionary. */
export const getCalendarConfig = (id: CalendarId): CalendarConfig | undefined => calendars[id];
export const getPlannerCalendars = (): Record<string, PlannerCalendar> => plannerCalendars;
export const setPlannerCalendars = (value: Record<string, PlannerCalendar>): void => {
  plannerCalendars = {
    [DEFAULT_CALENDAR_ID as string]: value[DEFAULT_CALENDAR_ID as string] ?? makeDefaultPlannerCalendar(),
    ...value,
  };
};
export const upsertPlannerCalendar = (calendar: PlannerCalendar): void => {
  plannerCalendars[calendar.calendarId as string] = { ...calendar };
};

// ─── Track A Step 1: Calendar definition + assignment getters/setters ──
/** Track A: project calendar ID (alias for getCalendarId — explicit name for new system). */
export const getProjectCalendarId = (): CalendarId => calendarId;
/** Track A: all rich calendar definitions. STANDARD_CALENDAR always present. */
export const getCalendarDefinitions = (): Record<string, BaseCalendarDefinition> => calendarDefinitions;
export const setCalendarDefinitions = (defs: Record<string, BaseCalendarDefinition>): void => { calendarDefinitions = defs; };
/** Track A: look up a rich calendar definition by ID. */
export const getCalendarDefinition = (id: CalendarId): BaseCalendarDefinition | undefined => calendarDefinitions[id];
/** Track A W3C: resolved calendar definitions (post-inheritance-resolution). */
export const getResolvedCalendarDefinitions = (): Record<string, BaseCalendarDefinition> => resolvedCalendarDefinitions;
export const setResolvedCalendarDefinitions = (defs: Record<string, BaseCalendarDefinition>): void => { resolvedCalendarDefinitions = defs; };
/** Track A: task → calendar assignment map. */
export const getTaskCalendarIds = (): Record<string, CalendarId> => taskCalendarIds;
export const setTaskCalendarIds = (map: Record<string, CalendarId>): void => { taskCalendarIds = map; };
/** Track A: resource → calendar assignment map (placeholder). */
export const getResourceCalendarIds = (): Record<string, CalendarId> => resourceCalendarIds;
export const setResourceCalendarIds = (map: Record<string, CalendarId>): void => { resourceCalendarIds = map; };
/** Track A: composite calendar assignment snapshot. */
export const getCalendarAssignmentState = (): CalendarAssignmentState => ({
  projectCalendarId: calendarId,
  taskCalendarIds,
  resourceCalendarIds,
});

export const findTask = (id: string): Task | undefined => {
  return tasks.find(t => t.id === id);
};

export const findDependency = (predId: string, succId: string): Dependency | undefined => {
  return dependencies.find(d => d.predId === predId && d.succId === succId);
};

export const findDependencyById = (id: string): Dependency | undefined => {
  return dependencies.find(d => d.id === id);
};

/** Derive whether a task is a summary (has any child). O(N) scan. */
export const isTaskSummary = (id: string): boolean => {
  return tasks.some(t => t.parentId === id);
};

/** Derive depth for a task by walking its parentId chain. */
export const getTaskDepth = (id: string): number => {
  let depth = 0;
  let current = findTask(id);
  while (current?.parentId) {
    depth++;
    current = findTask(current.parentId);
  }
  return depth;
};

/**
 * Find the insertion index for a new child of the given parent.
 * Scans forward from the parent's position while tasks are descendants,
 * so the new task lands after the parent's last descendant.
 * Returns tasks.length (append) if parentId is not found.
 */
export const findInsertionIndexForParent = (parentId: string): number => {
  const parentIndex = tasks.findIndex(t => t.id === parentId);
  if (parentIndex < 0) return tasks.length;

  const descendants = new Set<string>([parentId]);
  let i = parentIndex + 1;
  while (i < tasks.length && tasks[i].parentId != null && descendants.has(tasks[i].parentId!)) {
    descendants.add(tasks[i].id);
    i++;
  }
  return i;
};

export const addTask = (task: Task): void => {
  const newTask = { ...task };
  // Assign siblingOrder if not provided
  if (!newTask.siblingOrder) {
    const siblings = tasks.filter(t => t.parentId === newTask.parentId);
    if (siblings.length === 0) {
      newTask.siblingOrder = initialKey();
    } else {
      const lastSibling = siblings.reduce((a, b) => a.siblingOrder > b.siblingOrder ? a : b);
      newTask.siblingOrder = keyAfter(lastSibling.siblingOrder);
    }
  }
  if (newTask.parentId) {
    const insertIndex = findInsertionIndexForParent(newTask.parentId);
    tasks.splice(insertIndex, 0, newTask);
  } else {
    tasks.push(newTask);
  }
};

export const updateTask = (id: string, updates: { name?: string; durationWorkMinutes?: WorkMinutes; minEarlyStartMinutes?: WorkMinutes; parentId?: string | null; constraintType?: ConstraintType; constraintDateMinutes?: WorkMinutes | null; assignedCalendarId?: CalendarId | null }): boolean => {
  const task = findTask(id);
  if (!task) return false;

  if (updates.name !== undefined) {
    task.name = updates.name;
  }
  if (updates.durationWorkMinutes !== undefined) {
    task.durationWorkMinutes = updates.durationWorkMinutes;
  }
  if (updates.minEarlyStartMinutes !== undefined) {
    task.minEarlyStartMinutes = updates.minEarlyStartMinutes;
  }
  if (updates.parentId !== undefined) {
    task.parentId = updates.parentId === null ? undefined : updates.parentId;
  }
  if (updates.constraintType !== undefined) {
    task.constraintType = updates.constraintType;
    // When switching to ASAP/ALAP, clear the date
    if (updates.constraintType === "ASAP" || updates.constraintType === "ALAP") {
      task.constraintDateMinutes = null;
    }
  }
  if (updates.constraintDateMinutes !== undefined) {
    task.constraintDateMinutes = updates.constraintDateMinutes;
  }
  if (updates.assignedCalendarId !== undefined) {
    // null → clear (inherit project calendar); CalendarId → assign
    task.assignedCalendarId = updates.assignedCalendarId === null ? undefined : updates.assignedCalendarId;
  }

  return true;
};

export const addDependency = (dependency: Dependency): void => {
  dependencies.push(dependency);
};

/** Update type/lag on an existing dependency. */
export const updateDependency = (id: string, updates: { type?: DependencyType; lagWorkMinutes?: WorkMinutes }): boolean => {
  const dep = dependencies.find(d => d.id === id);
  if (!dep) return false;
  if (updates.type !== undefined) dep.type = updates.type;
  if (updates.lagWorkMinutes !== undefined) dep.lagWorkMinutes = updates.lagWorkMinutes;
  return true;
};

/** Delete a task and cascade-remove all incident dependencies + baseline + assignments. */
export const deleteTask = (id: string): boolean => {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return false;
  tasks.splice(index, 1);
  dependencies = dependencies.filter(d => d.predId !== id && d.succId !== id);
  assignments = assignments.filter(a => a.taskId !== id);
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

/** Delete a task and its entire subtree, plus all incident dependencies + baselines + assignments. */
export const deleteTaskRecursive = (id: string): boolean => {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return false;
  const idsToRemove = new Set([id, ...getDescendantIds(id)]);
  tasks = tasks.filter(t => !idsToRemove.has(t.id));
  dependencies = dependencies.filter(d => !idsToRemove.has(d.predId) && !idsToRemove.has(d.succId));
  assignments = assignments.filter(a => !idsToRemove.has(a.taskId));
  for (const rid of idsToRemove) delete baselineMap[rid];
  return true;
};

/** Recompute flat WBS order for all tasks in-place. */
export const computeHierarchy = (): void => {
  // Build parentId → children lookup
  const childrenOf = new Map<string, Task[]>();
  const rootTasks: Task[] = [];
  for (const t of tasks) {
    if (t.parentId) {
      let siblings = childrenOf.get(t.parentId);
      if (!siblings) { siblings = []; childrenOf.set(t.parentId, siblings); }
      siblings.push(t);
    } else {
      rootTasks.push(t);
    }
  }

  // Sort children by siblingOrder within each group
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => compareSiblingOrder(a.siblingOrder, b.siblingOrder));
  }
  rootTasks.sort((a, b) => compareSiblingOrder(a.siblingOrder, b.siblingOrder));

  // DFS traversal to build flat WBS order
  const ordered: Task[] = [];
  const visit = (task: Task): void => {
    ordered.push(task);
    const children = childrenOf.get(task.id);
    if (children) {
      for (const child of children) {
        visit(child);
      }
    }
  };
  for (const root of rootTasks) {
    visit(root);
  }

  // Replace the flat array with the WBS-ordered result
  tasks = ordered;
};

// ── Structural Mutations ─────────────────────────────────────────────

/** Get siblings of a task (tasks sharing the same parentId), sorted by siblingOrder. */
const getSiblings = (task: Task): Task[] => {
  return tasks
    .filter(t => t.parentId === task.parentId && t.id !== task.id)
    .sort((a, b) => compareSiblingOrder(a.siblingOrder, b.siblingOrder));
};

/** Get siblings of a given parentId, sorted by siblingOrder. */
const getChildrenOf = (parentId: string | undefined): Task[] => {
  return tasks
    .filter(t => t.parentId === parentId)
    .sort((a, b) => compareSiblingOrder(a.siblingOrder, b.siblingOrder));
};

/** Check if `candidateDescendant` is a descendant of `ancestorId`. */
export const isDescendantOf = (candidateDescendant: string, ancestorId: string): boolean => {
  const visited = new Set<string>();
  let current = findTask(candidateDescendant);
  while (current?.parentId) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = findTask(current.parentId);
  }
  return false;
};

/**
 * Indent a task: make it a child of its previous sibling at the same level.
 * Returns an error string if the operation is invalid, or null on success.
 */
export const indentTask = (taskId: string): string | null => {
  const task = findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  // Get all siblings (same parentId) sorted by siblingOrder
  const allSiblings = getChildrenOf(task.parentId);
  const myIndex = allSiblings.findIndex(t => t.id === taskId);
  if (myIndex <= 0) return "Cannot indent: no previous sibling to become parent";

  const newParent = allSiblings[myIndex - 1];

  // Place as last child of new parent
  const newParentChildren = getChildrenOf(newParent.id);
  if (newParentChildren.length === 0) {
    task.siblingOrder = initialKey();
  } else {
    const lastChild = newParentChildren[newParentChildren.length - 1];
    task.siblingOrder = keyAfter(lastChild.siblingOrder);
  }
  task.parentId = newParent.id;
  return null;
};

/**
 * Outdent a task: move it up one level to be a sibling after its current parent.
 * Returns an error string if the operation is invalid, or null on success.
 */
export const outdentTask = (taskId: string): string | null => {
  const task = findTask(taskId);
  if (!task) return `Task ${taskId} not found`;
  if (!task.parentId) return "Cannot outdent: task is at root level";

  const parent = findTask(task.parentId);
  if (!parent) return "Cannot outdent: parent not found";

  const grandParentId = parent.parentId;
  // Place after parent among grandparent's children
  const parentSiblings = getChildrenOf(grandParentId);
  const parentIndex = parentSiblings.findIndex(t => t.id === parent.id);
  const afterParent = parentIndex < parentSiblings.length - 1
    ? parentSiblings[parentIndex + 1]
    : undefined;

  if (afterParent) {
    task.siblingOrder = midpoint(parent.siblingOrder, afterParent.siblingOrder);
  } else {
    task.siblingOrder = keyAfter(parent.siblingOrder);
  }
  task.parentId = grandParentId;
  return null;
};

/**
 * Move a task to a new parent, optionally positioned after a specific sibling.
 * Returns an error string if the operation is invalid, or null on success.
 */
export const moveTask = (taskId: string, newParentId: string | undefined | null, afterTaskId?: string): string | null => {
  const task = findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  const targetParentId = newParentId === null ? undefined : newParentId;

  // Validate: cannot move under own descendant
  if (targetParentId && (targetParentId === taskId || isDescendantOf(targetParentId, taskId))) {
    return "Cannot move task under its own descendant";
  }

  // Validate target parent exists if specified
  if (targetParentId && !findTask(targetParentId)) {
    return `Target parent ${targetParentId} not found`;
  }

  const targetSiblings = getChildrenOf(targetParentId).filter(t => t.id !== taskId);

  if (afterTaskId) {
    const afterTask = targetSiblings.find(t => t.id === afterTaskId);
    if (!afterTask) return `After-task ${afterTaskId} not found among target siblings`;
    const afterIndex = targetSiblings.indexOf(afterTask);
    const nextTask = afterIndex < targetSiblings.length - 1 ? targetSiblings[afterIndex + 1] : undefined;
    task.siblingOrder = nextTask
      ? midpoint(afterTask.siblingOrder, nextTask.siblingOrder)
      : keyAfter(afterTask.siblingOrder);
  } else {
    // Place first
    if (targetSiblings.length === 0) {
      task.siblingOrder = initialKey();
    } else {
      task.siblingOrder = keyBefore(targetSiblings[0].siblingOrder);
    }
  }

  task.parentId = targetParentId;
  return null;
};

/**
 * Reorder a task among its siblings without changing parent.
 * afterTaskId = undefined means place first.
 * Returns an error string if the operation is invalid, or null on success.
 */
export const reorderTask = (taskId: string, afterTaskId?: string): string | null => {
  const task = findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  const siblings = getChildrenOf(task.parentId).filter(t => t.id !== taskId);

  if (afterTaskId) {
    const afterTask = siblings.find(t => t.id === afterTaskId);
    if (!afterTask) return `After-task ${afterTaskId} not found among siblings`;
    const afterIndex = siblings.indexOf(afterTask);
    const nextTask = afterIndex < siblings.length - 1 ? siblings[afterIndex + 1] : undefined;
    task.siblingOrder = nextTask
      ? midpoint(afterTask.siblingOrder, nextTask.siblingOrder)
      : keyAfter(afterTask.siblingOrder);
  } else {
    // Place first
    if (siblings.length === 0) {
      task.siblingOrder = initialKey();
    } else {
      task.siblingOrder = keyBefore(siblings[0].siblingOrder);
    }
  }

  return null;
};

/**
 * Create a deep snapshot of current state for atomic rollback.
 * Performs structured deep copy of tasks and dependencies.
 */
export const createSnapshot = (): StateSnapshot => {
  return {
    tasks: tasks.map(t => ({ ...t })),
    dependencies: dependencies.map(d => ({ ...d })),
    resources: resources.map(r => ({ ...r })),
    assignments: assignments.map(a => ({ ...a })),
    projectStartDate,
    scheduleLifecycle,
    sourceImportRecord: sourceImportRecord
      ? {
          ...sourceImportRecord,
          summary: { ...sourceImportRecord.summary },
          diagnostics: sourceImportRecord.diagnostics.map(d => ({ ...d })),
          sourceImportFidelityState: sourceImportRecord.sourceImportFidelityState
            ? cloneSourceImportFidelityState(sourceImportRecord.sourceImportFidelityState)
            : undefined,
          calendarDefinitions: sourceImportRecord.calendarDefinitions
            ? { ...sourceImportRecord.calendarDefinitions }
            : undefined,
          resolvedCalendarDefinitions: sourceImportRecord.resolvedCalendarDefinitions
            ? { ...sourceImportRecord.resolvedCalendarDefinitions }
            : undefined,
        }
      : null,
    sourceImportFidelityState: cloneSourceImportFidelityState(sourceImportFidelityState),
    sourceDatesByTaskId: { ...sourceDatesByTaskId },
    varianceReport,
    calendarDefinitions: { ...calendarDefinitions },
    resolvedCalendarDefinitions: { ...resolvedCalendarDefinitions },
    plannerCalendars: { ...plannerCalendars },
  };
};

/**
 * Restore state from a snapshot (atomic rollback).
 * Replaces current state arrays with snapshot copies.
 */
export const restoreSnapshot = (snapshot: StateSnapshot): void => {
  tasks = snapshot.tasks;
  dependencies = snapshot.dependencies;
  resources = snapshot.resources;
  assignments = snapshot.assignments;
  if (snapshot.projectStartDate !== undefined) projectStartDate = snapshot.projectStartDate;
  if (snapshot.scheduleLifecycle !== undefined) scheduleLifecycle = snapshot.scheduleLifecycle;
  if (snapshot.sourceImportRecord !== undefined) sourceImportRecord = snapshot.sourceImportRecord;
  if (snapshot.sourceImportFidelityState !== undefined) {
    sourceImportFidelityState = cloneSourceImportFidelityState(snapshot.sourceImportFidelityState);
  }
  if (snapshot.sourceDatesByTaskId !== undefined) {
    sourceDatesByTaskId = { ...snapshot.sourceDatesByTaskId };
  }
  if (snapshot.varianceReport !== undefined) {
    varianceReport = snapshot.varianceReport;
  }
  if (snapshot.calendarDefinitions !== undefined) {
    calendarDefinitions = { ...snapshot.calendarDefinitions };
  }
  if (snapshot.resolvedCalendarDefinitions !== undefined) {
    resolvedCalendarDefinitions = { ...snapshot.resolvedCalendarDefinitions };
  }
  if (snapshot.plannerCalendars !== undefined) {
    plannerCalendars = { ...snapshot.plannerCalendars };
  }
};

export const clearState = (): void => {
  tasks = [];
  dependencies = [];
  resources = [];
  assignments = [];
  projectCalendar = DEFAULT_CALENDAR_CONFIG;
  calendarId = DEFAULT_CALENDAR_ID;
  calendars = {};
  calendarDefinitions = { [DEFAULT_CALENDAR_ID as string]: STANDARD_CALENDAR };
  plannerCalendars = { [DEFAULT_CALENDAR_ID as string]: makeDefaultPlannerCalendar() };
  taskCalendarIds = {};
  resourceCalendarIds = {};
  baselineMap = {};
  latestScheduleResults = {};
  scheduleLifecycle = "empty";
  sourceImportRecord = null;
  sourceImportFidelityState = { actualsByTaskId: {}, progressByTaskId: {} };
  sourceDatesByTaskId = {};
  varianceReport = null;
};

/** Bulk-load persisted canonical state into memory. */
export const hydrateState = (persisted: {
  projectStartDate: string;
  excludeWeekends: boolean;
  /** Phase B: optional calendar identity. Missing → DEFAULT_CALENDAR_ID. */
  calendarId?: CalendarId;
  /** Phase B: optional full calendar config. Missing → synthesized from excludeWeekends. */
  projectCalendar?: CalendarConfig;
  /** Phase C: optional calendar dictionary. Missing → empty. */
  calendars?: Record<string, CalendarConfig>;
  /** Track A: optional rich calendar definitions. Missing → STANDARD_CALENDAR only. */
  calendarDefinitions?: Record<string, BaseCalendarDefinition>;
  /** Track A W3C: optional resolved calendar definitions. Missing → empty. */
  resolvedCalendarDefinitions?: Record<string, BaseCalendarDefinition>;
  /** Track A: optional task → calendar assignments. Missing → empty. */
  taskCalendarIds?: Record<string, CalendarId>;
  /** Track A: optional resource → calendar assignments. Missing → empty. */
  resourceCalendarIds?: Record<string, CalendarId>;
  /** C1A/C1B: optional editable planner calendars. Missing → default editable calendar only. */
  plannerCalendars?: Record<string, PlannerCalendar>;
  tasks: Task[];
  dependencies: Dependency[];
  baselines: BaselineMap;
  resources?: Resource[];
  assignments?: Assignment[];
  scheduleLifecycle?: ScheduleLifecycleState;
  sourceImportRecord?: SourceImportRecord | null;
  sourceImportFidelityState?: SourceImportFidelityState;
  sourceDatesByTaskId?: Record<string, SourceTaskDates>;
  varianceReport?: SourceCalculatedVarianceReport | null;
}): void => {
  projectStartDate = persisted.projectStartDate;
  // Phase B migration: if projectCalendar is present, use it; otherwise synthesize from excludeWeekends
  if (persisted.projectCalendar) {
    projectCalendar = persisted.projectCalendar;
  } else {
    projectCalendar = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: persisted.excludeWeekends ? "MON_FRI" : "ALL_DAYS",
    };
  }
  calendarId = persisted.calendarId ?? DEFAULT_CALENDAR_ID;
  // Phase C: hydrate calendar dictionary (empty if absent from older snapshots)
  calendars = persisted.calendars ? { ...persisted.calendars } : {};
  // Track A: hydrate rich calendar definitions (STANDARD_CALENDAR always present)
  calendarDefinitions = persisted.calendarDefinitions
    ? { [DEFAULT_CALENDAR_ID as string]: STANDARD_CALENDAR, ...persisted.calendarDefinitions }
    : { [DEFAULT_CALENDAR_ID as string]: STANDARD_CALENDAR };
  resolvedCalendarDefinitions = persisted.resolvedCalendarDefinitions
    ? { ...persisted.resolvedCalendarDefinitions }
    : {};
  taskCalendarIds = persisted.taskCalendarIds ? { ...persisted.taskCalendarIds } : {};
  resourceCalendarIds = persisted.resourceCalendarIds ? { ...persisted.resourceCalendarIds } : {};
  plannerCalendars = persisted.plannerCalendars
    ? {
        [DEFAULT_CALENDAR_ID as string]: persisted.plannerCalendars[DEFAULT_CALENDAR_ID as string] ?? makeDefaultPlannerCalendar(),
        ...persisted.plannerCalendars,
      }
    : { [DEFAULT_CALENDAR_ID as string]: makeDefaultPlannerCalendar() };
  tasks = persisted.tasks.map((t, i) => ({
    ...t,
    constraintType: t.constraintType ?? "ASAP",
    constraintDateMinutes: t.constraintDateMinutes ?? null,
    siblingOrder: t.siblingOrder || generateMigrationKey(i),
  }));
  dependencies = persisted.dependencies.map(d => ({ ...d }));
  baselineMap = { ...persisted.baselines };
  resources = (persisted.resources ?? []).map(r => ({ ...r }));
  assignments = (persisted.assignments ?? []).map(a => ({ ...a }));
  latestScheduleResults = {};
  scheduleLifecycle = persisted.scheduleLifecycle ?? (tasks.length === 0 ? "empty" : "plannerCalculated");
  sourceImportRecord = persisted.sourceImportRecord
    ? {
        ...persisted.sourceImportRecord,
        summary: { ...persisted.sourceImportRecord.summary },
        diagnostics: persisted.sourceImportRecord.diagnostics.map(d => ({ ...d })),
        sourceImportFidelityState: persisted.sourceImportRecord.sourceImportFidelityState
          ? cloneSourceImportFidelityState(persisted.sourceImportRecord.sourceImportFidelityState)
          : undefined,
        calendarDefinitions: persisted.sourceImportRecord.calendarDefinitions
          ? { ...persisted.sourceImportRecord.calendarDefinitions }
          : undefined,
        resolvedCalendarDefinitions: persisted.sourceImportRecord.resolvedCalendarDefinitions
          ? { ...persisted.sourceImportRecord.resolvedCalendarDefinitions }
          : undefined,
        sourceProjectSettings: persisted.sourceImportRecord.sourceProjectSettings
          ? { ...persisted.sourceImportRecord.sourceProjectSettings }
          : undefined,
      }
    : null;
  sourceImportFidelityState = persisted.sourceImportFidelityState
    ? cloneSourceImportFidelityState(persisted.sourceImportFidelityState)
    : { actualsByTaskId: {}, progressByTaskId: {} };
  sourceDatesByTaskId = persisted.sourceDatesByTaskId ? { ...persisted.sourceDatesByTaskId } : {};
  varianceReport = persisted.varianceReport ?? null;
};

// ---- Resource CRUD ----

export const findResource = (id: string): Resource | undefined =>
  resources.find(r => r.id === id);

export const addResource = (resource: Resource): void => {
  resources.push({ ...resource });
};

export const updateResource = (id: string, updates: { name?: string; maxUnitsPerDay?: number }): boolean => {
  const res = findResource(id);
  if (!res) return false;
  if (updates.name !== undefined) res.name = updates.name;
  if (updates.maxUnitsPerDay !== undefined) res.maxUnitsPerDay = updates.maxUnitsPerDay;
  return true;
};

export const deleteResource = (id: string): boolean => {
  const index = resources.findIndex(r => r.id === id);
  if (index < 0) return false;
  resources.splice(index, 1);
  assignments = assignments.filter(a => a.resourceId !== id);
  return true;
};

// ---- Assignment CRUD ----

export const findAssignment = (id: string): Assignment | undefined =>
  assignments.find(a => a.id === id);

export const addAssignment = (assignment: Assignment): void => {
  assignments.push({ ...assignment });
};

export const updateAssignment = (id: string, updates: { unitsPerDay?: number }): boolean => {
  const a = findAssignment(id);
  if (!a) return false;
  if (updates.unitsPerDay !== undefined) a.unitsPerDay = updates.unitsPerDay;
  return true;
};

export const deleteAssignment = (id: string): boolean => {
  const index = assignments.findIndex(a => a.id === id);
  if (index < 0) return false;
  assignments.splice(index, 1);
  return true;
};

// ── Domain Model Seams (M07 — compiled path placeholders) ───────────
// These return empty defaults until domain model state is stored in the worker.
// The compiled scheduling path calls these; the legacy path does not.

const EMPTY_ASSUMPTION_SET: AssumptionSet = {
  id: "placeholder",
  version: 0,
  name: "Placeholder",
  zones: [],
  quantities: [],
  resources: [],
  productivityRules: [],
};

/** Return the current AssumptionSet. Placeholder until domain state is stored. */
export const getAssumptionSet = (): AssumptionSet => EMPTY_ASSUMPTION_SET;

/** Return authored activities. Placeholder until domain state is stored. */
export const getAuthoredActivities = (): readonly AuthoredActivity[] => [];

