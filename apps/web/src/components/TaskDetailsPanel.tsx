import type { Assignment, ConstraintDiagnosticCode, ConstraintType, Dependency, DependencyDiagnosticsMap, DependencyType, DiagnosticSeverity, DiagnosticsMap, Resource, ScheduleResultMap, Task, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY, SEVERITY_RANK } from "@planner/protocol";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import { formatDateISO, projectDate, projectDateShort } from "../utils/dateProjection";
import { ResourceList } from "./ResourceList";

const BORDER = "#c8c8c8";
const BG_HDR = "#eceef1";

function formatWorkDays(minutes: WorkMinutes): string {
  const days = minutes / MINUTES_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  return `${rounded}d`;
}

function formatScheduleDate(projectStartDate: string, minutes: WorkMinutes): { label: string; iso: string } {
  const label = projectDateShort(projectStartDate, minutes);
  const iso = formatDateISO(projectDate(projectStartDate, minutes));
  return { label, iso };
}

function formatConstraint(task: Task, projectStartDate: string): { label: string; title?: string } {
  const type = task.constraintType;
  if (!type || type === "ASAP") return { label: "ASAP" };
  if (task.constraintDateMinutes == null) return { label: type };
  const d = formatScheduleDate(projectStartDate, task.constraintDateMinutes);
  return { label: `${type} ${d.label}`, title: d.iso };
}

type RelationshipDirection = "predecessor" | "successor";

interface RelationshipTableProps {
  title: string;
  direction: RelationshipDirection;
  dependencies: readonly Dependency[];
  tasks: readonly Task[];
  scheduleResults: ScheduleResultMap;
  projectStartDate: string;
  emptyMessage: string;
  onGoToTask: (taskId: string) => void;
  onDeleteDependency: (dependencyId: string) => void;
  canDeleteRelationships: boolean;
  deleteDisabledReason?: string;
  dependencyDiagnosticsMap?: DependencyDiagnosticsMap;
}

function RelationshipTable({
  title,
  direction,
  dependencies,
  tasks,
  scheduleResults,
  projectStartDate,
  emptyMessage,
  onGoToTask,
  onDeleteDependency,
  canDeleteRelationships,
  deleteDisabledReason,
  dependencyDiagnosticsMap,
}: RelationshipTableProps) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const headerCell: CSSProperties = {
    borderRight: `1px solid ${BORDER}`,
    borderBottom: `1px solid ${BORDER}`,
    background: BG_HDR,
    fontSize: 10,
    fontWeight: 600,
    color: "#555",
    padding: "0 4px",
    display: "flex",
    alignItems: "center",
    height: 24,
    overflow: "hidden",
    whiteSpace: "nowrap",
  };

  const bodyCell: CSSProperties = {
    borderRight: `1px solid ${BORDER}`,
    borderBottom: `1px solid ${BORDER}`,
    fontSize: 11,
    padding: "0 4px",
    display: "flex",
    alignItems: "center",
    height: 24,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const GRID = "110px minmax(120px,1.5fr) 56px 52px 82px 82px 64px 56px minmax(96px,1fr) 64px 64px";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden", borderLeft: `1px solid ${BORDER}` }}>
      <div
        style={{
          flexShrink: 0,
          height: 24,
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          borderBottom: `1px solid ${BORDER}`,
          background: BG_HDR,
          fontSize: 11,
          fontWeight: 600,
          color: "#333",
        }}
      >
        {title}
        <span style={{ marginLeft: 4, fontWeight: 400, color: "#888", fontSize: 10 }}>
          ({dependencies.length})
        </span>
      </div>

      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: GRID }}>
        <div style={headerCell}>Activity ID</div>
        <div style={headerCell}>Activity Name</div>
        <div style={headerCell}>Relationship</div>
        <div style={headerCell}>Lag</div>
        <div style={headerCell}>Start</div>
        <div style={headerCell}>Finish</div>
        <div style={headerCell}>Total Float</div>
        <div style={headerCell}>Critical</div>
        <div style={headerCell}>Constraint</div>
        <div style={headerCell}>Driving</div>
        <div style={{ ...headerCell, borderRight: "none", justifyContent: "center" }}>Actions</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {dependencies.length === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: GRID }}>
            <div style={{ ...bodyCell, gridColumn: "1 / -1", borderRight: "none", color: "#999", fontStyle: "italic" }}>
              {emptyMessage}
            </div>
          </div>
        )}

        {dependencies.map((dep) => {
          const relatedTaskId = direction === "predecessor" ? dep.predId : dep.succId;
          const relatedTask = taskById.get(relatedTaskId);
          const schedule = scheduleResults[relatedTaskId];
          const activityId = relatedTask?.sourceActivityId?.trim() || relatedTask?.activityCode?.trim() || relatedTaskId;
          const lag = formatWorkDays(dep.lagWorkMinutes);
          const start = schedule ? formatScheduleDate(projectStartDate, schedule.earlyStartMinutes) : null;
          const finish = schedule ? formatScheduleDate(projectStartDate, schedule.earlyFinishMinutes) : null;
          const tf = schedule ? formatWorkDays(schedule.totalFloatMinutes) : "—";
          const critical = schedule ? (schedule.isCritical ? "Yes" : "No") : "—";
          const constraint = relatedTask ? formatConstraint(relatedTask, projectStartDate) : { label: "—" };
          const depDiag = dependencyDiagnosticsMap?.[dep.id];
          const drivingLabel = depDiag?.isDriving === true ? "Yes" : depDiag?.isDriving === false ? "No" : "—";
          const drivingTitle =
            depDiag?.isDriving === true
              ? "Driving relationship — link slack is 0"
              : depDiag?.isDriving === false
              ? "Non-driving — positive link slack"
              : "Driving status unavailable";

          return (
            <div key={dep.id} style={{ display: "grid", gridTemplateColumns: GRID }}>
              <div style={bodyCell} title={activityId}>{activityId}</div>
              <div style={bodyCell} title={relatedTask?.name ?? relatedTaskId}>{relatedTask?.name ?? relatedTaskId}</div>
              <div style={bodyCell}>{dep.type}</div>
              <div style={bodyCell}>{lag}</div>
              <div style={bodyCell} title={start?.iso}>{start?.label ?? "—"}</div>
              <div style={bodyCell} title={finish?.iso}>{finish?.label ?? "—"}</div>
              <div style={bodyCell}>{tf}</div>
              <div style={bodyCell}>{critical}</div>
              <div style={bodyCell} title={constraint.title}>{constraint.label}</div>
              <div style={bodyCell} title={drivingTitle}>{drivingLabel}</div>
              <div style={{ ...bodyCell, borderRight: "none", justifyContent: "center", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => onGoToTask(relatedTaskId)}
                  title="Go to activity"
                  style={{
                    width: 18,
                    height: 18,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 0,
                    background: "#fff",
                    color: "#1e88e5",
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: "16px",
                    padding: 0,
                  }}
                >
                  ↗
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteDependency(dep.id)}
                  title={!canDeleteRelationships ? deleteDisabledReason ?? "Remove relationship" : "Remove relationship"}
                  disabled={!canDeleteRelationships}
                  style={{
                    width: 18,
                    height: 18,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 0,
                    background: canDeleteRelationships ? "#fff" : "#f0f0f0",
                    color: canDeleteRelationships ? "#c62828" : "#9e9e9e",
                    cursor: canDeleteRelationships ? "pointer" : "default",
                    fontSize: 11,
                    lineHeight: "16px",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ConstraintEditor — inline constraint controls for selected task     */
/* ------------------------------------------------------------------ */

const DATED_TYPES: ReadonlySet<ConstraintType> = new Set(["SNET", "FNLT", "MSO", "MFO"]);
const HARD_TYPES: ReadonlySet<ConstraintType> = new Set(["MSO", "MFO"]);

/** Local UI shape for rendering diagnostics. */
type UiDiag = { code: string; level: "error" | "info"; message: string };

/** Maps a worker-provided diagnostic code to a UI-renderable shape. */
export function mapCodeToUiDiag(code: ConstraintDiagnosticCode, ct: ConstraintType): UiDiag {
  switch (code) {
    case "MISSING_DATE_FOR_CONSTRAINT":
      return { code, level: "error", message: `${ct} requires a constraint date.` };
    case "DATE_IGNORED_BY_MODE":
      return { code, level: "info", message: "Date is ignored for ALAP." };
    case "GENERATING_NEGATIVE_FLOAT":
      return { code, level: "error", message: "Constraint generates negative float." };
    case "SUPERSEDED_BY_LOGIC":
      return { code, level: "info", message: "Constraint is already satisfied by logic." };
    case "SUPERSEDED_BY_CALENDAR":
      return { code, level: "info", message: "Constraint date falls on a non-working day and will be adjusted by the calendar." };
  }
}

/** Builds the full diagnostic array: worker codes mapped to UI + local-only hints. */
export function buildAllDiags(codes: readonly ConstraintDiagnosticCode[], ct: ConstraintType): UiDiag[] {
  const workerDiags = codes.map((c) => mapCodeToUiDiag(c, ct));
  const localDiags: UiDiag[] = [];
  if (HARD_TYPES.has(ct)) {
    localDiags.push({ code: "HARD_CONSTRAINT_INFO", level: "info", message: "Hard constraint — overrides computed schedule." });
  }
  return [...workerDiags, ...localDiags];
}

/** Returns the highest severity across all diagnostics for a task, or null if none. */
export function highestSeverity(
  codes: readonly ConstraintDiagnosticCode[] | undefined,
  ct: ConstraintType | undefined,
): DiagnosticSeverity | null {
  const effective = ct ?? "ASAP";
  const diags = buildAllDiags(codes ?? [], effective);
  if (diags.length === 0) return null;
  let best: DiagnosticSeverity = diags[0].level;
  for (let i = 1; i < diags.length; i++) {
    if (SEVERITY_RANK[diags[i].level] > SEVERITY_RANK[best]) {
      best = diags[i].level;
    }
  }
  return best;
}

function ConstraintEditor({ task, onUpdateTask, diagnostics = [] }: {
  task: Task;
  onUpdateTask: (taskId: string, updates: { constraintType?: ConstraintType; constraintDateMinutes?: WorkMinutes | null }) => void;
  diagnostics?: ConstraintDiagnosticCode[];
}) {
  const ct = task.constraintType ?? "ASAP";
  const isDated = DATED_TYPES.has(ct);
  const allDiags = buildAllDiags(diagnostics, ct);

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: "0.9em" }}>
      <strong style={{ display: "block", marginBottom: 4 }}>Constraint</strong>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Type
          <select
            value={ct}
            onChange={(e) => {
              const next = e.target.value as ConstraintType;
              const nextDated = DATED_TYPES.has(next);
              onUpdateTask(task.id, {
                constraintType: next,
                ...(!nextDated ? { constraintDateMinutes: null } : {}),
              });
            }}
            style={{ fontSize: "0.9em", padding: "2px 4px" }}
          >
            <option value="ASAP">ASAP</option>
            <option value="ALAP">ALAP</option>
            <option value="SNET">SNET</option>
            <option value="FNLT">FNLT</option>
            <option value="MSO">MSO</option>
            <option value="MFO">MFO</option>
          </select>
        </label>
        {isDated && (
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            Date
            <input
              type="number"
              min={0}
              step={1}
              value={task.constraintDateMinutes != null ? task.constraintDateMinutes / MINUTES_PER_DAY : ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return;
                onUpdateTask(task.id, { constraintDateMinutes: (n * MINUTES_PER_DAY) as WorkMinutes });
              }}
              style={{ width: 60, fontSize: "0.9em", padding: "2px 4px" }}
            />
          </label>
        )}
      </div>
      {allDiags.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {allDiags.map((d, i) => (
            <div
              key={i}
              style={{
                color: d.level === "error" ? "#c62828" : "#616161",
                fontSize: "0.85em",
                marginTop: i > 0 ? 2 : 0,
              }}
            >
              {d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TaskDetailsPanel — selected-activity tabbed layout                 */
/* ------------------------------------------------------------------ */

type TaskDetailsTab = "general" | "relationships" | "resources";

const TASK_DETAILS_TABS: ReadonlyArray<{ key: TaskDetailsTab; label: string }> = [
  { key: "general", label: "General" },
  { key: "relationships", label: "Relationships" },
  { key: "resources", label: "Resources" },
];

export interface TaskDetailsPanelProps {
  dependencies: readonly Dependency[];
  tasks: readonly Task[];
  getTaskName: (id: string) => string;
  onUpdateDependencyType: (depId: string, type: DependencyType) => void;
  onUpdateDependencyLag: (depId: string, lag: number) => void;
  onDeleteDependency: (depId: string) => void;
  onAddDependency: (predId: string, succId: string, type: DependencyType, lag: number) => void;
  resources: readonly Resource[];
  assignments: readonly Assignment[];
  resourceName: string;
  onResourceNameChange: (name: string) => void;
  onAddResource: () => void;
  onDeleteResource: (id: string) => void;
  onAddAssignment: (taskId: string, resourceId: string) => void;
  onDeleteAssignment: (id: string) => void;
  selectedTask?: VisibleRow | null;
  onUpdateTask?: (taskId: string, updates: { constraintType?: ConstraintType; constraintDateMinutes?: WorkMinutes | null }) => void;
  diagnosticsMap?: DiagnosticsMap;
  scheduleResults: ScheduleResultMap;
  projectStartDate: string;
  onGoToTask: (taskId: string) => void;
  canDeleteRelationships: boolean;
  relationshipDeleteDisabledReason?: string;
  dependencyDiagnosticsMap?: DependencyDiagnosticsMap;
}

/**
 * Task Details tab content — selected-activity tabs (General, Relationships, Resources).
 * Parent drawer controls outer height; panels scroll internally.
 */
export function TaskDetailsPanel(props: TaskDetailsPanelProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeTab, setActiveTab] = useState<TaskDetailsTab>("general");
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const relationshipColumns = containerWidth > 860 ? 2 : 1;

  const selectedTask = props.selectedTask && !props.selectedTask.isSummary ? props.selectedTask : null;
  const selectedActivityId = selectedTask?.id;
  const predecessorDependencies = selectedActivityId
    ? props.dependencies.filter((dep) => dep.succId === selectedActivityId)
    : [];
  const successorDependencies = selectedActivityId
    ? props.dependencies.filter((dep) => dep.predId === selectedActivityId)
    : [];

  if (!selectedTask) {
    return (
      <div
        ref={ref}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          fontFamily: "Arial, sans-serif",
          color: "#666",
          fontSize: "0.95em",
          padding: "12px",
          textAlign: "center",
        }}
      >
        Select an activity to view relationships and resources.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #ddd",
          background: "#f5f5f5",
          paddingLeft: 8,
          flexShrink: 0,
          height: 28,
          gap: 0,
        }}
      >
        {TASK_DETAILS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "4px 10px",
              background: activeTab === tab.key ? "#fff" : "transparent",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #1e88e5" : "2px solid transparent",
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: "pointer",
              fontSize: "0.85em",
              fontFamily: "inherit",
              borderRadius: 0,
              color: "inherit",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {activeTab === "general" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
            {props.onUpdateTask ? (
              <ConstraintEditor
                task={selectedTask}
                onUpdateTask={props.onUpdateTask}
                diagnostics={props.diagnosticsMap?.[selectedTask.id] ?? []}
              />
            ) : null}
            <div style={{ padding: "10px 12px", fontSize: "0.9em", color: "#333", overflowY: "auto" }}>
              <div style={{ marginBottom: 6 }}>
                <strong>Activity</strong>
              </div>
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: "#666" }}>Name: </span>
                <span>{selectedTask.name}</span>
              </div>
              <div>
                <span style={{ color: "#666" }}>ID: </span>
                <span>{selectedTask.sourceActivityId?.trim() || selectedTask.activityCode?.trim() || selectedTask.id}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "relationships" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: relationshipColumns === 2 ? "1fr 1fr" : "1fr",
              gap: 0,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div style={{ minHeight: 0, minWidth: 0, overflow: "hidden", borderRight: relationshipColumns === 2 ? "1px solid #ddd" : "none" }}>
              <RelationshipTable
                title="Predecessors"
                direction="predecessor"
                dependencies={predecessorDependencies}
                tasks={props.tasks}
                scheduleResults={props.scheduleResults}
                projectStartDate={props.projectStartDate}
                emptyMessage="No predecessors for selected activity."
                onGoToTask={props.onGoToTask}
                onDeleteDependency={props.onDeleteDependency}
                canDeleteRelationships={props.canDeleteRelationships}
                deleteDisabledReason={props.relationshipDeleteDisabledReason}
                dependencyDiagnosticsMap={props.dependencyDiagnosticsMap}
              />
            </div>
            <div style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <RelationshipTable
                title="Successors"
                direction="successor"
                dependencies={successorDependencies}
                tasks={props.tasks}
                scheduleResults={props.scheduleResults}
                projectStartDate={props.projectStartDate}
                emptyMessage="No successors for selected activity."
                onGoToTask={props.onGoToTask}
                onDeleteDependency={props.onDeleteDependency}
                canDeleteRelationships={props.canDeleteRelationships}
                deleteDisabledReason={props.relationshipDeleteDisabledReason}
                dependencyDiagnosticsMap={props.dependencyDiagnosticsMap}
              />
            </div>
          </div>
        )}

        {activeTab === "resources" && (
          <ResourceList
            resources={props.resources}
            assignments={props.assignments}
            tasks={props.tasks}
            resourceName={props.resourceName}
            onResourceNameChange={props.onResourceNameChange}
            onAddResource={props.onAddResource}
            onDeleteResource={props.onDeleteResource}
            onAddAssignment={props.onAddAssignment}
            onDeleteAssignment={props.onDeleteAssignment}
            getTaskName={props.getTaskName}
          />
        )}
      </div>
    </div>
  );
}
