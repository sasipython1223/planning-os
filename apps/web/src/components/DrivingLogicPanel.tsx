/**
 * TD-TRACE.2B — Immediate Driving Logic read-only result panel.
 *
 * Displays driving predecessors, selected activity, and driven successors
 * derived from precomputed dependencyDiagnostics.isDriving.
 * Read-only. Does not mutate schedule, kernel, or WASM.
 */

import type { ImmediateDrivingLogicResult } from "../services/drivingLogic";

export type DrivingLogicTaskDisplay = {
  taskId: string;
  activityId?: string;
  name?: string;
};

type DrivingLogicPanelProps = {
  result: ImmediateDrivingLogicResult;
  taskLookup: Record<string, DrivingLogicTaskDisplay>;
  onClear: () => void;
};

function formatActivity(display: DrivingLogicTaskDisplay | undefined, fallbackId: string): string {
  if (!display) return fallbackId;
  const id = display.activityId?.trim() || fallbackId;
  return display.name ? `${id} — ${display.name}` : id;
}

function ActivityList({
  ids,
  taskLookup,
  emptyMessage,
}: {
  ids: string[];
  taskLookup: Record<string, DrivingLogicTaskDisplay>;
  emptyMessage: string;
}) {
  if (ids.length === 0) {
    return (
      <p style={{ margin: "4px 0 0 0", fontSize: "0.82em", color: "#888", fontStyle: "italic" }}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, fontSize: "0.85em" }}>
      {ids.map((id) => (
        <li key={id} style={{ marginBottom: 2 }}>
          {formatActivity(taskLookup[id], id)}
        </li>
      ))}
    </ul>
  );
}

export function DrivingLogicPanel({ result, taskLookup, onClear }: DrivingLogicPanelProps) {
  const hasAny =
    result.drivingPredecessorIds.length > 0 || result.drivenSuccessorIds.length > 0;

  return (
    <div
      style={{ padding: 12, fontFamily: "Arial, sans-serif", overflowY: "auto", height: "100%" }}
      data-testid="driving-logic-panel"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "1em" }}>Driving Logic</h3>
        <button
          onClick={onClear}
          style={{
            fontSize: "0.8em",
            padding: "3px 10px",
            cursor: "pointer",
            border: "1px solid #c8c8c8",
            borderRadius: 3,
            background: "#f5f5f5",
            color: "#333",
          }}
          aria-label="Clear driving logic trace"
        >
          Clear Trace
        </button>
      </div>

      <p style={{ margin: "0 0 10px 0", fontSize: "0.82em", color: "#555" }}>
        Immediate driving predecessors and driven successors based on worker-projected diagnostics.
        Relationships are included only when <code>isDriving === true</code>.
      </p>

      {!hasAny && (
        <p style={{ fontSize: "0.85em", color: "#888", fontStyle: "italic" }}>
          No immediate driving logic found for selected activity.
        </p>
      )}

      <section style={{ marginBottom: 12 }} aria-label="Driving Predecessors">
        <strong style={{ fontSize: "0.85em", color: "#444" }}>Driving Predecessors</strong>
        <ActivityList
          ids={result.drivingPredecessorIds}
          taskLookup={taskLookup}
          emptyMessage="No immediate driving predecessors found."
        />
      </section>

      <section style={{ marginBottom: 12 }} aria-label="Selected Activity">
        <strong style={{ fontSize: "0.85em", color: "#444" }}>Selected Activity</strong>
        <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, fontSize: "0.85em" }}>
          <li>{formatActivity(taskLookup[result.sourceTaskId], result.sourceTaskId)}</li>
        </ul>
      </section>

      <section aria-label="Driven Successors">
        <strong style={{ fontSize: "0.85em", color: "#444" }}>Driven Successors</strong>
        <ActivityList
          ids={result.drivenSuccessorIds}
          taskLookup={taskLookup}
          emptyMessage="No immediate driven successors found."
        />
      </section>
    </div>
  );
}
