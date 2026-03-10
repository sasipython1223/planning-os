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

export type Command = AddTaskCommand | UpdateTaskCommand | AddDependencyCommand | DeleteTaskCommand | DeleteDependencyCommand | UpdateDependencyCommand | SnapshotBaselineCommand | ClearBaselineCommand;

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

export type DiffStateMessage = {
  type: "DIFF_STATE";
  v: 1;
  payload: {
    tasks: Task[];
    dependencies: Dependency[];
    scheduleResults: ScheduleResultMap;
    baselines: BaselineMap;
    projectStartDate: string;
    nonWorkingDays: number[];
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