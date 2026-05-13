import type { FloatPathMvpError, FloatPathMvpResponse, VisibleRow } from "@planner/protocol";
import { useMemo, useState } from "react";
import type { FloatPathLayoutMode, FloatPathViewFilter, FloatPathWbsContextDepth } from "../services/floatPathProjection";

export type FloatPathTaskDisplay = {
  taskId: string;
  activityId?: string;
  name?: string;
  wbsPath?: string;
  isMilestone?: boolean;
  isSummary?: boolean;
  totalFloat?: number;
};

type RunFloatPathInput = {
  targetTaskId: string;
  maxPaths: number;
  nearCriticalThresholdMinutes: number;
};

type FloatPathPanelProps = {
  workerReady: boolean;
  selectedTask: VisibleRow | null;
  isRunning: boolean;
  isStale: boolean;
  result: FloatPathMvpResponse | null;
  error: FloatPathMvpError | null;
  onRun: (input: RunFloatPathInput) => void;
  taskLookup: Record<string, FloatPathTaskDisplay>;
  viewFilter: FloatPathViewFilter;
  layoutMode: FloatPathLayoutMode;
  onViewFilterChange: (filter: FloatPathViewFilter) => void;
  onLayoutModeChange: (mode: FloatPathLayoutMode) => void;
  wbsContextDepth: FloatPathWbsContextDepth;
  onWbsContextDepthChange: (depth: FloatPathWbsContextDepth) => void;
  projectionActive: boolean;
  projectionWarning?: string;
};

const WORK_MINUTES_PER_DAY = 480;

function formatDayNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatFloatDays(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${formatDayNumber(value)}d`;
}

function formatLagDays(lagWorkMinutes: number | null | undefined): string {
  if (lagWorkMinutes == null || Number.isNaN(lagWorkMinutes)) return "n/a";
  const days = lagWorkMinutes / WORK_MINUTES_PER_DAY;
  const abs = formatDayNumber(Math.abs(days));
  if (days > 0) return `+${abs}d`;
  if (days < 0) return `-${abs}d`;
  return "0d";
}

function compactId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

function getWarningExplanation(
  warning: FloatPathMvpResponse["warnings"][number],
  result: FloatPathMvpResponse,
): string {
  if (warning.code === "SEARCH_CAPPED") {
    return "Search capped: The schedule has many possible paths. The system returned the best deterministic subset found.";
  }
  if (warning.code === "MAX_PATHS_CLAMPED") {
    const candidateCountMatch = warning.message.match(/(\d+)\s+candidate/i);
    const candidateCount = candidateCountMatch ? Number(candidateCountMatch[1]) : null;
    if (candidateCount != null) {
      return `Result clamped: ${result.summary.returnedPathCount} paths were returned from ${candidateCount} candidates.`;
    }
    return `Result clamped: ${result.summary.returnedPathCount} paths were returned from a larger candidate set.`;
  }
  return warning.message;
}

function getPrimaryActivityId(display: FloatPathTaskDisplay | undefined, fallbackTaskId: string): string {
  return display?.activityId?.trim() || fallbackTaskId;
}

function getTargetDisplay(
  targetTaskId: string,
  targetTaskName: string | undefined,
  taskLookup: Record<string, FloatPathTaskDisplay>,
): string {
  const fromLookup = taskLookup[targetTaskId];
  const activityId = getPrimaryActivityId(fromLookup, targetTaskId);
  const name = targetTaskName ?? fromLookup?.name;
  return name ? `${activityId} - ${name}` : activityId;
}

function isLikelyMilestone(
  task: VisibleRow | null,
  result: FloatPathMvpResponse | null,
  taskLookup: Record<string, FloatPathTaskDisplay>,
): boolean {
  if (result?.target.isMilestone === true) return true;
  if (taskLookup[result?.target.taskId ?? ""]?.isMilestone === true) return true;
  if (!task) return false;
  return task.durationWorkMinutes === 0 && !task.isSummary;
}

export function FloatPathPanel({
  workerReady,
  selectedTask,
  isRunning,
  isStale,
  result,
  error,
  onRun,
  taskLookup,
  viewFilter,
  layoutMode,
  onViewFilterChange,
  onLayoutModeChange,
  wbsContextDepth,
  onWbsContextDepthChange,
  projectionActive,
  projectionWarning,
}: FloatPathPanelProps) {
  const [maxPaths, setMaxPaths] = useState(5);
  const [nearCriticalThresholdMinutes, setNearCriticalThresholdMinutes] = useState(480);

  const thresholdOptions: Array<{ value: number; label: string }> = [
    { value: 0, label: "0 days" },
    { value: 480, label: "1 working day" },
    { value: 2400, label: "5 working days" },
    { value: 4800, label: "10 working days" },
    { value: 7200, label: "15 working days" },
  ];

  const isCustomThreshold = !thresholdOptions.some((option) => option.value === nearCriticalThresholdMinutes);
  const selectedThresholdValue = isCustomThreshold ? "custom" : `${nearCriticalThresholdMinutes}`;

  const canRun = workerReady && selectedTask != null && !isRunning;
  const canApplyFilter = result != null && !isStale;

  const nearCriticalMatchesAll = useMemo(() => {
    if (!result || result.paths.length === 0) return false;
    return result.paths.every((path) => path.isNearCritical);
  }, [result]);

  const availablePathFilters = useMemo(() => {
    if (!result) return [] as Array<{ pathId: string; label: string }>;
    return [...result.paths]
      .sort((a, b) => a.floatPathOrder - b.floatPathOrder || a.floatPathNumber - b.floatPathNumber)
      .slice(0, 3)
      .map((path) => {
        const primary = path.floatPathNumber === 1 || path.isPrimaryDrivingPath;
        return {
          pathId: path.pathId,
          label: primary ? `Float Path ${path.floatPathNumber} - Primary` : `Float Path ${path.floatPathNumber}`,
        };
      });
  }, [result]);

  const selectedFilterValue = useMemo(() => {
    if (viewFilter.mode === "off") return "off";
    if (viewFilter.mode === "path") return `path:${viewFilter.pathId}`;
    if (viewFilter.mode === "topN") return "top5";
    if (viewFilter.mode === "nearCritical") return "nearCritical";
    return "allReturned";
  }, [viewFilter]);

  const statusText = useMemo(() => {
    if (!workerReady) return "Worker is not ready yet.";
    if (!selectedTask) return "Select a milestone/activity first.";
    if (isRunning) return "Running float path analysis...";
    return "Ready.";
  }, [workerReady, selectedTask, isRunning]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12, fontFamily: "Arial, sans-serif" }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "1em" }}>Float Path Analysis</h3>
      <p style={{ margin: "0 0 10px 0", fontSize: "0.85em", color: "#555" }}>
        Read-only report. Kernel/worker compute the path set; React only triggers and renders.
      </p>
      <p style={{ margin: "0 0 10px 0", fontSize: "0.82em", color: "#666" }}>
        This analysis traces predecessor paths ending at the selected target only. It is not the overall project critical path unless the selected target is the final completion milestone.
      </p>

      <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: "0.85em", marginBottom: 8 }}>
          <strong>Target:</strong>{" "}
          {selectedTask
            ? getTargetDisplay(selectedTask.id, selectedTask.name, taskLookup)
            : "No task selected"}
        </div>
        <div style={{ fontSize: "0.82em", marginBottom: 8, color: "#555" }}>
          <strong>Type:</strong>{" "}
          {selectedTask
            ? isLikelyMilestone(selectedTask, result, taskLookup)
              ? "Milestone"
              : "Activity"
            : "Unknown"}
        </div>
        {selectedTask && !isLikelyMilestone(selectedTask, result, taskLookup) && (
          <div style={{ marginBottom: 8, fontSize: "0.82em", color: "#7a5d00" }}>
            Selected target is an activity. This analysis traces paths ending at this activity only.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85em" }}>
            Max Paths
            <input
              type="number"
              min={1}
              max={50}
              value={maxPaths}
              onChange={(e) => setMaxPaths(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              style={{ width: 72 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85em" }}>
            Near-critical threshold
            <select
              aria-label="Near-critical threshold"
              value={selectedThresholdValue}
              onChange={(e) => {
                if (e.target.value === "custom") return;
                setNearCriticalThresholdMinutes(Number(e.target.value));
              }}
            >
              {thresholdOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {isCustomThreshold && (
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85em" }}>
              Custom minutes
              <input
                type="number"
                min={0}
                value={nearCriticalThresholdMinutes}
                onChange={(e) =>
                  setNearCriticalThresholdMinutes(Math.max(0, Math.round(Number(e.target.value) || 0)))
                }
                style={{ width: 120 }}
              />
            </label>
          )}
          <button
            onClick={() => {
              if (!selectedTask) return;
              onRun({
                targetTaskId: selectedTask.id,
                maxPaths,
                nearCriticalThresholdMinutes,
              });
            }}
            disabled={!canRun}
            style={{ padding: "6px 10px", cursor: canRun ? "pointer" : "default" }}
          >
            {isRunning ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: "0.8em", color: "#666" }}>1 working day = 480 minutes</div>

        <div style={{ marginTop: 8, fontSize: "0.82em", color: "#666" }}>{statusText}</div>
        {isStale && (
          <div style={{ marginTop: 6, fontSize: "0.82em", color: "#8a6d1f" }}>
            Schedule changed after this analysis. Re-run analysis for the latest result.
          </div>
        )}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em" }}>
            Float Path Filter
            <select
              aria-label="Float Path Filter"
              value={selectedFilterValue}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "off") {
                  onViewFilterChange({ mode: "off" });
                  return;
                }
                if (!canApplyFilter) return;
                if (value.startsWith("path:")) {
                  onViewFilterChange({ mode: "path", pathId: value.slice(5) });
                  return;
                }
                if (value === "top5") {
                  onViewFilterChange({ mode: "topN", count: 5 });
                  return;
                }
                if (value === "nearCritical") {
                  onViewFilterChange({ mode: "nearCritical" });
                  return;
                }
                onViewFilterChange({ mode: "allReturned" });
              }}
            >
              <option value="off">Off / Normal View</option>
              {availablePathFilters.map((option) => (
                <option key={option.pathId} value={`path:${option.pathId}`} disabled={!canApplyFilter}>
                  {option.label}
                </option>
              ))}
              <option value="top5" disabled={!canApplyFilter}>Top 5 paths</option>
              <option value="nearCritical" disabled={!canApplyFilter}>Near-critical paths</option>
              <option value="allReturned" disabled={!canApplyFilter}>All returned paths</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em" }}>
            Arrange By
            <select
              aria-label="Arrange By"
              value={layoutMode}
              onChange={(e) => onLayoutModeChange(e.target.value as FloatPathLayoutMode)}
            >
              <option value="originalWbs">Original WBS</option>
              <option value="floatPathOrder">Float Path Order</option>
            </select>
          </label>
          {layoutMode === "originalWbs" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em" }}>
              WBS Context
              <select
                aria-label="WBS Context Depth"
                value={String(wbsContextDepth)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "none" || val === "full") {
                    onWbsContextDepthChange(val);
                  } else {
                    onWbsContextDepthChange(Number(val) as 1 | 2 | 3);
                  }
                }}
              >
                <option value="none">Activities only</option>
                <option value="1">1 level</option>
                <option value="2">2 levels</option>
                <option value="3">3 levels</option>
                <option value="full">Full WBS</option>
              </select>
            </label>
          )}
        </div>

        {!result && (
          <div style={{ fontSize: "0.82em", color: "#666" }}>
            Run analysis before applying a float path filter.
          </div>
        )}

        {projectionWarning && (
          <div style={{ marginTop: 6, fontSize: "0.82em", color: "#8a6d1f" }}>
            {projectionWarning}
          </div>
        )}

        {viewFilter.mode === "nearCritical" && nearCriticalMatchesAll && canApplyFilter && (
          <div style={{ marginTop: 6, fontSize: "0.82em", color: "#666" }}>
            Near-critical filter matches all returned paths for this analysis.
          </div>
        )}

        {projectionActive && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid #ffe08a",
              background: "#fff8e1",
              color: "#7a5d00",
              borderRadius: 4,
              padding: "6px 8px",
              fontSize: "0.82em",
            }}
          >
            Float Path filtered view is active. This is a temporary view and does not change the programme.
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            border: "1px solid #f2b8b5",
            background: "#fff2f1",
            color: "#9b1c1c",
            borderRadius: 6,
            padding: 10,
            marginBottom: 10,
            fontSize: "0.85em",
          }}
        >
          <strong>{error.type}</strong>: {error.message}
        </div>
      )}

      {result && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: "0.9em", marginBottom: 6 }}>
            <strong>Target</strong>: {getTargetDisplay(result.target.taskId, result.target.taskName, taskLookup)}
          </div>
          <div style={{ fontSize: "0.82em", color: "#555", marginBottom: 6 }}>
            <strong>Type</strong>: {isLikelyMilestone(selectedTask, result, taskLookup) ? "Milestone" : "Activity"}
          </div>
          <div style={{ fontSize: "0.82em", color: "#555", marginBottom: 10 }}>
            Returned {result.summary.returnedPathCount} of {result.summary.requestedPathCount} requested paths;{" "}
            {result.summary.nearCriticalPathCount} near-critical.
          </div>

          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: "0.85em" }}>Warnings</strong>
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "0.82em" }}>
                {result.warnings.map((warning, idx) => (
                  <li key={`${warning.code}-${idx}`}>
                    <div>
                      <strong>{getWarningExplanation(warning, result)}</strong>
                    </div>
                    <div style={{ color: "#555" }}>Code: {warning.code}</div>
                    <div style={{ color: "#555" }}>Severity: {warning.severity}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <strong style={{ fontSize: "0.85em" }}>Paths</strong>
            {result.paths.length === 0 ? (
              <div style={{ marginTop: 6, fontSize: "0.82em", color: "#666" }}>No paths returned.</div>
            ) : (
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {result.paths.map((path) => (
                  <div
                    key={path.pathId}
                    style={{ border: "1px solid #e3e3e3", borderRadius: 6, padding: 8, background: "#fafafa" }}
                  >
                    <div style={{ fontSize: "0.82em", marginBottom: 6 }}>
                      <strong>Path {path.floatPathNumber}</strong> | {path.isPrimaryDrivingPath ? "Primary" : "Secondary"} | {path.isNearCritical ? "Near-critical" : "Standard"} | Float {formatFloatDays(path.pathTotalFloatMinutes)} | Activities {path.orderedActivities.length} | Relationships {path.orderedRelationships.length}
                    </div>
                    {path.orderedActivities.length === 1 && path.orderedRelationships.length === 0 && (
                      <div style={{ marginBottom: 6, fontSize: "0.8em", color: "#7a5d00" }}>
                        No predecessor path was found to this target. Showing the selected target activity only.
                      </div>
                    )}
                    <div style={{ marginTop: 6, fontSize: "0.8em", color: "#333", display: "grid", gap: 4 }}>
                      {path.orderedActivities.map((activity) => {
                        const display = taskLookup[activity.taskId];
                        const activityId = getPrimaryActivityId(display, activity.taskId);
                        const name = activity.taskName ?? display?.name;
                        const readableName = name ?? `Unknown activity (${compactId(activity.taskId)})`;
                        return (
                          <div key={`${activity.taskId}-${activity.sequence}`} title={activity.taskId}>
                            {activityId} | {readableName} | TF {formatFloatDays(activity.totalFloatMinutes)}
                          </div>
                        );
                      })}
                    </div>
                    {path.orderedRelationships.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <strong style={{ fontSize: "0.8em" }}>Relationships</strong>
                        <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: "0.78em", color: "#444" }}>
                          {path.orderedRelationships.map((relationship, idx) => {
                            const predActivityId = getPrimaryActivityId(taskLookup[relationship.predTaskId], relationship.predTaskId);
                            const succActivityId = getPrimaryActivityId(taskLookup[relationship.succTaskId], relationship.succTaskId);
                            return (
                              <li key={`${relationship.predTaskId}-${relationship.succTaskId}-${idx}`}>
                                {predActivityId} → {succActivityId} | {relationship.depType} {formatLagDays(relationship.lagMinutes)}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
