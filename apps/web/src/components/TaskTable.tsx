import type { ScheduleResultMap, Task } from "protocol";
import type { CSSProperties } from "react";
import { useVirtualWindow } from "../hooks/useVirtualWindow";
import { projectDateShort } from "../utils/dateProjection";
import { EditableCell } from "./EditableCell";
import { ROW_HEIGHT, TIMESCALE_HEIGHT } from "./gantt/ganttConstants";

interface TaskTableProps {
  tasks: Task[];
  scheduleResults: ScheduleResultMap;
  onUpdateTask: (taskId: string, updates: { name?: string; duration?: number }) => void;
  scrollTop: number;
  viewportHeight: number;
  projectStartDate: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  collapsedIds: ReadonlySet<string>;
  onToggleCollapse: (taskId: string) => void;
}

/**
 * Virtualized table view of tasks with schedule data.
 * Only renders rows inside the visible window + overscan.
 * Vertical scrolling is owned by a shared scroll track in App;
 * this component positions its visible slice via translateY.
 */
export function TaskTable({
  tasks,
  scheduleResults,
  onUpdateTask,
  scrollTop,
  viewportHeight,
  projectStartDate,
  selectedTaskId,
  onSelectTask,
  collapsedIds,
  onToggleCollapse,
}: TaskTableProps) {
  const { startIndex, endIndex, offsetY, totalHeight } = useVirtualWindow(
    tasks.length,
    ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  );

  const visibleTasks = endIndex >= startIndex
    ? tasks.slice(startIndex, endIndex + 1)
    : [];

  return (
    <div style={{ width: 400, borderRight: "1px solid #ccc", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Fixed header */}
      <table style={{ width: "100%", borderCollapse: "collapse", flexShrink: 0 }}>
        <thead>
          <tr style={{ height: TIMESCALE_HEIGHT, background: "#f5f5f5" }}>
            <th style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #ccc" }}>
              Task
            </th>
            <th style={{ padding: 8, textAlign: "center", borderBottom: "1px solid #ccc" }}>
              Duration
            </th>
            <th style={{ padding: 8, textAlign: "center", borderBottom: "1px solid #ccc" }}>
              Start
            </th>
            <th style={{ padding: 8, textAlign: "center", borderBottom: "1px solid #ccc" }}>
              Finish
            </th>
            <th style={{ padding: 8, textAlign: "center", borderBottom: "1px solid #ccc" }}>
              TF
            </th>
          </tr>
        </thead>
      </table>

      {/* Clipped body viewport — vertical scroll owned by App's scroll track */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          minHeight: 0,
          position: "relative",
        }}
      >
        {/* Phantom spacer — sets scrollable content height */}
        <div style={{ height: totalHeight, position: "relative" }}>
          {/* Translated visible-slice wrapper */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              position: "absolute",
              top: 0,
              left: 0,
              transform: `translateY(${offsetY}px)`,
            }}
          >
            <tbody>
              {visibleTasks.map((task) => {
                const schedule = scheduleResults[task.id];
                const isSelected = task.id === selectedTaskId;

                const rowBg = isSelected
                  ? "#bbdefb"
                  : schedule?.isCritical
                    ? "#ffebee"
                    : "#ffffff";

                const cellBase: CSSProperties = {
                  height: ROW_HEIGHT,
                  boxSizing: "border-box",
                  padding: "0 8px",
                  overflow: "hidden",
                  borderBottom: "1px solid #e0e0e0",
                  background: rowBg,
                  verticalAlign: "middle",
                };

                const cellContentBase: CSSProperties = {
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.2,
                  boxSizing: "border-box",
                };

                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    style={{
                      height: ROW_HEIGHT,
                      background: rowBg,
                      cursor: "pointer",
                    }}
                  >
                    <td style={cellBase}>
                      <div style={{ ...cellContentBase, paddingLeft: task.depth * 20 }}>
                        {task.isSummary && (
                          <span
                            onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
                            style={{ cursor: "pointer", marginRight: 4, userSelect: "none", fontSize: 12 }}
                          >
                            {collapsedIds.has(task.id) ? "▶" : "▼"}
                          </span>
                        )}
                        <EditableCell
                          value={task.name}
                          onCommit={(v) => onUpdateTask(task.id, { name: v })}
                        >
                          <strong style={task.isSummary ? { fontStyle: "italic" } : undefined}>{task.name}</strong>
                          {schedule?.isCritical && (
                            <span
                              style={{
                                marginLeft: 8,
                                color: "#d32f2f",
                                fontSize: 12,
                                fontWeight: "bold",
                                flexShrink: 0,
                              }}
                            >
                              CRITICAL
                            </span>
                          )}
                        </EditableCell>
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", gap: 4 }}>
                        {task.isSummary ? (
                          <span style={{ color: "#999" }}>—</span>
                        ) : (
                        <EditableCell
                          value={String(task.duration)}
                          onCommit={(v) => {
                            const n = Number(v);
                            if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) return;
                            onUpdateTask(task.id, { duration: n });
                          }}
                        >
                          <span>{task.duration}d</span>
                        </EditableCell>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {schedule ? projectDateShort(projectStartDate, schedule.earlyStart) : "—"}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {schedule ? projectDateShort(projectStartDate, schedule.earlyFinish) : "—"}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center" }}>
                        {schedule?.totalFloat ?? "—"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
