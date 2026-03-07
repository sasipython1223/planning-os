export type Task = { id: number; name: string; duration: number };

export type Cmd =
  | { v: 1; kind: "cmd"; requestId: string; type: "ADD_TASK"; payload: { name: string; duration: number } };

export type Msg =
  | { v: 1; kind: "evt"; requestId: string; type: "ACK" | "NACK"; payload: { ok: boolean; error?: string } }
  | { v: 1; kind: "diff"; type: "TASKS"; payload: { tasks: Task[] } };
