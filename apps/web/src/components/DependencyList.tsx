import type { Dependency, DependencyType, Task } from "protocol";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import { type GridColumn, ColumnResizer, useColumnResize } from "../hooks/useColumnResize";

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/* ── P6-style density constants ─────────────────────────────────── */
const DEP_COLUMNS: GridColumn[] = [
  { key: "pred", initWidth: 120 },
  { key: "succ", initWidth: 120 },
  { key: "rel", initWidth: 48 },
  { key: "lag", initWidth: 40 },
  { key: "action", initWidth: 24, minWidth: 24 },
];
const GRID_COLS = "var(--grid-cols)";
const ROW_H = 24;
const HDR_H = 24;
const FONT = 11;
const BORDER = "#c8c8c8";      // stronger P6-style gridlines
const BG_HDR = "#eceef1";      // flat header band
const BG_ALT = "#f9f9fb";      // subtle alternating hint (used on add-row)
const BG_HOVER = "#dde4f0";

/* ── Shared cell style with vertical gridlines ──────────────────── */
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

const lagInput: CSSProperties = {
  ...ctrl,
  textAlign: "right",
  padding: "0 3px",
};

/* ── DependencyRow ──────────────────────────────────────────────── */

interface RowProps {
  dep: Dependency;
  getTaskName: (id: string) => string;
  onUpdateType: (depId: string, type: DependencyType) => void;
  onUpdateLag: (depId: string, lag: number) => void;
  onDelete: (depId: string) => void;
}

function DependencyRow({ dep, getTaskName, onUpdateType, onUpdateLag, onDelete }: RowProps) {
  const [lagDraft, setLagDraft] = useState(String(dep.lag));
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);

  const commitLag = useCallback(() => {
    setEditing(false);
    const parsed = Number(lagDraft);
    if (Number.isFinite(parsed) && parsed !== dep.lag) {
      onUpdateLag(dep.id, parsed);
    } else {
      setLagDraft(String(dep.lag));
    }
  }, [lagDraft, dep.id, dep.lag, onUpdateLag]);

  const handleLagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitLag();
      if (e.key === "Escape") { setLagDraft(String(dep.lag)); setEditing(false); }
    },
    [commitLag, dep.lag],
  );

  const displayLag = editing ? lagDraft : String(dep.lag);
  const predName = getTaskName(dep.predId);
  const succName = getTaskName(dep.succId);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        background: hovered ? BG_HOVER : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={cell} title={predName}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{predName}</span>
      </div>
      <div style={cell} title={succName}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{succName}</span>
      </div>
      <div style={{ ...cell, justifyContent: "center" }}>
        <select
          value={dep.type}
          onChange={(e) => onUpdateType(dep.id, e.target.value as DependencyType)}
          style={ctrl}
        >
          {DEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ ...cell, justifyContent: "center" }}>
        <input
          type="number"
          value={displayLag}
          onChange={(e) => { setEditing(true); setLagDraft(e.target.value); }}
          onBlur={commitLag}
          onKeyDown={handleLagKeyDown}
          style={lagInput}
        />
      </div>
      <div style={{ ...cell, justifyContent: "center", borderRight: "none" }}>
        <button
          onClick={() => onDelete(dep.id)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#c00",
            fontWeight: 600,
            fontSize: 11,
            padding: 0,
            lineHeight: 1,
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.1s",
          }}
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ── Footer add-row ─────────────────────────────────────────────── */

interface AddRowProps {
  tasks: readonly Task[];
  onAdd: (predId: string, succId: string, type: DependencyType, lag: number) => void;
}

function AddFooter({ tasks, onAdd }: AddRowProps) {
  const [predId, setPredId] = useState("");
  const [succId, setSuccId] = useState("");
  const [type, setType] = useState<DependencyType>("FS");
  const [lag, setLag] = useState("0");

  const canAdd = predId !== "" && succId !== "" && predId !== succId;

  const handleAdd = () => {
    if (!canAdd) return;
    const parsed = Number(lag);
    onAdd(predId, succId, type, Number.isFinite(parsed) ? parsed : 0);
    setPredId(""); setSuccId(""); setType("FS"); setLag("0");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canAdd) handleAdd();
  };

  return (
    <div
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        borderTop: `1px solid ${BORDER}`,
        background: BG_ALT,
        overflowY: "auto",
        scrollbarGutter: "stable",
      }}
    >
      <div style={{ ...cell, borderBottom: "none" }}>
        <select value={predId} onChange={(e) => setPredId(e.target.value)} style={ctrl}>
          <option value="">Pred…</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ ...cell, borderBottom: "none" }}>
        <select value={succId} onChange={(e) => setSuccId(e.target.value)} style={ctrl}>
          <option value="">Succ…</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ ...cell, borderBottom: "none", justifyContent: "center" }}>
        <select value={type} onChange={(e) => setType(e.target.value as DependencyType)} style={ctrl}>
          {DEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ ...cell, borderBottom: "none", justifyContent: "center" }}>
        <input
          type="number"
          value={lag}
          onChange={(e) => setLag(e.target.value)}
          onKeyDown={handleKeyDown}
          style={lagInput}
        />
      </div>
      <div style={{ ...cell, borderBottom: "none", borderRight: "none", justifyContent: "center" }}>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: 0,
            width: 18,
            height: 18,
            lineHeight: "18px",
            textAlign: "center",
            cursor: canAdd ? "pointer" : "default",
            border: `1px solid ${BORDER}`,
            borderRadius: 0,
            background: canAdd ? "#fff" : "#f0f0f0",
            color: canAdd ? "#1976d2" : "#aaa",
          }}
          title="Add dependency"
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ── DependencyList ─────────────────────────────────────────────── */

type Props = {
  dependencies: readonly Dependency[];
  tasks: readonly Task[];
  getTaskName: (id: string) => string;
  onUpdateType: (depId: string, type: DependencyType) => void;
  onUpdateLag: (depId: string, lag: number) => void;
  onDelete: (depId: string) => void;
  onAdd: (predId: string, succId: string, type: DependencyType, lag: number) => void;
};

export function DependencyList({
  dependencies,
  tasks,
  getTaskName,
  onUpdateType,
  onUpdateLag,
  onDelete,
  onAdd,
}: Props) {
  const { containerRef, startResize } = useColumnResize(DEP_COLUMNS);
  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden", borderLeft: `1px solid ${BORDER}` }}>
      {/* ── Flat toolbar ─────────────────────────────────────── */}
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
        Dependencies
        <span style={{ marginLeft: 4, fontWeight: 400, color: "#888", fontSize: 10 }}>
          ({dependencies.length})
        </span>
      </div>

      {/* ── Pinned column header ─────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          overflowY: "auto",
          scrollbarGutter: "stable",
        }}
      >
        <div style={{ ...hdrCell, position: "relative", overflow: "visible" }}>
          Predecessor
          <ColumnResizer index={0} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, position: "relative", overflow: "visible" }}>
          Successor
          <ColumnResizer index={1} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, justifyContent: "center", position: "relative", overflow: "visible" }}>
          Rel
          <ColumnResizer index={2} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, justifyContent: "center", position: "relative", overflow: "visible" }}>
          Lag
          <ColumnResizer index={3} startResize={startResize} />
        </div>
        <div style={{ ...hdrCell, borderRight: "none" }} />
      </div>

      {/* ── Scrollable grid body ─────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable" }}>
        {dependencies.length === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS }}>
            <div style={{ ...cell, gridColumn: "1 / -1", color: "#999", fontStyle: "italic", borderRight: "none" }}>
              No dependencies
            </div>
          </div>
        )}
        {dependencies.map((dep) => (
          <DependencyRow
            key={dep.id}
            dep={dep}
            getTaskName={getTaskName}
            onUpdateType={onUpdateType}
            onUpdateLag={onUpdateLag}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* ── Bottom footer action bar ─────────────────────────── */}
      <AddFooter tasks={tasks} onAdd={onAdd} />
    </div>
  );
}
