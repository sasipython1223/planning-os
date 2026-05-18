import type { ImportDiagnostic, ImportDiagnosticsSummary, ImportFormat, ImportSummary } from "protocol";

export interface ImportPreviewData {
  readonly projectName: string;
  readonly projectStartDate: string;
  readonly format: ImportFormat;
  readonly summary: ImportSummary;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly diagnosticsSummary: ImportDiagnosticsSummary;
  readonly canCommit: boolean;
}

interface ImportPreviewPanelProps {
  data: ImportPreviewData;
  onImport: () => void;
  onCancel: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: "#c62828",
  warning: "#e65100",
  info: "#01579b",
};

const SEVERITY_LABELS: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const FORMAT_LABELS: Record<string, string> = {
  "xer": "Primavera P6 XER",
  "msp-xml": "MS Project XML",
};

export function ImportPreviewPanel({ data, onImport, onCancel }: ImportPreviewPanelProps) {
  const { projectName, projectStartDate, format, summary, diagnostics, diagnosticsSummary, canCommit } = data;

  const hasIssues = diagnosticsSummary.errors > 0 || diagnosticsSummary.warnings > 0 || diagnosticsSummary.infos > 0;

  return (
    <div className="r4-import-preview-panel">
      {/* Header */}
      <div className="r4-import-preview-header">
        <h2 className="r4-import-preview-title">Import Preview</h2>
        <span className="r4-import-format-badge">{FORMAT_LABELS[format] ?? format.toUpperCase()}</span>
      </div>

      {/* Programme details */}
      <section className="r4-import-preview-section">
        <h3 className="r4-import-preview-section-title">Programme Details</h3>
        <div className="r4-import-detail-grid">
          <span className="r4-detail-label">Project Name</span>
          <span className="r4-detail-value">{projectName}</span>
          <span className="r4-detail-label">Start Date</span>
          <span className="r4-detail-value">{projectStartDate}</span>
          <span className="r4-detail-label">Source Format</span>
          <span className="r4-detail-value">{FORMAT_LABELS[format] ?? format.toUpperCase()}</span>
        </div>
      </section>

      {/* Schedule summary */}
      <section className="r4-import-preview-section">
        <h3 className="r4-import-preview-section-title">Schedule Summary</h3>
        <div className="r4-import-counts">
          <div className="r4-count-item">
            <span className="r4-count-value">{summary.taskCount}</span>
            <span className="r4-count-label">Activities</span>
          </div>
          <div className="r4-count-item">
            <span className="r4-count-value">{summary.dependencyCount}</span>
            <span className="r4-count-label">Relationships</span>
          </div>
          <div className="r4-count-item">
            <span className="r4-count-value">{summary.resourceCount}</span>
            <span className="r4-count-label">Resources</span>
          </div>
          <div className="r4-count-item">
            <span className="r4-count-value">{summary.assignmentCount}</span>
            <span className="r4-count-label">Assignments</span>
          </div>
        </div>
        {summary.calendarInfo && (
          <div className="r4-calendar-info">Calendar: {summary.calendarInfo}</div>
        )}
      </section>

      {/* Diagnostics */}
      {(hasIssues || diagnostics.length > 0) && (
        <section className="r4-import-preview-section">
          <h3 className="r4-import-preview-section-title">Import Diagnostics</h3>
          <div className="r4-diagnostics-summary">
            {diagnosticsSummary.errors > 0 && (
              <span className="r4-diag-badge r4-diag-badge--error">
                {diagnosticsSummary.errors} error{diagnosticsSummary.errors !== 1 ? 's' : ''}
              </span>
            )}
            {diagnosticsSummary.warnings > 0 && (
              <span className="r4-diag-badge r4-diag-badge--warning">
                {diagnosticsSummary.warnings} warning{diagnosticsSummary.warnings !== 1 ? 's' : ''}
              </span>
            )}
            {diagnosticsSummary.infos > 0 && (
              <span className="r4-diag-badge r4-diag-badge--info">
                {diagnosticsSummary.infos} info{diagnosticsSummary.infos !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {diagnostics.length > 0 && (
            <div className="r4-diagnostics-list">
              {diagnostics.map((d, i) => (
                <div
                  key={`${d.code}-${d.sourceEntityId ?? ""}-${i}`}
                  className="r4-diagnostic-item"
                >
                  <span className="r4-diag-severity" style={{ color: SEVERITY_COLORS[d.severity] }}>
                    {SEVERITY_LABELS[d.severity]}
                  </span>
                  <span className="r4-diag-code">{d.code}</span>
                  <span className="r4-diag-message">{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Blocked notice */}
      {!canCommit && (
        <div className="r4-import-blocked-notice">
          ⚠ Import blocked — resolve errors before loading to workspace.
        </div>
      )}

      {/* Actions */}
      <div className="r4-import-actions">
        <button
          type="button"
          className="r4-btn r4-btn--cancel"
          onClick={onCancel}
        >
          ✕ Cancel Import
        </button>
        <button
          type="button"
          className="r4-btn r4-btn--load"
          onClick={onImport}
          disabled={!canCommit}
          title={canCommit ? 'Load this programme into the workspace' : 'Resolve import errors before loading'}
        >
          ✓ Load to Workspace
        </button>
      </div>
    </div>
  );
}
