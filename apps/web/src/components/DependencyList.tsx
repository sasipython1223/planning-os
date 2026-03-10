import type { Dependency, DependencyType, Task } from "protocol";
import { useCallback, useState } from "react";

/* ------------------------------------------------------------------ */
/*  DependencyRow — one existing dependency with inline editing        */
/* ------------------------------------------------------------------ */

type RowProps = {
  dep: Dependency;
  getTaskName: (id: string) => string;
  onUpdateType: (depId: string, type: DependencyType) => void;
  onUpdateLag: (depId: string, lag: number) => void;
  onDelete: (depId: string) => void;
};

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

function DependencyRow({ dep, getTaskName, onUpdateType, onUpdateLag, onDelete }: RowProps) {
  // Local transient state for lag editing — committed on blur/Enter
  const [lagDraft, setLagDraft] = useState(String(dep.lag));
  const [editing, setEditing] = useState(false);

  const commitLag = useCallback(() => {
    setEditing(false);
    const parsed = Number(lagDraft);
    if (Number.isFinite(parsed) && parsed !== dep.lag) {
      onUpdateLag(dep.id, parsed);
    } else {
      setLagDraft(String(dep.lag)); // revert on invalid
    }
  }, [lagDraft, dep.id, dep.lag, onUpdateLag]);

  const handleLagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitLag();
      if (e.key === "Escape") {
        setLagDraft(String(dep.lag));
        setEditing(false);
      }
    },
    [commitLag, dep.lag],
  );

  // Sync lagDraft when dep.lag changes externally (e.g. from Worker)
  // Use a ref-check to avoid resetting during active editing
  const displayLag = editing ? lagDraft : String(dep.lag);

  return (
    <tr>
      <td style={cellStyle}>{getTaskName(dep.predId)}</td>
      <td style={{ ...cellStyle, textAlign: "center" }}>→</td>
      <td style={cellStyle}>{getTaskName(dep.succId)}</td>
      <td style={cellStyle}>
        <select
          value={dep.type}
          onChange={(e) => onUpdateType(dep.id, e.target.value as DependencyType)}
          style={selectStyle}
        >
          {DEP_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={displayLag}
          onChange={(e) => { setEditing(true); setLagDraft(e.target.value); }}
          onBlur={commitLag}
          onKeyDown={handleLagKeyDown}
          style={lagInputStyle}
        />
      </td>
      <td style={cellStyle}>
        <button onClick={() => onDelete(dep.id)} style={deleteBtnStyle} title="Delete dependency">
          ✕
        </button>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  AddDependencyRow — local draft state, commits on "Add"             */
/* ------------------------------------------------------------------ */

type AddRowProps = {
  tasks: readonly Task[];
  onAdd: (predId: string, succId: string, type: DependencyType, lag: number) => void;
};

function AddDependencyRow({ tasks, onAdd }: AddRowProps) {
  const [predId, setPredId] = useState("");
  const [succId, setSuccId] = useState("");
  const [type, setType] = useState<DependencyType>("FS");
  const [lag, setLag] = useState("0");

  const canAdd = predId !== "" && succId !== "" && predId !== succId;

  const handleAdd = () => {
    if (!canAdd) return;
    const parsed = Number(lag);
    onAdd(predId, succId, type, Number.isFinite(parsed) ? parsed : 0);
    // Reset after add
    setPredId("");
    setSuccId("");
    setType("FS");
    setLag("0");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canAdd) handleAdd();
  };

  return (
    <tr>
      <td style={cellStyle}>
        <select value={predId} onChange={(e) => setPredId(e.target.value)} style={selectStyle}>
          <option value="">Pred…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>→</td>
      <td style={cellStyle}>
        <select value={succId} onChange={(e) => setSuccId(e.target.value)} style={selectStyle}>
          <option value="">Succ…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td style={cellStyle}>
        <select value={type} onChange={(e) => setType(e.target.value as DependencyType)} style={selectStyle}>
          {DEP_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={lag}
          onChange={(e) => setLag(e.target.value)}
          onKeyDown={handleKeyDown}
          style={lagInputStyle}
        />
      </td>
      <td style={cellStyle}>
        <button onClick={handleAdd} disabled={!canAdd} style={addBtnStyle} title="Add dependency">
          Add
        </button>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  DependencyList — composed table of rows + add row                  */
/* ------------------------------------------------------------------ */

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
  return (
    <div>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "1em" }}>Dependencies</h3>
      <table style={{ borderCollapse: "collapse", fontSize: "0.9em", width: "100%" }}>
        <thead>
          <tr>
            <th style={thStyle}>Predecessor</th>
            <th style={{ ...thStyle, width: 24 }}></th>
            <th style={thStyle}>Successor</th>
            <th style={{ ...thStyle, width: 60 }}>Type</th>
            <th style={{ ...thStyle, width: 60 }}>Lag</th>
            <th style={{ ...thStyle, width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {dependencies.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...cellStyle, color: "#999", fontStyle: "italic" }}>
                No dependencies
              </td>
            </tr>
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
          <AddDependencyRow tasks={tasks} onAdd={onAdd} />
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Minimal inline styles                                              */
/* ------------------------------------------------------------------ */

const cellStyle: React.CSSProperties = {
  padding: "2px 4px",
  verticalAlign: "middle",
};

const thStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "1px solid #ddd",
};

const selectStyle: React.CSSProperties = {
  padding: "2px 4px",
  fontSize: "0.9em",
};

const lagInputStyle: React.CSSProperties = {
  width: 48,
  padding: "2px 4px",
  fontSize: "0.9em",
  textAlign: "right",
};

const deleteBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#c00",
  fontWeight: "bold",
  fontSize: "1em",
};

const addBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: "0.85em",
  cursor: "pointer",
};
