import type { Assignment, Resource, Task } from "protocol";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import { type GridColumn, ColumnResizer, useColumnResize } from "../hooks/useColumnResize";

/* ── P6-style density constants (matched to DependencyList) ─────── */
const RES_COLUMNS: GridColumn[] = [
  { key: "task", initWidth: 120 },
  { key: "resource", initWidth: 120 },
  { key: "units", initWidth: 60 },
];
const GRID_COLS = "var(--grid-cols)";
const ROW_H = 22;
const HDR_H = 24;
const FONT = 11;
const BORDER = "#c8c8c8";
const BG_HDR = "#eceef1";
const BG_ALT = "#f9f9fb";
const BG_HOVER = "#dde4f0";
const BG_SEL = "#ccd6e8";

/* ── Shared cell style with vertical + horizontal gridlines ──────── */
const cell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: ROW_H,
  padding: "0 4px",
  fontSize: FONT,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  boxSizing: "border-box",
  borderRight: `1px solid ${BORDER}`,
  borderBottom: `1px solid ${BORDER}`,
};

const hdrCell: CSSProperties = {
  ...cell,
  height: HDR_H,
  fontWeight: 600,
  fontSize: 10,
  color: "#555",
  background: BG_HDR,
  userSelect: "none",
};

const ctrl: CSSProperties = {
  height: 18,
  padding: "0 2px",
  fontSize: 10,
  border: `1px solid ${BORDER}`,
  borderRadius: 0,
  background: "#fff",
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
};

/* ── AssignmentRow ──────────────────────────────────────────────── */

interface RowProps {
  assignment: Assignment;
  taskName: string;
  resourceName: string;
  selected: boolean;
  onSelect: (id: string) => void;
}

function AssignmentRow({ assignment, taskName, resourceName, selected, onSelect }: RowProps) {
  const [hovered, setHovered] = useState(false);
  const bg = selected ? BG_SEL : hovered ? BG_HOVER : "transparent";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        background: bg,
        cursor: "pointer",
      }}
      onClick={() => onSelect(assignment.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={cell} title={taskName}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{taskName}</span>
      </div>
      <div style={cell} title={resourceName}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{resourceName}</span>
      </div>
      <div style={{ ...cell, justifyContent: "center", borderRight: "none" }}>
        {assignment.unitsPerDay}
      </div>
    </div>
  );
}

/* ── Footer ─────────────────────────────────────────────────────── */

interface FooterProps {
  tasks: readonly Task[];
  resources: readonly Resource[];
  resourceName: string;
  onResourceNameChange: (name: string) => void;
  onAddResource: () => void;
  onAddAssignment: (taskId: string, resourceId: string) => void;
  selectedId: string | null;
  onRemove: () => void;
}

function ResourceFooter({
  tasks,
  resources,
  resourceName,
  onResourceNameChange,
  onAddResource,
  onAddAssignment,
  selectedId,
  onRemove,
}: FooterProps) {
  const [taskId, setTaskId] = useState("");
  const [resId, setResId] = useState("");

  const canAssign = taskId !== "" && resId !== "";

  const handleAssign = () => {
    if (!canAssign) return;
    onAddAssignment(taskId, resId);
    setTaskId("");
    setResId("");
  };

  const handleAssignKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canAssign) handleAssign();
  };

  const canAddRes = resourceName.trim() !== "";

  const handleResKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canAddRes) onAddResource();
  };

  const btnPlus: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    padding: 0,
    width: 18,
    height: 18,
    lineHeight: "18px",
    textAlign: "center",
    border: `1px solid ${BORDER}`,
    borderRadius: 0,
    cursor: canAssign ? "pointer" : "default",
    background: canAssign ? "#fff" : "#f0f0f0",
    color: canAssign ? "#1976d2" : "#aaa",
  };

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${BORDER}` }}>
      {/* Row 1 — add assignment (grid matching body columns) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          background: BG_ALT,
          overflowY: "auto",
          scrollbarGutter: "stable",
        }}
      >
        <div style={{ ...cell, borderBottom: `1px solid ${BORDER}` }}>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)} onKeyDown={handleAssignKey} style={ctrl}>
            <option value="">Task…</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ ...cell, borderBottom: `1px solid ${BORDER}` }}>
          <select value={resId} onChange={(e) => setResId(e.target.value)} onKeyDown={handleAssignKey} style={ctrl}>
            <option value="">Resource…</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div style={{ ...cell, borderBottom: `1px solid ${BORDER}`, borderRight: "none", justifyContent: "center" }}>
          <button onClick={handleAssign} disabled={!canAssign} style={btnPlus} title="Assign resource">+</button>
        </div>
      </div>

      {/* Row 2 — add resource + remove assignment */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: ROW_H,
          padding: "0 4px",
          gap: 3,
          background: BG_ALT,
          fontSize: 10,
        }}
      >
        <input
          value={resourceName}
          onChange={(e) => onResourceNameChange(e.target.value)}
          onKeyDown={handleResKey}
          placeholder="New resource…"
          style={{ ...ctrl, flex: 1 }}
        />
        <button
          onClick={onAddResource}
          disabled={!canAddRes}
          style={{
            ...ctrl,
            width: "auto",
            padding: "0 5px",
            cursor: canAddRes ? "pointer" : "default",
            color: canAddRes ? "#1976d2" : "#aaa",
            fontWeight: 600,
          }}
        >
          +Res
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={onRemove}
          disabled={!selectedId}
          style={{
            ...ctrl,
            width: "auto",
            padding: "0 5px",
            cursor: selectedId ? "pointer" : "default",
            color: selectedId ? "#c00" : "#aaa",
            fontWeight: 600,
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/* ── ResourceList ───────────────────────────────────────────────── */

export type ResourceListProps = {
  resources: readonly Resource[];
  assignments: readonly Assignment[];
  tasks: readonly Task[];
  resourceName: string;
  onResourceNameChange: (name: string) => void;
  onAddResource: () => void;
  onDeleteResource: (id: string) => void;
  onAddAssignment: (taskId: string, resourceId: string) => void;
  onDeleteAssignment: (id: string) => void;
  getTaskName: (id: string) => string;
};

export function ResourceList({
  resources,
  assignments,
  tasks,
  resourceName,
  onResourceNameChange,
  onAddResource,
  onAddAssignment,
  onDeleteAssignment,
  getTaskName,
}: ResourceListProps) {
  const { containerRef, startResize } = useColumnResize(RES_COLUMNS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleRemove = useCallback(() => {
    if (selectedId) {
      onDeleteAssignment(selectedId);
      setSelectedId(null);
    }
  }, [selectedId, onDeleteAssignment]);

  const resNameMap = new Map(resources.map((r) => [r.id, r.name]));

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* ── Title bar ────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          height: HDR_H,
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
        Resources
        <span style={{ marginLeft: 4, fontWeight: 400, color: "#888", fontSize: 10 }}>
          ({assignments.length})
        </span>
      </div>

      {/* ── Pinned column header ─────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: GRID_COLS, overflowY: "auto", scrollbarGutter: "stable" }}>
        <div style={{ ...hdrCell, position: "relative", overflow: "visible" }}>
          Task
          <ColumnResizer index={0} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, position: "relative", overflow: "visible" }}>
          Resource
          <ColumnResizer index={1} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, justifyContent: "center", borderRight: "none" }}>Units/Day</div>
      </div>

      {/* ── Scrollable grid body ─────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable" }}>
        {assignments.length === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS }}>
            <div style={{ ...cell, gridColumn: "1 / -1", color: "#999", fontStyle: "italic", borderRight: "none" }}>
              No assignments
            </div>
          </div>
        )}
        {assignments.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            taskName={getTaskName(a.taskId)}
            resourceName={resNameMap.get(a.resourceId) ?? a.resourceId}
            selected={selectedId === a.id}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* ── Footer action bar ────────────────────────────────── */}
      <ResourceFooter
        tasks={tasks}
        resources={resources}
        resourceName={resourceName}
        onResourceNameChange={onResourceNameChange}
        onAddResource={onAddResource}
        onAddAssignment={onAddAssignment}
        selectedId={selectedId}
        onRemove={handleRemove}
      />
    </div>
  );
}
