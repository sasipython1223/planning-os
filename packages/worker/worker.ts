import type { Cmd, Msg, Task } from "../protocol/src/types";

const tasks: Task[] = [];
let nextId = 1;

self.onmessage = (e: MessageEvent<Cmd>) => {
  const msg = e.data;
  if (!msg || msg.v !== 1 || msg.kind !== "cmd") return;

  if (msg.type === "ADD_TASK") {
    const { name, duration } = msg.payload;

    if (!name || duration <= 0) {
      const nack: Msg = { v: 1, kind: "evt", requestId: msg.requestId, type: "NACK", payload: { ok: false, error: "Invalid task" } };
      (self as any).postMessage(nack);
      return;
    }

    tasks.push({ id: nextId++, name, duration });

    const ack: Msg = { v: 1, kind: "evt", requestId: msg.requestId, type: "ACK", payload: { ok: true } };
    (self as any).postMessage(ack);

    const diff: Msg = { v: 1, kind: "diff", type: "TASKS", payload: { tasks } };
    (self as any).postMessage(diff);
  }
};
