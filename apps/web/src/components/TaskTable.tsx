import type { ConstraintType, DiagnosticsMap, ScheduleResultMap, VarianceMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { useVirtualWindow } from "../hooks/useVirtualWindow";
import { HEADER_METRICS } from "../ui/config/themeConfig";
import { useDensityMetrics } from "../ui/store/uiStore";
import { formatDateISO, projectDate, projectDateShort } from "../utils/dateProjection";
import { EditableCell } from "./EditableCell";
import { WBS_BAND_FIELD_WIDTH, WBS_BAND_STEP } from "./hierarchyLayout";
import { buildAllDiags, highestSeverity } from "./TaskDetailsPanel";
import { buildHierarchyRenderMeta, type RowHierarchyRenderMeta } from "./taskHierarchyRenderMeta";
import { TaskTableHierarchyOverlay } from "./TaskTableHierarchyOverlay";

export type ColumnTier = "A" | "B" | "C";

export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly title: string | undefined;
  readonly width: number;
  readonly align: "left" | "center" | "right";
  readonly tier: ColumnTier;
}

export const COLUMN_SCHEMA: readonly ColumnDef[] = [
  // Structural WBS band field — render-layer only, carries no data
  { key: "wbs",      label: "",       title: "WBS Structure",     width: WBS_BAND_FIELD_WIDTH, align: "left", tier: "A" },
  // Tier A — Primary identity / planning
  { key: "id",       label: "Act ID", title: "Activity ID",       width: 92,  align: "left",   tier: "A" },
  { key: "task",     label: "Desc",   title: "Activity Description", width: 254, align: "left", tier: "A" },
  { key: "duration", label: "Dur",    title: "Duration",          width: 60,  align: "right",  tier: "A" },
  { key: "start",    label: "Start",  title: undefined,           width: 88,  align: "center", tier: "A" },
  { key: "finish",   label: "Finish", title: undefined,           width: 88,  align: "center", tier: "A" },
  // Tier B — Logic / control
  { key: "tf",       label: "TF",     title: "Total Float",       width: 50,  align: "right",  tier: "B" },
  { key: "ct",       label: "Con",    title: "Constraint",        width: 60,  align: "center", tier: "B" },
  { key: "cd",       label: "CDate",  title: "Constraint Date",   width: 68,  align: "center", tier: "B" },
  // Tier C — Variance / secondary
  { key: "sv",       label: "SV",     title: "Start Variance",    width: 50,  align: "right",  tier: "C" },
  { key: "fv",       label: "FV",     title: "Finish Variance",   width: 50,  align: "right",  tier: "C" },
  { key: "dv",       label: "DV",     title: "Duration Variance", width: 50,  align: "right",  tier: "C" },
] as const;

export const TABLE_WIDTH = COLUMN_SCHEMA.reduce((sum, c) => sum + c.width, 0);
// Overlay spans only the dedicated WBS band column (column 0).
const IDENTITY_OVERLAY_WIDTH = WBS_BAND_FIELD_WIDTH;

// Summary header left-gutter composition (render-layer only).
const SUMMARY_LEFT_INSET = 6;
const SUMMARY_TOGGLE_SLOT_WIDTH = 14;
const SUMMARY_TEXT_GAP = 6;

interface TaskTableProps {
  tasks: VisibleRow[];
  scheduleResults: ScheduleResultMap;
  variances: VarianceMap;
  diagnosticsMap?: DiagnosticsMap;
  onUpdateTask: (taskId: string, updates: { name?: string; durationWorkMinutes?: WorkMinutes; constraintType?: ConstraintType; constraintDateMinutes?: WorkMinutes | null }) => void;
  scrollTop: number;
  viewportHeight: number;
  projectStartDate: string;
  selectedTaskId: string | null;
  selectedTaskIds?: string[];
  onSelectTask: (taskId: string, multi: boolean) => void;
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
  selectedTaskIds,
  onSelectTask,
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

  // Build hierarchy metadata from the full visible-row list before virtual slicing.
  const hierarchyMeta = useMemo(() => buildHierarchyRenderMeta(tasks), [tasks]);
  const showHierarchyDebugOverlay =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("hierarchyDebug") === "1";

  const visibleTasks = endIndex >= startIndex
    ? tasks.slice(startIndex, endIndex + 1)
    : [];
  const visibleHierarchyMeta = endIndex >= startIndex
    ? hierarchyMeta.slice(startIndex, endIndex + 1)
    : [];

  const renderRowOwnedWbsBands = (task: VisibleRow, rowMeta: RowHierarchyRenderMeta | undefined) => {
    const laneSegments = rowMeta?.laneSegments ?? [];
    if (laneSegments.length === 0) return null;

    return (
      <div className="task-wbs-row-paint" aria-hidden="true">
        {laneSegments.map((segment) => {
          const x = segment.laneIndex * WBS_BAND_STEP;
          const isSelfSummaryBand = task.isSummary && segment.isSelfSummary;
          // Self-summary wall zone is owned by the WBS cell background (--branch-wall-fill).
          // Do not paint a separate stripe here — that would double-paint the corner.
          if (isSelfSummaryBand) return null;
          // Use the shared per-depth wall token so summary-row and activity-row
          // ancestor walls come from one recipe — no split ownership.
          const wallFill = `var(${segment.colorToken}-wall)`;
          const wallStyle: CSSProperties = {
            left: x,
            backgroundColor: wallFill,
          };
          return (
            <div key={`${task.id}-wbs-band-${segment.summaryId}`}>
              <span
                className="task-wbs-band-wall"
                style={wallStyle}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const colGroup = (
    <colgroup>
      {COLUMN_SCHEMA.map((c) => <col key={c.key} style={{ width: c.width, minWidth: c.width }} />)}
    </colgroup>
  );

  const thBase: CSSProperties = {
    height: HEADER_HEIGHT,
    padding: 0,
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    verticalAlign: "middle",
    fontSize: 12,
  };

  const thStyleFor = (col: ColumnDef): CSSProperties => ({
    ...thBase,
    textAlign: col.align,
    fontWeight: col.tier === "A" ? 600 : 500,
    color: col.tier === "C" ? "#78909c" : "#37474f",
  });

  const thContentStyleFor = (col: ColumnDef): CSSProperties => ({
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start",
    padding: "0 8px",
    boxSizing: "border-box",
  });

  return (
    /* Single scroll owner — overflowX:auto here, scrollbar pinned to pane bottom */
    <div style={{ width: "100%", borderRight: "1px solid #ccc", overflowX: "auto", overflowY: "hidden", minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Inner column at TABLE_WIDTH — single horizontal authority for header + body */}
      <div style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Fixed header — wrapper constrains total height to HEADER_HEIGHT (incl. border) */}
      <div className="task-table-header" style={{
        height: HEADER_HEIGHT,
        flexShrink: 0,
        borderBottom: '1px solid #ccc',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}>
      <table className="task-table-grid" style={{ width: TABLE_WIDTH, minWidth: TABLE_WIDTH, borderCollapse: "collapse", tableLayout: "fixed" }}>
        {colGroup}
        <thead>
          <tr style={{ height: HEADER_HEIGHT - HEADER_METRICS.borderBottom, background: "#f5f5f5" }}>
            {COLUMN_SCHEMA.map((c, i) => (
              <th
                key={i}
                style={thStyleFor(c)}
                title={c.title}
                className={`task-table-th task-table-th-align-${c.align} task-table-th-tier-${c.tier}`}
                data-col-key={c.key}
              >
                <div className="task-table-th-content" style={thContentStyleFor(c)}>
                  <span className="task-table-th-label">{c.label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
      </table>
      </div>

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
          {showHierarchyDebugOverlay && (
            <TaskTableHierarchyOverlay
              hierarchyMeta={hierarchyMeta}
              rowHeight={ROW_HEIGHT}
              startIndex={startIndex}
              endIndex={endIndex}
              offsetY={offsetY}
              overlayWidth={IDENTITY_OVERLAY_WIDTH}
            />
          )}
          {/* Translated visible-slice wrapper */}
          <table
            className="task-table-grid"
            style={{
              width: TABLE_WIDTH,
              minWidth: TABLE_WIDTH,
              borderCollapse: "collapse",
              tableLayout: "fixed",
              position: "absolute",
              top: 0,
              left: 0,
              transform: `translateY(${offsetY}px)`,
              zIndex: 1,
            }}
          >
            {colGroup}
            <tbody>
              {visibleTasks.map((task, vi) => {
                const schedule = scheduleResults[task.id];
                const variance = variances[task.id];
                const rowHierarchyMeta = visibleHierarchyMeta[vi];
                const depthLaneToken = `--hier-lane-${Math.min(task.depth, 4)}`;
                const selfSummaryLane = task.isSummary
                  ? rowHierarchyMeta?.laneSegments.find((segment) => segment.isSelfSummary)
                  : undefined;
                const selfLaneToken = selfSummaryLane?.colorToken ?? depthLaneToken;
                const summaryBranchPigment = `var(${selfLaneToken})`;
                const isSelected = selectedTaskIds
                  ? selectedTaskIds.includes(task.id)
                  : task.id === selectedTaskId;
                const earlyStartLabel = schedule ? projectDateShort(projectStartDate, schedule.earlyStartMinutes) : "—";
                const earlyFinishLabel = schedule ? projectDateShort(projectStartDate, schedule.earlyFinishMinutes) : "—";
                const earlyStartTitle = schedule ? formatDateISO(projectDate(projectStartDate, schedule.earlyStartMinutes)) : undefined;
                const earlyFinishTitle = schedule ? formatDateISO(projectDate(projectStartDate, schedule.earlyFinishMinutes)) : undefined;
                const constraintDateLabel = task.constraintDateMinutes != null
                  ? projectDateShort(projectStartDate, task.constraintDateMinutes)
                  : "";
                const constraintDateTitle = task.constraintDateMinutes != null
                  ? formatDateISO(projectDate(projectStartDate, task.constraintDateMinutes))
                  : undefined;
                const badge = constraintBadgeStyle(task.constraintType);
                const sev = highestSeverity(diagnosticsMap?.[task.id], task.constraintType);
                const diagTooltip = sev
                  ? buildAllDiags(diagnosticsMap?.[task.id] ?? [], task.constraintType ?? "ASAP")
                      .map((d) => d.message)
                      .join("\n")
                  : undefined;
                const activityIdText = task.activityCode ?? task.sourceActivityId ?? "";

                const cellBase: CSSProperties = {
                  height: ROW_HEIGHT,
                  boxSizing: "border-box",
                  padding: "0 8px",
                  overflow: "hidden",
                  borderBottom: "1px solid #e0e0e0",
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
                    className={`task-row ${task.isSummary ? "task-row-summary" : "task-row-leaf"}`}
                    data-wbs-depth={task.depth}
                    data-is-summary={task.isSummary}
                    data-selected={isSelected}
                    data-is-critical={!!schedule?.isCritical}
                    onClick={(e) => onSelectTask(task.id, e.ctrlKey || e.metaKey)}
                    style={{
                      height: ROW_HEIGHT,
                      cursor: "pointer",
                      ...(task.isSummary
                        ? {
                            "--summary-owner-color": summaryBranchPigment,
                            "--branch-wall-fill": `var(${selfLaneToken}-wall)`,
                            "--branch-roof-fill": `var(${selfLaneToken}-roof)`,
                            "--branch-edge": `var(${selfLaneToken}-wall)`,
                            "--summary-roof-fill": `var(--branch-roof-fill)`,
                            "--summary-self-lane-x": `${task.depth * WBS_BAND_STEP}px`,
                            "--summary-self-wall-end-x": `${task.depth * WBS_BAND_STEP + 8}px`,
                            "--summary-wbs-band-fill": `linear-gradient(to right, transparent 0, transparent var(--summary-self-lane-x), var(--branch-wall-fill) var(--summary-self-lane-x), var(--branch-wall-fill) var(--summary-self-wall-end-x), var(--branch-roof-fill) var(--summary-self-wall-end-x), var(--branch-roof-fill) 100%)`,
                            "--summary-wbs-field-width": `${WBS_BAND_FIELD_WIDTH}px`,
                            "--summary-left-inset": `${SUMMARY_LEFT_INSET}px`,
                            "--summary-toggle-slot-width": `${SUMMARY_TOGGLE_SLOT_WIDTH}px`,
                            "--summary-text-gap": `${SUMMARY_TEXT_GAP}px`,
                            "--summary-text-start-from-wbs-left": `${task.depth * WBS_BAND_STEP + SUMMARY_LEFT_INSET + SUMMARY_TOGGLE_SLOT_WIDTH + SUMMARY_TEXT_GAP}px`,
                            "--summary-toggle-left": `${task.depth * WBS_BAND_STEP + SUMMARY_LEFT_INSET}px`,
                          }
                        : {}),
                    } as CSSProperties}
                  >
                    {/* WBS band field cell — toggle lives here for summary rows; SVG overlay renders bands behind */}
                    <td
                      className="task-cell task-cell-wbs-band"
                      style={{
                        ...cellBase,
                        padding: 0,
                        overflow: "visible",
                        background: task.isSummary ? "var(--summary-wbs-band-fill, var(--branch-roof-fill))" : "transparent",
                        position: "relative",
                      }}
                      aria-hidden={!task.isSummary || !task.canExpand}
                    >
                      {renderRowOwnedWbsBands(task, rowHierarchyMeta)}
                      {task.isSummary && task.canExpand && (
                        <span
                          onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
                          className="task-toggle task-wbs-band-toggle"
                          style={{
                            position: "absolute",
                            top: "50%",
                            transform: "translateY(-50%)",
                            cursor: "pointer",
                            userSelect: "none",
                            fontSize: 10,
                            zIndex: 3,
                            lineHeight: 1,
                          }}
                        >
                          {task.isCollapsed ? "▶" : "▼"}
                        </span>
                      )}
                    </td>
                    {task.isSummary ? (
                      <td
                        colSpan={2}
                        style={{ ...cellBase, padding: 0 }}
                        className="task-cell task-cell-id task-cell-summary-tree"
                      >
                        <div className="task-summary-tree-stack" title={diagTooltip ?? task.name}>
                          <div className="task-summary-tree-label-row">
                            <div className="task-summary-tree-label-shell">
                              <EditableCell
                                value={task.name}
                                onCommit={(v) => onUpdateTask(task.id, { name: v })}
                              >
                                <strong className="task-name-text is-summary">{task.name}</strong>
                                {schedule?.isCritical && (
                                  <span
                                    className="task-critical-badge"
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
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td
                          style={{ ...cellBase, padding: "0 4px" }}
                          className="task-cell task-cell-id task-cell-activity-id task-cell-mono"
                        >
                          <div
                            className="task-activity-tree-row"
                            style={{
                              ...cellContentBase,
                              fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
                              fontSize: 11,
                              color: "#486275",
                            }}
                            title={diagTooltip ?? activityIdText}
                          >
                            <span className="task-activity-id-text">{activityIdText}</span>
                          </div>
                        </td>
                        <td
                          style={cellBase}
                          className="task-name-cell task-cell-name"
                        >
                          <div className="task-name-content is-leaf-row" style={cellContentBase} title={task.name}>
                            <EditableCell
                              value={task.name}
                              onCommit={(v) => onUpdateTask(task.id, { name: v })}
                            >
                              <strong className="task-name-text">{task.name}</strong>
                              {schedule?.isCritical && (
                                <span
                                  className="task-critical-badge"
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
                      </>
                    )}
                    <td style={{ ...cellBase, textAlign: "right" }} className="task-cell task-cell-duration task-cell-numeric">
                      <div style={{ ...cellContentBase, justifyContent: "flex-end", gap: 4 }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">{task.rollupDurationMinutes != null ? `${task.rollupDurationMinutes / MINUTES_PER_DAY}d` : "—"}</span>
                        ) : (
                        <EditableCell
                          value={String(task.durationWorkMinutes / MINUTES_PER_DAY)}
                          onCommit={(v) => {
                            const n = Number(v);
                            if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) return;
                            onUpdateTask(task.id, { durationWorkMinutes: (n * MINUTES_PER_DAY) as WorkMinutes });
                          }}
                        >
                          <span>{task.durationWorkMinutes / MINUTES_PER_DAY}d</span>
                        </EditableCell>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }} className="task-cell task-cell-date">
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly task-date-text" title={earlyStartTitle}>{earlyStartLabel}</span>
                        ) : (
                          <span className="task-date-text" title={earlyStartTitle}>{earlyStartLabel}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }} className="task-cell task-cell-date">
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly task-date-text" title={earlyFinishTitle}>{earlyFinishLabel}</span>
                        ) : (
                          <span className="task-date-text" title={earlyFinishTitle}>{earlyFinishLabel}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "right" }} className="task-cell task-cell-float task-cell-numeric">
                      <div style={{ ...cellContentBase, justifyContent: "flex-end" }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">{schedule?.totalFloatMinutes ?? "—"}</span>
                        ) : (
                          <span>{schedule?.totalFloatMinutes ?? "—"}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "center" }} className="task-cell task-cell-constraint">
                      <div style={{ ...cellContentBase, justifyContent: "center" }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">—</span>
                        ) : (
                          <select
                            value={task.constraintType ?? "ASAP"}
                            onChange={(e) => {
                              const ct = e.target.value as ConstraintType;
                              const isDated = ct === "SNET" || ct === "FNLT" || ct === "MSO" || ct === "MFO";
                              onUpdateTask(task.id, {
                                constraintType: ct,
                                ...(!isDated ? { constraintDateMinutes: null } : {}),
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="task-constraint-select"
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
                    <td style={{ ...cellBase, textAlign: "center" }} className="task-cell task-cell-date task-cell-constraint-date">
                      <div style={{ ...cellContentBase, justifyContent: "center", fontSize: "0.85em" }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">—</span>
                        ) : (task.constraintType && task.constraintType !== "ASAP" && task.constraintType !== "ALAP") ? (
                          <EditableCell
                            value={String(task.constraintDateMinutes != null ? task.constraintDateMinutes / MINUTES_PER_DAY : "")}
                            onCommit={(v) => {
                              const n = Number(v);
                              if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return;
                              onUpdateTask(task.id, { constraintDateMinutes: (n * MINUTES_PER_DAY) as WorkMinutes });
                            }}
                          >
                            <span className="task-date-text" title={constraintDateTitle}>{constraintDateLabel}</span>
                          </EditableCell>
                        ) : (
                          <span style={{ color: "#999" }}>—</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "right" }} className="task-cell task-cell-variance task-cell-numeric">
                      <div style={{ ...cellContentBase, justifyContent: "flex-end", ...(task.isSummary ? {} : variance ? varianceStyle(variance.startVarianceMinutes) : {}) }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">{variance ? variance.startVarianceMinutes : "—"}</span>
                        ) : (
                          <span>{variance ? variance.startVarianceMinutes : "—"}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "right" }} className="task-cell task-cell-variance task-cell-numeric">
                      <div style={{ ...cellContentBase, justifyContent: "flex-end", ...(task.isSummary ? {} : variance ? varianceStyle(variance.finishVarianceMinutes) : {}) }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">{variance ? variance.finishVarianceMinutes : "—"}</span>
                        ) : (
                          <span>{variance ? variance.finishVarianceMinutes : "—"}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...cellBase, textAlign: "right" }} className="task-cell task-cell-variance task-cell-numeric">
                      <div style={{ ...cellContentBase, justifyContent: "flex-end", ...(task.isSummary ? {} : variance ? varianceStyle(variance.durationVarianceMinutes) : {}) }}>
                        {task.isSummary ? (
                          <span className="task-cell-readonly">{variance ? variance.durationVarianceMinutes : "—"}</span>
                        ) : (
                          <span>{variance ? variance.durationVarianceMinutes : "—"}</span>
                        )}
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
