export type Task = {
  id: string;
  name: string;
  duration: number;
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Dependency = {
  id: string;
  predId: string;
  succId: string;
  type: DependencyType;
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
  };
};

export type AddDependencyCommand = {
  type: "ADD_DEPENDENCY";
  v: 1;
  reqId: string;
  payload: Dependency;
};

export type Command = AddTaskCommand | UpdateTaskCommand | AddDependencyCommand;

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

export type DiffStateMessage = {
  type: "DIFF_STATE";
  v: 1;
  payload: {
    tasks: Task[];
    dependencies: Dependency[];
  };
};

export type WorkerMessage = AckMessage | NackMessage | DiffStateMessage;