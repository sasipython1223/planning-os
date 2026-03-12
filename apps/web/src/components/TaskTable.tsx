import type { ScheduleResultMap, Task, VarianceMap } from "protocol";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { useVirtualWindow } from "../hooks/useVirtualWindow";
import { projectDateShort } from "../utils/dateProjection";
import { EditableCell } from "./EditableCell";
import { ROW_HEIGHT, TIMESCALE_HEIGHT } from "./gantt/ganttConstants";

export const COLUMN_SCHEMA = [
  { key: "task",     label: "Task",   title: undefined,           width: 220, align: "left" as const },
  { key: "duration", label: "Dur",    title: "Duration",          width: 70,  align: "center" as const },
  { key: "start",    label: "Start",  title: undefined,           width: 95,  align: "center" as const },
  { key: "finish",   label: "Finish", title: undefined,           width: 95,  align: "center" as const },
  { key: "tf",       label: "TF",     title: "Total Float",       width: 55,  align: "center" as const },
  { key: "sv",       label: "SV",     title: "Start Variance",    width: 55,  align: "center" as const },
  { key: "fv",       label: "FV",     title: "Finish Variance",   width: 55,  align: "center" as const },
  { key: "dv",       label: "DV",     title: "Duration Variance", width: 55,  align: "center" as const },
] as const;

export const TABLE_WIDTH = COLUMN_SCHEMA.reduce((sum, c) => sum + c.width, 0);

interface TaskTableProps {
  tasks: Task[];
  scheduleResults: ScheduleResultMap;
  variances: VarianceMap;
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
function varianceStyle(value: number): CSSProperties {
  if (value > 0) return { color: "#d32f2f" };
  if (value < 0) return { color: "#2e7d32" };
  return {};
}

export function TaskTable({
  tasks,
  scheduleResults,
  variances,
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

  const bodyRef = useRef<HTMLDivElement>(null);

  // Mirror shared scrollTop into the clipped body viewport so
  // translateY(offsetY) lands inside the visible clip region.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  const visibleTasks = endIndex >= startIndex
    ? tasks.slice(startIndex, endIndex + 1)
    : [];

  const colGroup = (
    <colgroup>
      {COLUMN_SCHEMA.map((c) => <col key={c.key} style={{ width: c.width, minWidth: c.width }} />)}
    </colgroup>
  );

  const thBase: CSSProperties = {
    height: TIMESCALE_HEIGHT,
    padding: "0 4px",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    verticalAlign: "middle",
    lineHeight: `${TIMESCALE_HEIGHT}px`,
  };
  const thStyle: CSSProperties = { ...thBase, textAlign: "left" };
  const thCenterStyle: CSSProperties = { ...thBase, textAlign: "center" };

  return (
    <div style={{ width: 400, borderRight: "1px solid #ccc", overflowX: "auto", overflowY: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Inner wrapper at TABLE_WIDTH — single horizontal authority for header + body */}
      <div style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Fixed header */}
      <table className="task-table-header" style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, borderCollapse: "collapse", tableLayout: "fixed", flexShrink: 0 }}>
        {colGroup}
        <thead>
          <tr style={{ height: TIMESCALE_HEIGHT, background: "#f5f5f5" }}>
            {COLUMN_SCHEMA.map((c, i) => (
              <th key={i} style={c.align === "left" ? thStyle : thCenterStyle} title={c.title}>{c.label}</th>
            ))}
          </tr>
        </thead>
      </table>

      {/* Clipped body viewport — vertical scroll owned by App's scroll track */}
      <div
        ref={bodyRef}
        className="task-table-body"
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
              width: TABLE_WIDTH,
              minWidth: TABLE_WIDTH,
              borderCollapse: "collapse",
              tableLayout: "fixed",
              position: "absolute",
              top: 0,
              left: 0,
              transform: `translateY(${offsetY}px)`,
            }}
          >
            {colGroup}
            <tbody>
              {visibleTasks.map((task) => {
                const schedule = scheduleResults[task.id];
                const variance = variances[task.id];
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
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", ...( variance ? varianceStyle(variance.startVariance) : {}) }}>
                        {variance ? variance.startVariance : "—"}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", ...(variance ? varianceStyle(variance.finishVariance) : {}) }}>
                        {variance ? variance.finishVariance : "—"}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", ...(variance ? varianceStyle(variance.durationVariance) : {}) }}>
                        {variance ? variance.durationVariance : "—"}
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
    </div>
  );
}
