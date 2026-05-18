import type { ImportStatus } from "../../ui/state/uiViewState";
import type { ConstraintFilter } from "../../utils/filterByConstraint";

interface CommandToolbarProps {
  onImport: () => void;
  onLoadToWorkspace: () => void;
  onCancelPreview: () => void;
  onToggleInspector: () => void;
  onToggleDiagnostics: () => void;
  onConstraintFilterChange: (filter: ConstraintFilter) => void;
  hasPreview: boolean;
  hasLoadedData: boolean;
  inspectorOpen: boolean;
  diagnosticsOpen: boolean;
  constraintFilter: ConstraintFilter;
  workerReady: boolean;
  importStatus: ImportStatus;
  importFormat?: string;
  importErrorCount?: number;
  importWarningCount?: number;
  importCanCommit: boolean;
}

const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  idle: 'No file selected',
  'preview-ready': 'Preview ready',
  warnings: 'Preview ready (warnings)',
  failed: 'Import blocked — errors found',
};

const IMPORT_STATUS_CLASS: Record<ImportStatus, string> = {
  idle: 'r4-import-status--idle',
  'preview-ready': 'r4-import-status--ready',
  warnings: 'r4-import-status--warnings',
  failed: 'r4-import-status--failed',
};

export function CommandToolbar({
  onImport,
  onLoadToWorkspace,
  onCancelPreview,
  onToggleInspector,
  onToggleDiagnostics,
  onConstraintFilterChange,
  hasPreview,
  hasLoadedData,
  inspectorOpen,
  diagnosticsOpen,
  constraintFilter,
  workerReady,
  importStatus,
  importFormat,
  importErrorCount,
  importWarningCount,
  importCanCommit,
}: CommandToolbarProps) {
  return (
    <div className="r3-command-toolbar">
      {/* Import group */}
      <div className="r4-toolbar-import-group">
        <button
          type="button"
          className="r4-import-btn"
          onClick={onImport}
          disabled={!workerReady}
          title="Select a Primavera XER or MS Project XML file to import"
        >
          ↑ Import XER / MSP
        </button>

        {hasPreview && (
          <>
            {importFormat && (
              <span className="r4-import-format-badge">{importFormat}</span>
            )}
            <span className={`r4-import-status ${IMPORT_STATUS_CLASS[importStatus]}`}>
              {IMPORT_STATUS_LABELS[importStatus]}
              {(importErrorCount ?? 0) > 0 && (
                <span className="r4-import-count r4-import-count--error">
                  {importErrorCount} error{importErrorCount !== 1 ? 's' : ''}
                </span>
              )}
              {(importWarningCount ?? 0) > 0 && (
                <span className="r4-import-count r4-import-count--warning">
                  {importWarningCount} warning{importWarningCount !== 1 ? 's' : ''}
                </span>
              )}
            </span>
            <button
              type="button"
              className="r4-load-btn"
              onClick={onLoadToWorkspace}
              disabled={!importCanCommit}
              title={!importCanCommit ? 'Resolve import errors before loading' : 'Load this programme into the workspace'}
            >
              ✓ Load to Workspace
            </button>
            <button
              type="button"
              className="r4-cancel-btn"
              onClick={onCancelPreview}
              title="Cancel this import preview and return to empty workspace"
            >
              ✕ Cancel Preview
            </button>
          </>
        )}
      </div>

      {/* Workspace controls group */}
      <div className="r4-toolbar-workspace-group">
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
    </div>
  );
}
