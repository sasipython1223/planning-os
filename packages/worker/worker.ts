/// <reference lib="webworker" />

import type { Command, Task, WorkerMessage } from "protocol";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

let tasks: Task[] = [];

const emit = (message: WorkerMessage) => {
  ctx.postMessage(message);
};

ctx.onmessage = (event: MessageEvent<Command>) => {
  const cmd = event.data;

  if (cmd.type === "ADD_TASK") {
    tasks.push(cmd.payload);

    emit({ type: "ACK", reqId: cmd.reqId });
    emit({ type: "DIFF_TASKS", payload: [...tasks] });
  }
};

export { };
