import type { ConstraintFilter } from "../../utils/filterByConstraint";

interface CommandToolbarProps {
  onImport: () => void;
  onLoadToWorkspace: () => void;
  onToggleInspector: () => void;
  onToggleDiagnostics: () => void;
  onConstraintFilterChange: (filter: ConstraintFilter) => void;
  hasPreview: boolean;
  hasLoadedData: boolean;
  inspectorOpen: boolean;
  diagnosticsOpen: boolean;
  constraintFilter: ConstraintFilter;
  workerReady: boolean;
}

export function CommandToolbar({
  onImport,
  onLoadToWorkspace,
  onToggleInspector,
  onToggleDiagnostics,
  onConstraintFilterChange,
  hasPreview,
  hasLoadedData,
  inspectorOpen,
  diagnosticsOpen,
  constraintFilter,
  workerReady,
}: CommandToolbarProps) {
  return (
    <div className="r3-command-toolbar">
      <button type="button" onClick={onImport} disabled={!workerReady}>Import XER/MSP</button>
      <button type="button" onClick={onLoadToWorkspace} disabled={!hasPreview}>Load to Workspace</button>
      <button type="button" onClick={onToggleInspector} disabled={!hasLoadedData}>
        {inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
      </button>
      <button type="button" onClick={onToggleDiagnostics}>
        {diagnosticsOpen ? 'Hide Diagnostics' : 'Show Diagnostics'}
      </button>
      <label className="r3-command-toolbar-filter" htmlFor="r3-constraint-filter">
        <span>Constraint Filter</span>
        <select
          id="r3-constraint-filter"
          value={constraintFilter}
          onChange={(e) => onConstraintFilterChange(e.target.value as ConstraintFilter)}
        >
          <option value="all">All</option>
          <option value="constrained">Constrained</option>
          <option value="unconstrained">Unconstrained</option>
          <option value="SNET">SNET</option>
          <option value="FNLT">FNLT</option>
          <option value="MSO">MSO</option>
          <option value="MFO">MFO</option>
          <option value="ALAP">ALAP</option>
        </select>
      </label>
    </div>
  );
}
