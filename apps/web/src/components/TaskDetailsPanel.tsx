import type { Assignment, ConstraintDiagnosticCode, ConstraintType, Dependency, DependencyType, DiagnosticSeverity, DiagnosticsMap, Resource, Task } from "protocol";
import { SEVERITY_RANK } from "protocol";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import { DependencyList } from "./DependencyList";
import { ResourceList } from "./ResourceList";

/* ------------------------------------------------------------------ */
/*  Panel shell — fixed header + scrollable body                       */
/* ------------------------------------------------------------------ */

const panelContainer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};

/* ------------------------------------------------------------------ */
/*  DependenciesPanelWrapper — panel shell around DependencyList        */
/* ------------------------------------------------------------------ */

interface DepsPanelProps {
  dependencies: readonly Dependency[];
  tasks: readonly Task[];
  getTaskName: (id: string) => string;
  onUpdateType: (depId: string, type: DependencyType) => void;
  onUpdateLag: (depId: string, lag: number) => void;
  onDelete: (depId: string) => void;
  onAdd: (predId: string, succId: string, type: DependencyType, lag: number) => void;
}

function DependenciesPanel({
  dependencies,
  tasks,
  getTaskName,
  onUpdateType,
  onUpdateLag,
  onDelete,
  onAdd,
}: DepsPanelProps) {
  return (
    <div style={panelContainer}>
      <DependencyList
        dependencies={dependencies}
        tasks={tasks}
        getTaskName={getTaskName}
        onUpdateType={onUpdateType}
        onUpdateLag={onUpdateLag}
        onDelete={onDelete}
        onAdd={onAdd}
      />
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
  onUpdateTask: (taskId: string, updates: { constraintType?: ConstraintType; constraintDate?: number | null }) => void;
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
                ...(!nextDated ? { constraintDate: null } : {}),
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
              value={task.constraintDate ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return;
                onUpdateTask(task.id, { constraintDate: n });
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
/*  TaskDetailsPanel — responsive 2-column grid                        */
/* ------------------------------------------------------------------ */

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
  selectedTask?: Task | null;
  onUpdateTask?: (taskId: string, updates: { constraintType?: ConstraintType; constraintDate?: number | null }) => void;
  diagnosticsMap?: DiagnosticsMap;
}

/**
 * Task Details tab content — responsive grid hosting Dependencies + Resources.
 * Parent drawer controls outer height; panels scroll internally.
 */
export function TaskDetailsPanel(props: TaskDetailsPanelProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Stack when narrower than 500px
  const columns = containerWidth > 500 ? 2 : 1;

  const selectedTask = props.selectedTask && !props.selectedTask.isSummary ? props.selectedTask : null;

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
      {selectedTask && props.onUpdateTask && (
        <ConstraintEditor
          task={selectedTask}
          onUpdateTask={props.onUpdateTask}
          diagnostics={props.diagnosticsMap?.[selectedTask.id] ?? []}
        />
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns === 2 ? "1fr 1fr" : "1fr",
          gap: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
      <div style={{ minHeight: 0, minWidth: 0, overflow: "hidden", borderRight: columns === 2 ? "1px solid #ddd" : "none" }}>
        <DependenciesPanel
          dependencies={props.dependencies}
          tasks={props.tasks}
          getTaskName={props.getTaskName}
          onUpdateType={props.onUpdateDependencyType}
          onUpdateLag={props.onUpdateDependencyLag}
          onDelete={props.onDeleteDependency}
          onAdd={props.onAddDependency}
        />
      </div>
      <div style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>
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
      </div>
      </div>
    </div>
  );
}
