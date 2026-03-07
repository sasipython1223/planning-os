export type Task = {
  id: string;
  name: string;
  duration: number;
};

export type AddTaskCommand = {
  type: "ADD_TASK";
  reqId: string;
  payload: Task;
};

export type Command = AddTaskCommand;

export type AckMessage = {
  type: "ACK";
  reqId: string;
};

export type DiffTasksMessage = {
  type: "DIFF_TASKS";
  payload: Task[];
};

export type WorkerMessage = AckMessage | DiffTasksMessage;