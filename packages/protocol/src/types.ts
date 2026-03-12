export type Task = {
  id: string;
  name: string;
  duration: number;
  minEarlyStart?: number;
  parentId?: string;
  depth: number;
  isSummary: boolean;
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Dependency = {
  id: string;
  predId: string;
  succId: string;
  type: DependencyType;
  lag: number;
};

export type Resource = {
  id: string;
  name: string;
  maxUnitsPerDay: number;
};

export type Assignment = {
  id: string;
  taskId: string;
  resourceId: string;
  unitsPerDay: number;
};

export type AddTaskCommand = {
  type: "ADD_TASK";
  v: 1;
  reqId: string;
  payload: Task;
};

export type UpdateTaskCommand = {
  type: "UPDATE_TASK";
  v: 1;
  reqId: string;
  taskId: string;
  updates: {
    name?: string;
    duration?: number;
    minEarlyStart?: number;
    parentId?: string | null;
  };
};

export type AddDependencyCommand = {
  type: "ADD_DEPENDENCY";
  v: 1;
  reqId: string;
  payload: Dependency;
};

export type DeleteTaskCommand = {
  type: "DELETE_TASK";
  v: 1;
  reqId: string;
  taskId: string;
};

export type DeleteDependencyCommand = {
  type: "DELETE_DEPENDENCY";
  v: 1;
  reqId: string;
  dependencyId: string;
};

export type UpdateDependencyCommand = {
  type: "UPDATE_DEPENDENCY";
  v: 1;
  reqId: string;
  dependencyId: string;
  updates: {
    type?: DependencyType;
    lag?: number;
  };
};

export type SnapshotBaselineCommand = {
  type: "SNAPSHOT_BASELINE";
  v: 1;
  reqId: string;
};

export type ClearBaselineCommand = {
  type: "CLEAR_BASELINE";
  v: 1;
  reqId: string;
};

export type AddResourceCommand = {
  type: "ADD_RESOURCE";
  v: 1;
  reqId: string;
  payload: Resource;
};

export type UpdateResourceCommand = {
  type: "UPDATE_RESOURCE";
  v: 1;
  reqId: string;
  resourceId: string;
  updates: {
    name?: string;
    maxUnitsPerDay?: number;
  };
};

export type DeleteResourceCommand = {
  type: "DELETE_RESOURCE";
  v: 1;
  reqId: string;
  resourceId: string;
};

export type AddAssignmentCommand = {
  type: "ADD_ASSIGNMENT";
  v: 1;
  reqId: string;
  payload: Assignment;
};

export type UpdateAssignmentCommand = {
  type: "UPDATE_ASSIGNMENT";
  v: 1;
  reqId: string;
  assignmentId: string;
  updates: {
    unitsPerDay?: number;
  };
};

export type DeleteAssignmentCommand = {
  type: "DELETE_ASSIGNMENT";
  v: 1;
  reqId: string;
  assignmentId: string;
};

export type UndoCommand = {
  type: "UNDO";
  v: 1;
  reqId: string;
};

export type RedoCommand = {
  type: "REDO";
  v: 1;
  reqId: string;
};

export type Command = AddTaskCommand | UpdateTaskCommand | AddDependencyCommand | DeleteTaskCommand | DeleteDependencyCommand | UpdateDependencyCommand | SnapshotBaselineCommand | ClearBaselineCommand | AddResourceCommand | UpdateResourceCommand | DeleteResourceCommand | AddAssignmentCommand | UpdateAssignmentCommand | DeleteAssignmentCommand | UndoCommand | RedoCommand;

export type AckMessage = {
  type: "ACK";
  v: 1;
  reqId: string;
};

export type NackMessage = {
  type: "NACK";
  v: 1;
  reqId: string;
  error: string;
};

export type BaselineEntry = {
  start: number;
  finish: number;
};

export type BaselineMap = {
  [taskId: string]: BaselineEntry;
};

export type ScheduleResultMap = {
  [taskId: string]: {
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    totalFloat: number;
    isCritical: boolean;
  };
};

export type TaskVariance = {
  startVariance: number;
  finishVariance: number;
  durationVariance: number;
};

export type VarianceMap = Record<string, TaskVariance>;

export type ResourceHistogram = Record<string, Record<number, number>>;

export type DiffStateMessage = {
  type: "DIFF_STATE";
  v: 1;
  payload: {
    tasks: Task[];
    dependencies: Dependency[];
    scheduleResults: ScheduleResultMap;
    baselines: BaselineMap;
    variances: VarianceMap;
    projectStartDate: string;
    nonWorkingDays: number[];
    resources: Resource[];
    assignments: Assignment[];
    resourceHistogram: ResourceHistogram;
    canUndo: boolean;
    canRedo: boolean;
  };
};

export type WorkerReadyMessage = {
  type: "WORKER_READY";
  v: 1;
};

export type ScheduleErrorMessage = {
  type: "SCHEDULE_ERROR";
  v: 1;
  error: {
    type: "DuplicateTaskId" | "SelfDependency" | "TaskNotFound" | "CycleDetected";
    message: string;
    taskId?: string;
  };
};

export type WorkerMessage =
  | AckMessage
  | NackMessage
  | DiffStateMessage
  | WorkerReadyMessage
  | ScheduleErrorMessage;