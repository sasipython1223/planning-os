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
  { key: "activityId", label: "Act ID", title: "Activity ID",     width: 110, align: "left" as const },
  { key: "task",     label: "Act Nm", title: "Activity Name",     width: 220, align: "left" as const },
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
export const TASK_TABLE_INDENT_WIDTH = 20;
export const TASK_TABLE_MAX_INDENT_DEPTH = 12;
// R5B — left accent strip width for the WBS ownership band.
// A single narrow strip is rendered at the left edge of the task cell.
// Its colour is the active WBS level's marker colour for the row.
// The strip sits inside the cell's existing 8px left padding so it never
// overlays the task-name text, preserving full readability.
export const WBS_LEFT_BAND_WIDTH = 6;
// R5B — inline depth marker pill dimensions for WBS summary rows.
// The pill is rendered in the content flow, before the task name — it does not
// use absolute positioning and cannot overlay text.
export const WBS_MARKER_PILL_WIDTH = 4;
export const WBS_MARKER_PILL_HEIGHT = 18;
// R5B — WBS Banding / Visual Grouping
// Depth-indexed background tints for WBS summary rows (one per depth level).
// Each entry is a subtle hue tint matching the corresponding marker colour.
// The last entry is used for all depths beyond the array length.
export const WBS_BAND_COLORS = [
  "#eef4fb", // depth 0 — faint steel-blue (project root)
  "#edf7f1", // depth 1 — faint green (major phase)
  "#fdf2e9", // depth 2 — faint amber (sub-phase)
  "#f5eef8", // depth 3+ — faint plum (deliverable / deeper)
] as const;

// Depth-indexed left-marker colours for WBS summary rows.
// Distinct professional hues — one per WBS nesting level.
export const WBS_MARKER_COLORS = [
  "#2471a3", // depth 0 — steel blue  (project root)
  "#1e8449", // depth 1 — forest green (major phase)
  "#ca6f1e", // depth 2 — burnt amber  (sub-phase)
  "#7d3c98", // depth 3+ — plum        (deliverable / deeper)
] as const;

/**
 * Pure display helper: returns the WBS band background colour for a summary row.
 * Depth-based for visual differentiation of nested WBS levels.
 * Safe fallback to the depth-2 colour when depth is missing or invalid.
 * R5B — WBS Banding / Visual Grouping
 */
export function getWbsBandColor(depth: number | null | undefined): string {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return WBS_BAND_COLORS[2]; // safe fallback
  }
  const safeDepth = Math.min(Math.floor(depth), WBS_BAND_COLORS.length - 1);
  return WBS_BAND_COLORS[safeDepth];
}

/**
 * Pure display helper: returns the WBS left-marker colour for a summary row.
 * Depth-based to visually distinguish WBS nesting level.
 * Safe fallback to the depth-2 colour when depth is missing or invalid.
 * R5B — WBS Banding / Visual Grouping
 */
export function getWbsMarkerColor(depth: number | null | undefined): string {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return WBS_MARKER_COLORS[2]; // safe fallback (matches R5A default)
  }
  const safeDepth = Math.min(Math.floor(depth), WBS_MARKER_COLORS.length - 1);
  return WBS_MARKER_COLORS[safeDepth];
}

/**
 * Pure display helper: returns an array of WBS marker colours for levels 0..depth.
 * Used internally to build continuous branch-level bands.
 * Safe fallback to a single root-level bar when depth is missing or invalid.
 * R5B — WBS Banding / Visual Grouping
 */
export function getWbsDepthMarkerColors(depth: number | null | undefined): readonly string[] {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return [WBS_MARKER_COLORS[0]]; // safe fallback: show one root-level bar
  }
  const safeDepth = Math.min(Math.floor(depth), WBS_MARKER_COLORS.length - 1);
  return WBS_MARKER_COLORS.slice(0, safeDepth + 1);
}

/**
 * Pure display helper: returns the WBS ancestry band colours to render for a row.
 * Enables continuous P6-style branch-level banding — every row in a WBS branch
 * shows the bands of its owning WBS levels, not just the summary row itself.
 *
 * - Summary row at depth D: returns D+1 colours (levels 0..D, including own level).
 * - Activity row at depth D: returns D colours (levels 0..D-1, the parent WBS levels).
 * - Depth 0 activity: returns [] — no parent WBS band to show.
 *
 * Safe fallbacks: invalid/missing depth returns [] for activities, [level-0 colour] for summaries.
 * R5B — WBS Banding / Visual Grouping
 */
export function getWbsAncestorBandColors(
  depth: number | null | undefined,
  isSummary: boolean,
): readonly string[] {
  if (!isSummary) {
    // Activity rows: show only the parent WBS levels (0..depth-1)
    if (typeof depth !== "number" || !Number.isFinite(depth) || depth <= 0) {
      return []; // top-level activity or invalid → no WBS bands
    }
    return getWbsDepthMarkerColors(depth - 1);
  }
  // Summary rows: show own WBS level and all ancestor levels (0..depth)
  return getWbsDepthMarkerColors(depth);
}

/**
 * Pure display helper: returns the single active WBS ownership band colour for a row.
 * - Summary at depth D → own WBS level marker colour.
 * - Activity at depth D > 0 → parent WBS level marker colour (depth D−1).
 * - Activity at depth 0 or invalid → null (no band rendered).
 *
 * Replaces the multi-band getWbsAncestorBandColors approach in rendering.
 * A single strip at WBS_LEFT_BAND_WIDTH sits inside the cell's existing padding
 * and never overlays task-name text.
 * R5B — WBS Banding / Visual Grouping
 */
export function getWbsActiveBandColor(
  depth: number | null | undefined,
  isSummary: boolean,
): string | null {
  if (!isSummary) {
    // Activity: use parent WBS level colour; no band for top-level activities
    if (typeof depth !== "number" || !Number.isFinite(depth) || depth <= 0) {
      return null;
    }
    return getWbsMarkerColor(depth - 1);
  }
  // Summary: use own WBS level colour
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return getWbsMarkerColor(0); // safe fallback to root colour
  }
  return getWbsMarkerColor(depth);
}

type WorkerTaskUpdate = {
  name?: string;
  duration?: number;
  constraintType?: ConstraintType;
  constraintDate?: number | null;
};

type DisplayFloatFields = {
  totalFloat?: number;
  totalFloatMinutes?: number;
  totalFloatWorkdays?: number;
  freeFloat?: number;
  freeFloatMinutes?: number;
  freeFloatWorkdays?: number;
};

export function toWorkerTaskUpdate(updates: WorkerTaskUpdate & DisplayFloatFields): WorkerTaskUpdate {
  return {
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.duration !== undefined ? { duration: updates.duration } : {}),
    ...(updates.constraintType !== undefined ? { constraintType: updates.constraintType } : {}),
    ...(updates.constraintDate !== undefined ? { constraintDate: updates.constraintDate } : {}),
  };
}

type ScheduleDisplayResult = ScheduleResultMap[string] & DisplayFloatFields;

export function getDisplayTotalFloat(schedule: ScheduleDisplayResult | undefined): number | string {
  if (!schedule) return "—";
  if (typeof schedule.totalFloatWorkdays === "number" && Number.isFinite(schedule.totalFloatWorkdays)) {
    return schedule.totalFloatWorkdays;
  }
  return schedule.totalFloat;
}

export function getTaskIndentPx(depth: number | null | undefined): number {
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 0;
  const safeDepth = Math.min(Math.max(Math.floor(depth), 0), TASK_TABLE_MAX_INDENT_DEPTH);
  return safeDepth * TASK_TABLE_INDENT_WIDTH;
}

export function getTaskRowKind(task: Pick<Task, "isSummary">): "summary" | "activity" {
  return task.isSummary ? "summary" : "activity";
}

export function getDisplayActivityId(task: Pick<Task, "isSummary" | "activityId">): string {
  if (task.isSummary) return "—";
  const activityId = task.activityId?.trim();
  return activityId ? activityId : "—";
}

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
  onUpdateTask: (taskId: string, updates: WorkerTaskUpdate) => void;
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
  const summaryBadgeStyle: CSSProperties = {
    marginLeft: 7,
    padding: "1px 5px",
    border: "1px solid #bed0e3",
    borderRadius: 4,
    background: "#f7fbff",
    color: "#456a8d",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.05em",
    lineHeight: 1.3,
    flexShrink: 0,
  };
  const toggleStyle: CSSProperties = {
    width: 14,
    marginRight: 5,
    flexShrink: 0,
    cursor: "pointer",
    color: "#315f8d",
    fontSize: 11,
    lineHeight: 1,
    userSelect: "none",
  };

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
                const schedule = scheduleResults[task.id] as ScheduleDisplayResult | undefined;
                const variance = variances[task.id];
                const isSelected = task.id === selectedTaskId;
                const rowKind = getTaskRowKind(task);
                const isSummaryRow = rowKind === "summary";
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
                  : isSummaryRow
                    ? getWbsBandColor(task.depth)
                    : schedule?.isCritical
                      ? "#ffebee"
                      : typeof task.depth === "number" && task.depth > 0
                        ? getWbsBandColor(task.depth - 1) // activity inherits parent WBS tint
                        : "#ffffff";

                const cellBase: CSSProperties = {
                  height: ROW_HEIGHT,
                  boxSizing: "border-box",
                  padding: "0 8px",
                  overflow: "hidden",
                  borderBottom: isSummaryRow ? "1px solid #c8d5e4" : "1px solid #e0e0e0",
                  borderTop: isSummaryRow ? "1px solid #d8e2ee" : undefined,
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
                const taskLabelStyle: CSSProperties = isSummaryRow
                  ? { color: "#1e3a5f", fontStyle: "normal", fontWeight: 700, letterSpacing: "0.01em" }
                  : { color: "#26394d", fontWeight: 500 };

                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    style={{
                      height: ROW_HEIGHT,
                      background: rowBg,
                      color: isSummaryRow ? "#1e3a5f" : undefined,
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
                      <div style={{ ...cellContentBase, justifyContent: "flex-start", color: task.isSummary ? "#999" : "#2d465e", fontSize: "0.86em" }}>
                        {getDisplayActivityId(task)}
                      </div>
                    </td>
                    <td style={cellBase}>
                      <div style={{ ...cellContentBase, paddingLeft: getTaskIndentPx(task.depth), minWidth: 0 }}>
                        {task.isSummary && (
                          <span
                            onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
                            style={toggleStyle}
                            title={collapsedIds.has(task.id) ? "Expand summary row" : "Collapse summary row"}
                          >
                            {collapsedIds.has(task.id) ? "▶" : "▼"}
                          </span>
                        )}
                        {/* R5B — depth-indexed WBS ownership marker.
                            Inline coloured pill on WBS summary rows; colour changes by depth
                            (multi-hue: blue → green → amber → plum) so each WBS nesting level
                            has a distinct hue. Activity rows inherit the parent WBS tint via
                            rowBg so they feel visually inside the owning WBS container.
                            No absolute-positioned overlays — text is never obscured. */}
                        {isSummaryRow && (
                          <span
                            aria-hidden="true"
                            style={{
                              width: WBS_MARKER_PILL_WIDTH,
                              height: WBS_MARKER_PILL_HEIGHT,
                              marginRight: 6,
                              borderRadius: 2,
                              background: getWbsMarkerColor(task.depth),
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <EditableCell
                          value={task.name}
                          onCommit={(v) => onUpdateTask(task.id, toWorkerTaskUpdate({ name: v }))}
                        >
                          <strong style={taskLabelStyle}>{task.name}</strong>
                          {isSummaryRow && <span style={summaryBadgeStyle}>WBS</span>}
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
                            onUpdateTask(task.id, toWorkerTaskUpdate({ duration: n }));
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
                        {getDisplayTotalFloat(schedule)}
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
                              onUpdateTask(task.id, toWorkerTaskUpdate({
                                constraintType: ct,
                                ...(!isDated ? { constraintDate: null } : {}),
                              }));
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
                              onUpdateTask(task.id, toWorkerTaskUpdate({ constraintDate: n }));
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
