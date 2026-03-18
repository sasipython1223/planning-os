import type { ConstraintType, DiagnosticSeverity, DiagnosticsMap, ScheduleResultMap, Task, VarianceMap } from "protocol";
import { useRef, type CSSProperties, type RefObject } from "react";
import { useVirtualWindow } from "../hooks/useVirtualWindow";
import { HEADER_METRICS } from "../ui/config/themeConfig";
import { useDensityMetrics } from "../ui/store/uiStore";
import { projectDateShort } from "../utils/dateProjection";
import { EditableCell } from "./EditableCell";
import { buildAllDiags, highestSeverity } from "./TaskDetailsPanel";

export const COLUMN_SCHEMA = [
  { key: "diag",    label: "\u2691",  title: "Diagnostics",       width: 28,  align: "center" as const },
  { key: "task",     label: "Task",   title: undefined,           width: 220, align: "left" as const },
  { key: "duration", label: "Dur",    title: "Duration",          width: 70,  align: "center" as const },
  { key: "start",    label: "Start",  title: undefined,           width: 95,  align: "center" as const },
  { key: "finish",   label: "Finish", title: undefined,           width: 95,  align: "center" as const },
  { key: "tf",       label: "TF",     title: "Total Float",       width: 55,  align: "center" as const },
  { key: "ct",       label: "Con",    title: "Constraint",        width: 70,  align: "center" as const },
  { key: "cd",       label: "CDate",  title: "Constraint Date",   width: 70,  align: "center" as const },
  { key: "sv",       label: "SV",     title: "Start Variance",    width: 55,  align: "center" as const },
  { key: "fv",       label: "FV",     title: "Finish Variance",   width: 55,  align: "center" as const },
  { key: "dv",       label: "DV",     title: "Duration Variance", width: 55,  align: "center" as const },
] as const;

export const TABLE_WIDTH = COLUMN_SCHEMA.reduce((sum, c) => sum + c.width, 0);

const SEVERITY_ICON: Record<DiagnosticSeverity, { symbol: string; color: string }> = {
  error:   { symbol: "●", color: "#c62828" },
  warning: { symbol: "●", color: "#ef6c00" },
  info:    { symbol: "●", color: "#9e9e9e" },
};

interface TaskTableProps {
  tasks: Task[];
  scheduleResults: ScheduleResultMap;
  variances: VarianceMap;
  diagnosticsMap?: DiagnosticsMap;
  onUpdateTask: (taskId: string, updates: { name?: string; duration?: number; constraintType?: ConstraintType; constraintDate?: number | null }) => void;
  scrollTop: number;
  viewportHeight: number;
  projectStartDate: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  collapsedIds: ReadonlySet<string>;
  onToggleCollapse: (taskId: string) => void;
  bodyRef?: RefObject<HTMLDivElement | null>;
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

/** Returns badge style for non-ASAP constraint types; null for ASAP/undefined (quiet). */
export function constraintBadgeStyle(ct: ConstraintType | undefined): { label: string; color: string; bg: string } | null {
  if (!ct || ct === "ASAP") return null;
  if (ct === "MSO" || ct === "MFO") return { label: ct, color: "#e65100", bg: "#fff3e0" };
  if (ct === "ALAP") return { label: ct, color: "#37474f", bg: "#eceff1" };
  return { label: ct, color: "#1565c0", bg: "#e3f2fd" };
}

export function TaskTable({
  tasks,
  scheduleResults,
  variances,
  diagnosticsMap,
  onUpdateTask,
  scrollTop,
  viewportHeight,
  projectStartDate,
  selectedTaskId,
  onSelectTask,
  collapsedIds,
  onToggleCollapse,
  bodyRef: externalBodyRef,
}: TaskTableProps) {
  const { rowHeight: ROW_HEIGHT } = useDensityMetrics();
  const HEADER_HEIGHT = HEADER_METRICS.totalHeight;
  const { startIndex, endIndex, offsetY, totalHeight } = useVirtualWindow(
    tasks.length,
    ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  );

  const internalBodyRef = useRef<HTMLDivElement>(null);
  const bodyRef = externalBodyRef ?? internalBodyRef;

  const visibleTasks = endIndex >= startIndex
    ? tasks.slice(startIndex, endIndex + 1)
    : [];

  const colGroup = (
    <colgroup>
      {COLUMN_SCHEMA.map((c) => <col key={c.key} style={{ width: c.width, minWidth: c.width }} />)}
    </colgroup>
  );

  const thBase: CSSProperties = {
    height: HEADER_HEIGHT,
    padding: "0 4px",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    verticalAlign: "middle",
    lineHeight: `${HEADER_HEIGHT}px`,
    fontSize: 12,
  };
  const thStyle: CSSProperties = { ...thBase, textAlign: "left" };
  const thCenterStyle: CSSProperties = { ...thBase, textAlign: "center" };

  return (
    /* Single scroll owner — overflowX:auto here, scrollbar pinned to pane bottom */
    <div style={{ width: "100%", borderRight: "1px solid #ccc", overflowX: "auto", overflowY: "hidden", minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Inner column at TABLE_WIDTH — single horizontal authority for header + body */}
      <div style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Fixed header */}
      <table className="task-table-header" style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, borderCollapse: "collapse", tableLayout: "fixed", flexShrink: 0 }}>
        {colGroup}
        <thead>
          <tr style={{ height: HEADER_HEIGHT, background: "#f5f5f5", borderBottom: '1px solid #ccc' }}>
            {COLUMN_SCHEMA.map((c, i) => (
              <th key={i} style={c.align === "left" ? thStyle : thCenterStyle} title={c.title}>{c.label}</th>
            ))}
          </tr>
        </thead>
      </table>

      {/* Clipped body viewport — vertical scroll owned by App's phantom scroll track */}
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
                const badge = constraintBadgeStyle(task.constraintType);
                const sev = highestSeverity(diagnosticsMap?.[task.id], task.constraintType);
                const sevIcon = sev ? SEVERITY_ICON[sev] : null;
                const diagTooltip = sev
                  ? buildAllDiags(diagnosticsMap?.[task.id] ?? [], task.constraintType ?? "ASAP")
                      .map((d) => d.message)
                      .join("\n")
                  : undefined;

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
                    <td style={{ ...cellBase, padding: 0, textAlign: "center" }}>
                      {sevIcon && (
                        <span title={diagTooltip} style={{ color: sevIcon.color, fontSize: 12, cursor: "default" }}>
                          {sevIcon.symbol}
                        </span>
                      )}
                    </td>
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
                          {badge && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                color: badge.color,
                                background: badge.bg,
                                padding: "1px 4px",
                                borderRadius: 3,
                                flexShrink: 0,
                              }}
                            >
                              {badge.label}
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
                      <div style={{ ...cellContentBase, justifyContent: "center" }}>
                        {task.isSummary ? (
                          <span style={{ color: "#999" }}>—</span>
                        ) : (
                          <select
                            value={task.constraintType ?? "ASAP"}
                            onChange={(e) => {
                              const ct = e.target.value as ConstraintType;
                              const isDated = ct === "SNET" || ct === "FNLT" || ct === "MSO" || ct === "MFO";
                              onUpdateTask(task.id, {
                                constraintType: ct,
                                ...(!isDated ? { constraintDate: null } : {}),
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: "100%", fontSize: "0.8em", border: "none", background: "transparent", cursor: "pointer" }}
                          >
                            <option value="ASAP">ASAP</option>
                            <option value="ALAP">ALAP</option>
                            <option value="SNET">SNET</option>
                            <option value="FNLT">FNLT</option>
                            <option value="MSO">MSO</option>
                            <option value="MFO">MFO</option>
                          </select>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }}>
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {task.isSummary ? (
                          <span style={{ color: "#999" }}>—</span>
                        ) : (task.constraintType && task.constraintType !== "ASAP" && task.constraintType !== "ALAP") ? (
                          <EditableCell
                            value={String(task.constraintDate ?? "")}
                            onCommit={(v) => {
                              const n = Number(v);
                              if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return;
                              onUpdateTask(task.id, { constraintDate: n });
                            }}
                          >
                            <span>{task.constraintDate ?? ""}</span>
                          </EditableCell>
                        ) : (
                          <span style={{ color: "#999" }}>—</span>
                        )}
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
