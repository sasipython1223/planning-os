import type { Command, Dependency, Task, WorkerMessage } from "protocol";
import { expect, test } from "vitest";

test("Worker DIFF_STATE payload must be a structural object, NOT a JSON string", () => {
  const emittedMessages: WorkerMessage[] = [];
  let internalTasks: Task[] = [];
  let internalDeps: Dependency[] = [];

  const mockWorkerHandler = (cmd: Command) => {
    if (cmd.type === "ADD_TASK") {
      internalTasks.push(cmd.payload);

      emittedMessages.push({ type: "ACK", v: 1, reqId: cmd.reqId });
      emittedMessages.push({
        type: "DIFF_STATE",
        v: 1,
        payload: { tasks: [...internalTasks], dependencies: [...internalDeps], scheduleResults: {}, projectStartDate: "2026-01-01", nonWorkingDays: [] }
      });
    }
  };

  mockWorkerHandler({
    type: "ADD_TASK",
    v: 1,
    reqId: "test-req-123",
    payload: { id: "1", name: "Site Clearing", duration: 5, depth: 0, isSummary: false }
  });

  const diffMsg = emittedMessages.find((m) => m.type === "DIFF_STATE");
  expect(diffMsg).toBeDefined();

  if (diffMsg && diffMsg.type === "DIFF_STATE") {
    expect(typeof diffMsg.payload).not.toBe("string");
    expect(typeof diffMsg.payload).toBe("object");
    expect(Array.isArray(diffMsg.payload.tasks)).toBe(true);
    expect(Array.isArray(diffMsg.payload.dependencies)).toBe(true);
    expect(diffMsg.payload.tasks[0].name).toBe("Site Clearing");
  }
});