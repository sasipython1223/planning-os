import type { Task, WorkerMessage } from "protocol";
import { useEffect, useMemo, useRef, useState } from "react";

function makeId() {
  return crypto.randomUUID();
}

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const [taskName, setTaskName] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../../packages/worker/worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;

      if (msg.type === "ACK") {
        setLogs((prev) => [`ACK ${msg.reqId}`, ...prev]);
      }

      if (msg.type === "DIFF_TASKS") {
        setTasks(msg.payload);
        setLogs((prev) => [`DIFF_TASKS ${msg.payload.length}`, ...prev]);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const canAdd = useMemo(() => taskName.trim().length > 0, [taskName]);

  const handleAdd = () => {
    const name = taskName.trim();
    if (!name || !workerRef.current) return;

    const task: Task = {
      id: makeId(),
      name,
      duration: 5
    };

    workerRef.current.postMessage({
      type: "ADD_TASK",
      reqId: makeId(),
      payload: task
    });

    setTaskName("");
  };

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Week 1 Worker Task Demo</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="Task name"
        />
        <button onClick={handleAdd} disabled={!canAdd}>
          Add
        </button>
      </div>

      <h2>Tasks</h2>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.name} ({task.duration}d)
          </li>
        ))}
      </ul>

      <h2>Worker Logs</h2>
      <ul>
        {logs.map((log, i) => (
          <li key={`${log}-${i}`}>{log}</li>
        ))}
      </ul>
    </div>
  );
}