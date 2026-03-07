import type { Command, Task, WorkerMessage } from "protocol";
import { expect, test } from "vitest";

test("Worker DIFF_TASKS payload must be a structural object, NOT a JSON string", () => {
  const emittedMessages: WorkerMessage[] = [];
  let internalTasks: Task[] = [];

  const mockWorkerHandler = (cmd: Command) => {
    if (cmd.type === "ADD_TASK") {
      internalTasks.push(cmd.payload);

      emittedMessages.push({ type: "ACK", reqId: cmd.reqId });
      emittedMessages.push({ type: "DIFF_TASKS", payload: [...internalTasks] });
    }
  };

  mockWorkerHandler({
    type: "ADD_TASK",
    reqId: "test-req-123",
    payload: { id: "1", name: "Site Clearing", duration: 5 }
  });

  const diffMsg = emittedMessages.find((m) => m.type === "DIFF_TASKS");
  expect(diffMsg).toBeDefined();

  if (diffMsg && diffMsg.type === "DIFF_TASKS") {
    expect(typeof diffMsg.payload).not.toBe("string");
    expect(Array.isArray(diffMsg.payload)).toBe(true);
    expect(diffMsg.payload[0].name).toBe("Site Clearing");
  }
});