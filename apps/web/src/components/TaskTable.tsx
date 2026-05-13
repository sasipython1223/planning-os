import type { ConstraintType, DiagnosticsMap, ScheduleResultMap, SourceImportFidelityState, SourceTaskActuals, SourceTaskProgress, VarianceMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useVirtualWindow } from "../hooks/useVirtualWindow";
import { HEADER_METRICS } from "../ui/config/themeConfig";
import { useDensityMetrics } from "../ui/store/uiStore";
import { DEFAULT_DATE_DISPLAY_FORMAT, formatDateISO, projectDate, projectDateFormatted, projectDateFromMinutesFormatted, type DateDisplayFormat } from "../utils/dateProjection";
import { EditableCell } from "./EditableCell";
import { WBS_BAND_FIELD_WIDTH, WBS_BAND_STEP } from "./hierarchyLayout";
import { buildAllDiags, highestSeverity } from "./TaskDetailsPanel";
import { buildHierarchyRenderMeta, type RowHierarchyRenderMeta } from "./taskHierarchyRenderMeta";
import { TaskTableHierarchyOverlay } from "./TaskTableHierarchyOverlay";

// ─── Column registry types ─────────────────────────────────────────────────

export type TaskColumnSource = "canonical" | "computed" | "imported" | "ui";

/**
 * Per-render context shared by all column renderCell functions.
 * rowMeta is injected per-row inside the body loop.
 */
export interface TaskTableContext {
  scheduleResults: ScheduleResultMap;
  variances: VarianceMap;
  diagnosticsMap?: DiagnosticsMap;
  onUpdateTask: (
    taskId: string,
    updates: {
      name?: string;
      durationWorkMinutes?: WorkMinutes;
      constraintType?: ConstraintType;
      constraintDateMinutes?: WorkMinutes | null;
    },
  ) => void;
  onToggleCollapse: (taskId: string) => void;
  projectStartDate: string;
  rowHeight: number;
  /** Hierarchy render metadata for the current row (set per-iteration in body loop). */
  rowMeta?: RowHierarchyRenderMeta;
  /** W4.4: Source actuals keyed by canonical task id (read-only, import sidecar). */
  sourceActuals?: Readonly<Record<string, SourceTaskActuals>>;
  /** W4.4: Source progress keyed by canonical task id (read-only, import sidecar). */
  sourceProgress?: Readonly<Record<string, SourceTaskProgress>>;
  /** W4.4.1: User-selected date display format. */
  dateDisplayFormat: DateDisplayFormat;
}

export interface TaskColumnDefinition {
  readonly id: string;
  readonly label: string;
  readonly title?: string;
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth?: number;
  readonly source: TaskColumnSource;
  readonly visibleByDefault: boolean;
  readonly align?: "left" | "center" | "right";
  /** Visual grouping tier used for header styling. */
  readonly tier?: "A" | "B" | "C";
  readonly editable?: boolean;
  readonly resizable?: boolean;
  /**
   * If present and returns true, skip rendering this td for the given row.
   * An adjacent column must cover the skipped space with getColSpan.
   */
  readonly skipRender?: (row: VisibleRow) => boolean;
  /**
   * Returns the td colSpan for a given row.
   * Receives the currently visible column list for accurate span counting.
   * Defaults to 1.
   */
  readonly getColSpan?: (
    row: VisibleRow,
    visibleColumns: readonly TaskColumnDefinition[],
  ) => number;
  /** Additional CSSProperties merged onto the td beyond the base cell style. */
  readonly tdStyle?: (row: VisibleRow) => CSSProperties;
  /** td className. Supports per-row function. Defaults to "task-cell". */
  readonly tdClassName?: string | ((row: VisibleRow) => string);
  /** aria-hidden for the td element. */
  readonly ariaHidden?: (row: VisibleRow) => boolean;
  /** Renders the td content. The td wrapper is managed by the body loop. */
  readonly renderCell: (row: VisibleRow, ctx: TaskTableContext) => ReactNode;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

// ─── Shared cell content style ─────────────────────────────────────────────

const CELL_CONTENT_BASE: CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  lineHeight: 1.2,
  boxSizing: "border-box",
};

// ─── Summary row layout constants ──────────────────────────────────────────

// Summary header left-gutter composition (render-layer only).
const SUMMARY_LEFT_INSET = 6;
const SUMMARY_TOGGLE_SLOT_WIDTH = 14;
const SUMMARY_TEXT_GAP = 6;

// ─── Inline badge helpers (shared by id + task renderCell) ─────────────────

function CriticalBadge() {
  return (
    <span
      className="task-critical-badge"
      style={{ marginLeft: 8, color: "#d32f2f", fontSize: 12, fontWeight: "bold", flexShrink: 0 }}
    >
      CRITICAL
    </span>
  );
}

function ConstraintBadge({ badge }: { badge: { label: string; color: string; bg: string } }) {
  return (
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
  );
}

// ─── Column registry ───────────────────────────────────────────────────────

export const TASK_COLUMN_REGISTRY: readonly TaskColumnDefinition[] = [
  // ── Structural WBS band field (render-layer only, no data) ──────────────
  {
    id: "wbs",
    label: "",
    title: "WBS Structure",
    width: WBS_BAND_FIELD_WIDTH,
    minWidth: WBS_BAND_FIELD_WIDTH,
    source: "ui",
    visibleByDefault: true,
    resizable: false,
    align: "left",
    tier: "A",
    tdClassName: "task-cell task-cell-wbs-band",
    tdStyle: (row) => ({
      padding: 0,
      overflow: "visible",
      background: row.isSummary ? "var(--summary-wbs-band-fill, var(--branch-roof-fill))" : "transparent",
      position: "relative",
    }),
    ariaHidden: (row) => !row.isSummary || !row.canExpand,
    renderCell: (row, ctx) => {
      const laneSegments = ctx.rowMeta?.laneSegments ?? [];
      return (
        <>
          {laneSegments.length > 0 && (
            <div className="task-wbs-row-paint" aria-hidden="true">
              {laneSegments.map((segment) => {
                const x = segment.laneIndex * WBS_BAND_STEP;
                if (row.isSummary && segment.isSelfSummary) return null;
                return (
                  <div key={`${row.id}-wbs-band-${segment.summaryId}`}>
                    <span
                      className="task-wbs-band-wall"
                      style={{ left: x, backgroundColor: `var(${segment.colorToken}-wall)` }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {row.isSummary && row.canExpand && (
            <span
              onClick={(e) => { e.stopPropagation(); ctx.onToggleCollapse(row.id); }}
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
              {row.isCollapsed ? "▶" : "▼"}
            </span>
          )}
        </>
      );
    },
  },

  // ── Activity ID / summary name (summary rows span into task column) ───────
  {
    id: "id",
    label: "Act ID",
    title: "Activity ID",
    width: 92,
    minWidth: 60,
    source: "canonical",
    visibleByDefault: true,
    align: "left",
    tier: "A",
    getColSpan: (row, visibleColumns) => {
      if (!row.isSummary) return 1;
      // Span into the task column only if it's currently visible (and would be skipped).
      return visibleColumns.some((c) => c.id === "task") ? 2 : 1;
    },
    tdStyle: (row) => (row.isSummary ? { padding: 0 } : { padding: "0 4px" }),
    tdClassName: (row) =>
      row.isSummary
        ? "task-cell task-cell-id task-cell-summary-tree"
        : "task-cell task-cell-id task-cell-activity-id task-cell-mono",
    renderCell: (row, ctx) => {
      const schedule = ctx.scheduleResults[row.id];
      const badge = constraintBadgeStyle(row.constraintType);
      const sev = highestSeverity(ctx.diagnosticsMap?.[row.id], row.constraintType);
      const diagTooltip = sev
        ? buildAllDiags(ctx.diagnosticsMap?.[row.id] ?? [], row.constraintType ?? "ASAP")
            .map((d) => d.message)
            .join("\n")
        : undefined;

      if (row.isSummary) {
        return (
          <div className="task-summary-tree-stack" title={diagTooltip ?? row.name}>
            <div className="task-summary-tree-label-row">
              <div className="task-summary-tree-label-shell">
                <EditableCell value={row.name} onCommit={(v) => ctx.onUpdateTask(row.id, { name: v })}>
                  <strong className="task-name-text is-summary">{row.name}</strong>
                  {schedule?.isCritical && <CriticalBadge />}
                  {badge && <ConstraintBadge badge={badge} />}
                </EditableCell>
              </div>
            </div>
          </div>
        );
      }

      const activityIdText = row.activityCode ?? row.sourceActivityId ?? "";
      return (
        <div
          className="task-activity-tree-row"
          style={{
            ...CELL_CONTENT_BASE,
            fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
            fontSize: 11,
            color: "#486275",
          }}
          title={diagTooltip ?? activityIdText}
        >
          <span className="task-activity-id-text">{activityIdText}</span>
        </div>
      );
    },
  },

  // ── Activity description (leaf rows only; summary rows span from id column) ─
  {
    id: "task",
    label: "Desc",
    title: "Activity Description",
    width: 254,
    minWidth: 120,
    source: "canonical",
    visibleByDefault: true,
    align: "left",
    tier: "A",
    editable: true,
    skipRender: (row) => row.isSummary,
    tdClassName: "task-name-cell task-cell-name",
    renderCell: (row, ctx) => {
      const schedule = ctx.scheduleResults[row.id];
      const badge = constraintBadgeStyle(row.constraintType);
      return (
        <div className="task-name-content is-leaf-row" style={CELL_CONTENT_BASE} title={row.name}>
          <EditableCell value={row.name} onCommit={(v) => ctx.onUpdateTask(row.id, { name: v })}>
            <strong className="task-name-text">{row.name}</strong>
            {schedule?.isCritical && <CriticalBadge />}
            {badge && <ConstraintBadge badge={badge} />}
          </EditableCell>
        </div>
      );
    },
  },

  // ── Duration ─────────────────────────────────────────────────────────────
  {
    id: "duration",
    label: "Dur",
    title: "Duration",
    width: 60,
    minWidth: 48,
    source: "canonical",
    visibleByDefault: true,
    align: "right",
    tier: "A",
    editable: true,
    tdClassName: "task-cell task-cell-duration task-cell-numeric",
    renderCell: (row, ctx) => (
      <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", gap: 4 }}>
        {row.isSummary ? (
          <span className="task-cell-readonly">
            {row.rollupDurationMinutes != null ? `${row.rollupDurationMinutes / MINUTES_PER_DAY}d` : "—"}
          </span>
        ) : (
          <EditableCell
            value={String(row.durationWorkMinutes / MINUTES_PER_DAY)}
            onCommit={(v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) return;
              ctx.onUpdateTask(row.id, { durationWorkMinutes: (n * MINUTES_PER_DAY) as WorkMinutes });
            }}
          >
            <span>{row.durationWorkMinutes / MINUTES_PER_DAY}d</span>
          </EditableCell>
        )}
      </div>
    ),
  },

  // ── Early Start ───────────────────────────────────────────────────────────
  {
    id: "start",
    label: "Start",
    title: undefined,
    width: 88,
    minWidth: 72,
    source: "computed",
    visibleByDefault: true,
    align: "center",
    tier: "A",
    tdClassName: "task-cell task-cell-date",
    renderCell: (row, ctx) => {
      const schedule = ctx.scheduleResults[row.id];
      const label = schedule ? projectDateFormatted(ctx.projectStartDate, schedule.earlyStartMinutes, ctx.dateDisplayFormat) : "—";
      const titleAttr = schedule ? formatDateISO(projectDate(ctx.projectStartDate, schedule.earlyStartMinutes)) : undefined;
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em" }}>
          {row.isSummary ? (
            <span className="task-cell-readonly task-date-text" title={titleAttr}>{label}</span>
          ) : (
            <span className="task-date-text" title={titleAttr}>{label}</span>
          )}
        </div>
      );
    },
  },

  // ── Early Finish ──────────────────────────────────────────────────────────
  {
    id: "finish",
    label: "Finish",
    title: undefined,
    width: 88,
    minWidth: 72,
    source: "computed",
    visibleByDefault: true,
    align: "center",
    tier: "A",
    tdClassName: "task-cell task-cell-date",
    renderCell: (row, ctx) => {
      const schedule = ctx.scheduleResults[row.id];
      const label = schedule ? projectDateFormatted(ctx.projectStartDate, schedule.earlyFinishMinutes, ctx.dateDisplayFormat) : "—";
      const titleAttr = schedule ? formatDateISO(projectDate(ctx.projectStartDate, schedule.earlyFinishMinutes)) : undefined;
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em" }}>
          {row.isSummary ? (
            <span className="task-cell-readonly task-date-text" title={titleAttr}>{label}</span>
          ) : (
            <span className="task-date-text" title={titleAttr}>{label}</span>
          )}
        </div>
      );
    },
  },

  // ── Total Float ───────────────────────────────────────────────────────────
  {
    id: "tf",
    label: "TF",
    title: "Total Float",
    width: 50,
    minWidth: 40,
    source: "computed",
    visibleByDefault: true,
    align: "right",
    tier: "B",
    tdClassName: "task-cell task-cell-float task-cell-numeric",
    renderCell: (row, ctx) => {
      const schedule = ctx.scheduleResults[row.id];
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end" }}>
          {row.isSummary ? (
            <span className="task-cell-readonly">{schedule?.totalFloatMinutes ?? "—"}</span>
          ) : (
            <span>{schedule?.totalFloatMinutes ?? "—"}</span>
          )}
        </div>
      );
    },
  },

  // ── Constraint Type ───────────────────────────────────────────────────────
  {
    id: "ct",
    label: "Con",
    title: "Constraint",
    width: 60,
    minWidth: 48,
    source: "canonical",
    visibleByDefault: true,
    align: "center",
    tier: "B",
    editable: true,
    tdClassName: "task-cell task-cell-constraint",
    renderCell: (row, ctx) => {
      if (row.isSummary) {
        return (
          <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center" }}>
            <span className="task-cell-readonly">—</span>
          </div>
        );
      }
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center" }}>
          <select
            value={row.constraintType ?? "ASAP"}
            onChange={(e) => {
              const ct = e.target.value as ConstraintType;
              const isDated = ct === "SNET" || ct === "FNLT" || ct === "MSO" || ct === "MFO";
              ctx.onUpdateTask(row.id, {
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
        </div>
      );
    },
  },

  // ── Constraint Date ───────────────────────────────────────────────────────
  {
    id: "cd",
    label: "CDate",
    title: "Constraint Date",
    width: 68,
    minWidth: 60,
    source: "canonical",
    visibleByDefault: true,
    align: "center",
    tier: "B",
    editable: true,
    tdClassName: "task-cell task-cell-date task-cell-constraint-date",
    renderCell: (row, ctx) => {
      if (row.isSummary) {
        return (
          <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em" }}>
            <span className="task-cell-readonly">—</span>
          </div>
        );
      }
      const hasDatedConstraint =
        row.constraintType && row.constraintType !== "ASAP" && row.constraintType !== "ALAP";
      if (!hasDatedConstraint) {
        return (
          <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em" }}>
            <span style={{ color: "#999" }}>—</span>
          </div>
        );
      }
      const constraintDateLabel =
        row.constraintDateMinutes != null
          ? projectDateFormatted(ctx.projectStartDate, row.constraintDateMinutes, ctx.dateDisplayFormat)
          : "";
      const constraintDateTitle =
        row.constraintDateMinutes != null
          ? formatDateISO(projectDate(ctx.projectStartDate, row.constraintDateMinutes))
          : undefined;
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em" }}>
          <EditableCell
            value={String(row.constraintDateMinutes != null ? row.constraintDateMinutes / MINUTES_PER_DAY : "")}
            onCommit={(v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return;
              ctx.onUpdateTask(row.id, { constraintDateMinutes: (n * MINUTES_PER_DAY) as WorkMinutes });
            }}
          >
            <span className="task-date-text" title={constraintDateTitle}>{constraintDateLabel}</span>
          </EditableCell>
        </div>
      );
    },
  },

  // ── Start Variance ────────────────────────────────────────────────────────
  {
    id: "sv",
    label: "SV",
    title: "Start Variance",
    width: 50,
    minWidth: 40,
    source: "computed",
    visibleByDefault: true,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-variance task-cell-numeric",
    renderCell: (row, ctx) => {
      const variance = ctx.variances[row.id];
      return (
        <div
          style={{
            ...CELL_CONTENT_BASE,
            justifyContent: "flex-end",
            ...(row.isSummary ? {} : variance ? varianceStyle(variance.startVarianceMinutes) : {}),
          }}
        >
          {row.isSummary ? (
            <span className="task-cell-readonly">{variance ? variance.startVarianceMinutes : "—"}</span>
          ) : (
            <span>{variance ? variance.startVarianceMinutes : "—"}</span>
          )}
        </div>
      );
    },
  },

  // ── Finish Variance ───────────────────────────────────────────────────────
  {
    id: "fv",
    label: "FV",
    title: "Finish Variance",
    width: 50,
    minWidth: 40,
    source: "computed",
    visibleByDefault: true,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-variance task-cell-numeric",
    renderCell: (row, ctx) => {
      const variance = ctx.variances[row.id];
      return (
        <div
          style={{
            ...CELL_CONTENT_BASE,
            justifyContent: "flex-end",
            ...(row.isSummary ? {} : variance ? varianceStyle(variance.finishVarianceMinutes) : {}),
          }}
        >
          {row.isSummary ? (
            <span className="task-cell-readonly">{variance ? variance.finishVarianceMinutes : "—"}</span>
          ) : (
            <span>{variance ? variance.finishVarianceMinutes : "—"}</span>
          )}
        </div>
      );
    },
  },

  // ── Duration Variance ─────────────────────────────────────────────────────
  {
    id: "dv",
    label: "DV",
    title: "Duration Variance",
    width: 50,
    minWidth: 40,
    source: "computed",
    visibleByDefault: true,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-variance task-cell-numeric",
    renderCell: (row, ctx) => {
      const variance = ctx.variances[row.id];
      return (
        <div
          style={{
            ...CELL_CONTENT_BASE,
            justifyContent: "flex-end",
            ...(row.isSummary ? {} : variance ? varianceStyle(variance.durationVarianceMinutes) : {}),
          }}
        >
          {row.isSummary ? (
            <span className="task-cell-readonly">{variance ? variance.durationVarianceMinutes : "—"}</span>
          ) : (
            <span>{variance ? variance.durationVarianceMinutes : "—"}</span>
          )}
        </div>
      );
    },
  },

  // ── W4.4: Source Actual Start ─────────────────────────────────────────────
  {
    id: "act-start",
    label: "AStart",
    title: "Source Actual Start",
    width: 88,
    minWidth: 72,
    source: "imported",
    visibleByDefault: false,
    align: "center",
    tier: "C",
    tdClassName: "task-cell task-cell-date task-cell-src-actual",
    renderCell: (row, ctx) => {
      const actuals = ctx.sourceActuals?.[row.id];
      const label = actuals?.actualStartMinutes != null
        ? projectDateFromMinutesFormatted(ctx.projectStartDate, actuals.actualStartMinutes, ctx.dateDisplayFormat)
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em", color: "#5c6bc0" }}>
          <span className="task-cell-readonly task-date-text">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Actual Finish ────────────────────────────────────────────
  {
    id: "act-finish",
    label: "AFin",
    title: "Source Actual Finish",
    width: 88,
    minWidth: 72,
    source: "imported",
    visibleByDefault: false,
    align: "center",
    tier: "C",
    tdClassName: "task-cell task-cell-date task-cell-src-actual",
    renderCell: (row, ctx) => {
      const actuals = ctx.sourceActuals?.[row.id];
      const label = actuals?.actualFinishMinutes != null
        ? projectDateFromMinutesFormatted(ctx.projectStartDate, actuals.actualFinishMinutes, ctx.dateDisplayFormat)
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "center", fontSize: "0.85em", color: "#5c6bc0" }}>
          <span className="task-cell-readonly task-date-text">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Remaining Duration ──────────────────────────────────────
  {
    id: "rem-dur",
    label: "RemDur",
    title: "Source Remaining Duration",
    width: 68,
    minWidth: 52,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-duration task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const actuals = ctx.sourceActuals?.[row.id];
      const label = actuals?.remainingDurationWorkMinutes != null
        ? `${actuals.remainingDurationWorkMinutes / MINUTES_PER_DAY}d`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Actual Duration ─────────────────────────────────────────
  {
    id: "act-dur",
    label: "ActDur",
    title: "Source Actual Duration",
    width: 68,
    minWidth: 52,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-duration task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const actuals = ctx.sourceActuals?.[row.id];
      const label = actuals?.actualDurationWorkMinutes != null
        ? `${actuals.actualDurationWorkMinutes / MINUTES_PER_DAY}d`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Physical % Complete ─────────────────────────────────────
  {
    id: "phys-pct",
    label: "Phys%",
    title: "Source Physical % Complete",
    width: 60,
    minWidth: 48,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-pct task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const progress = ctx.sourceProgress?.[row.id];
      const label = progress?.physicalPercentComplete != null
        ? `${progress.physicalPercentComplete}%`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Duration % Complete ─────────────────────────────────────
  {
    id: "dur-pct",
    label: "Dur%",
    title: "Source Duration % Complete",
    width: 60,
    minWidth: 48,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-pct task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const progress = ctx.sourceProgress?.[row.id];
      const label = progress?.durationPercentComplete != null
        ? `${progress.durationPercentComplete}%`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source Units % Complete ────────────────────────────────────────
  {
    id: "units-pct",
    label: "Units%",
    title: "Source Units % Complete",
    width: 60,
    minWidth: 48,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-pct task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const progress = ctx.sourceProgress?.[row.id];
      const label = progress?.unitsPercentComplete != null
        ? `${progress.unitsPercentComplete}%`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },

  // ── W4.4: Source % Complete ───────────────────────────────────────────────
  {
    id: "pct-comp",
    label: "% Cmp",
    title: "Source % Complete",
    width: 60,
    minWidth: 48,
    source: "imported",
    visibleByDefault: false,
    align: "right",
    tier: "C",
    tdClassName: "task-cell task-cell-pct task-cell-src-actual task-cell-numeric",
    renderCell: (row, ctx) => {
      const progress = ctx.sourceProgress?.[row.id];
      const label = progress?.percentComplete != null
        ? `${progress.percentComplete}%`
        : "\u2014";
      return (
        <div style={{ ...CELL_CONTENT_BASE, justifyContent: "flex-end", color: "#5c6bc0" }}>
          <span className="task-cell-readonly">{label}</span>
        </div>
      );
    },
  },
] as const;

// ─── Derived constants ─────────────────────────────────────────────────────

/** Sum of all default column widths. Used for tests and geometry assertions. */
export const TABLE_WIDTH = TASK_COLUMN_REGISTRY.reduce((sum, c) => sum + c.width, 0);

// Overlay spans only the dedicated WBS band column (column 0).
const IDENTITY_OVERLAY_WIDTH = WBS_BAND_FIELD_WIDTH;

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
  hiddenColumnIds?: ReadonlySet<string>;
  /** Called when the user right-clicks an activity row. isSummary and hasScheduleResult are forwarded for disabled-state decisions. */
  onContextMenu?: (taskId: string, position: { x: number; y: number }, isSummary: boolean, hasScheduleResult: boolean) => void;
  /** W4.4: Source import actuals/progress sidecar — read-only display columns. */
  sourceImportFidelityState?: SourceImportFidelityState;
  /** W4.4.1: User-selected date display format. Defaults to DD-MMM-YY. */
  dateDisplayFormat?: DateDisplayFormat;
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
  hiddenColumnIds,
  onContextMenu,
  sourceImportFidelityState,
  dateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
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

  // ── Hierarchy metadata ──────────────────────────────────────────────────
  const hierarchyMeta = useMemo(() => buildHierarchyRenderMeta(tasks), [tasks]);
  const showHierarchyDebugOverlay =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("hierarchyDebug") === "1";

  // ── Local column state ──────────────────────────────────────────────────
  /** Per-column width overrides (px). Initialized from registry defaults. */
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(TASK_COLUMN_REGISTRY.map((c) => [c.id, c.width])),
  );

  /** Uncontrolled fallback for column visibility when parent does not provide state. */
  const [localHiddenCols] = useState<ReadonlySet<string>>(
    () => new Set(TASK_COLUMN_REGISTRY.filter((c) => !c.visibleByDefault).map((c) => c.id)),
  );

  const hiddenCols = hiddenColumnIds ?? localHiddenCols;

  const visibleColumns = useMemo(
    () => TASK_COLUMN_REGISTRY.filter((c) => !hiddenCols.has(c.id)),
    [hiddenCols],
  );

  const totalTableWidth = useMemo(
    () => visibleColumns.reduce((sum, c) => sum + (colWidths[c.id] ?? c.width), 0),
    [visibleColumns, colWidths],
  );

  const resizeStateRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);

  const clampWidth = (column: TaskColumnDefinition, width: number) => {
    const min = column.minWidth;
    const max = column.maxWidth;
    if (max == null) return Math.max(min, width);
    return Math.max(min, Math.min(max, width));
  };

  const startResize = (column: TaskColumnDefinition, e: ReactPointerEvent<HTMLDivElement>) => {
    if (column.resizable === false) return;
    e.preventDefault();
    e.stopPropagation();
    const startWidth = colWidths[column.id] ?? column.width;
    resizeStateRef.current = {
      columnId: column.id,
      startX: e.clientX,
      startWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (ev: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state || state.columnId !== column.id) return;
      const nextWidth = clampWidth(column, state.startWidth + (ev.clientX - state.startX));
      setColWidths((prev) => ({ ...prev, [column.id]: nextWidth }));
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const visibleTasks = endIndex >= startIndex ? tasks.slice(startIndex, endIndex + 1) : [];
  const visibleHierarchyMeta = endIndex >= startIndex ? hierarchyMeta.slice(startIndex, endIndex + 1) : [];

  // ── colGroup (shared by header and body table) ──────────────────────────
  const colGroup = (
    <colgroup>
      {visibleColumns.map((c) => {
        const w = colWidths[c.id] ?? c.width;
        return <col key={c.id} style={{ width: w, minWidth: w }} />;
      })}
    </colgroup>
  );

  // ── Header styles ───────────────────────────────────────────────────────
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

  const thStyleFor = (col: TaskColumnDefinition): CSSProperties => ({
    ...thBase,
    textAlign: col.align,
    fontWeight: col.tier === "A" ? 600 : 500,
    color: col.tier === "C" ? "#78909c" : "#37474f",
  });

  const thContentStyleFor = (col: TaskColumnDefinition): CSSProperties => ({
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start",
    padding: "0 8px",
    boxSizing: "border-box",
  });

  // ── Base td style (column overrides are merged on top) ──────────────────
  const baseTdStyle = (col: TaskColumnDefinition): CSSProperties => ({
    height: ROW_HEIGHT,
    boxSizing: "border-box",
    padding: "0 8px",
    overflow: "hidden",
    borderBottom: "1px solid #e0e0e0",
    verticalAlign: "middle",
    textAlign: col.align,
  });

  return (
    /* Single scroll owner — overflowX:auto here, scrollbar pinned to pane bottom */
    <div style={{ width: "100%", borderRight: "1px solid #ccc", overflowX: "auto", overflowY: "hidden", minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Inner column at totalTableWidth — single horizontal authority for header + body */}
      <div style={{ width: totalTableWidth, minWidth: totalTableWidth, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

        {/* Header wrapper */}
        <div style={{ flexShrink: 0, position: "relative", zIndex: 10 }}>
          {/* Fixed header — wrapper constrains total height to HEADER_HEIGHT (incl. border) */}
          <div
            className="task-table-header"
            style={{ height: HEADER_HEIGHT, flexShrink: 0, borderBottom: "1px solid #ccc", boxSizing: "border-box", overflow: "hidden" }}
          >
            <table
              className="task-table-grid"
              style={{ width: totalTableWidth, minWidth: totalTableWidth, borderCollapse: "collapse", tableLayout: "fixed" }}
            >
              {colGroup}
              <thead>
                <tr style={{ height: HEADER_HEIGHT - HEADER_METRICS.borderBottom, background: "#f5f5f5" }}>
                  {visibleColumns.map((c, i) => (
                    <th
                      key={i}
                      style={thStyleFor(c)}
                      title={c.title}
                      className={`task-table-th task-table-th-align-${c.align} task-table-th-tier-${c.tier ?? "A"}`}
                      data-col-key={c.id}
                    >
                      <div className="task-table-th-content" style={thContentStyleFor(c)}>
                        <span className="task-table-th-label">{c.label}</span>
                      </div>
                      {c.resizable !== false && (
                        <div
                          className="task-table-col-resize-handle"
                          onPointerDown={(e) => startResize(c, e)}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${c.title ?? c.label} column`}
                          title={`Resize ${c.title ?? c.label}`}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
        </div>

        {/* Clipped body viewport — vertical scroll owned by App's phantom scroll track */}
        <div
          ref={bodyRef}
          className="task-table-body"
          style={{ flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}
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
                width: totalTableWidth,
                minWidth: totalTableWidth,
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

                  // Per-row context: table-level data + this row's hierarchy metadata.
                  const ctx: TaskTableContext = {
                    scheduleResults,
                    variances,
                    diagnosticsMap,
                    onUpdateTask,
                    onToggleCollapse,
                    projectStartDate,
                    rowHeight: ROW_HEIGHT,
                    rowMeta: rowHierarchyMeta,
                    sourceActuals: sourceImportFidelityState?.actualsByTaskId,
                    sourceProgress: sourceImportFidelityState?.progressByTaskId,
                    dateDisplayFormat,
                  };

                  return (
                    <tr
                      key={task.id}
                      className={`task-row ${task.isSummary ? "task-row-summary" : "task-row-leaf"}`}
                      data-wbs-depth={task.depth}
                      data-is-summary={task.isSummary}
                      data-selected={isSelected}
                      data-is-critical={!!scheduleResults[task.id]?.isCritical}
                      onClick={(e) => onSelectTask(task.id, e.ctrlKey || e.metaKey)}
                      onContextMenu={(e) => {
                        if (!onContextMenu) return;
                        e.preventDefault();
                        onSelectTask(task.id, false);
                        onContextMenu(task.id, { x: e.clientX, y: e.clientY }, task.isSummary, !!scheduleResults[task.id]);
                      }}
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
                      {visibleColumns.map((col) => {
                        if (col.skipRender?.(task)) return null;
                        const colSpan = col.getColSpan?.(task, visibleColumns) ?? 1;
                        const tdStyle: CSSProperties = {
                          ...baseTdStyle(col),
                          ...col.tdStyle?.(task),
                        };
                        const tdClass =
                          typeof col.tdClassName === "function"
                            ? col.tdClassName(task)
                            : (col.tdClassName ?? "task-cell");
                        return (
                          <td
                            key={col.id}
                            colSpan={colSpan}
                            style={tdStyle}
                            className={tdClass}
                            aria-hidden={col.ariaHidden?.(task)}
                          >
                            {col.renderCell(task, ctx)}
                          </td>
                        );
                      })}
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
