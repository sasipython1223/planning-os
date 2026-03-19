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
  error: "#d32f2f",
  warning: "#ed6c02",
  info: "#0288d1",
};

const SEVERITY_LABELS: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export function ImportPreviewPanel({ data, onImport, onCancel }: ImportPreviewPanelProps) {
  const { projectName, projectStartDate, format, summary, diagnostics, diagnosticsSummary, canCommit } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24, maxWidth: 560, width: "100%" }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Import Preview</h2>

      {/* Project info */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>Project:</span>
        <span>{projectName}</span>
        <span style={{ fontWeight: 600 }}>Start Date:</span>
        <span>{projectStartDate}</span>
        <span style={{ fontWeight: 600 }}>Format:</span>
        <span>{format.toUpperCase()}</span>
      </div>

      {/* Entity counts */}
      <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
        <span><strong>{summary.taskCount}</strong> Tasks</span>
        <span><strong>{summary.dependencyCount}</strong> Dependencies</span>
        <span><strong>{summary.resourceCount}</strong> Resources</span>
        <span><strong>{summary.assignmentCount}</strong> Assignments</span>
      </div>
      {summary.calendarInfo && (
        <div style={{ fontSize: 12, color: "#666" }}>Calendar: {summary.calendarInfo}</div>
      )}

      {/* Diagnostics summary */}
      {(diagnosticsSummary.errors > 0 || diagnosticsSummary.warnings > 0 || diagnosticsSummary.infos > 0) && (
        <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
          {diagnosticsSummary.errors > 0 && (
            <span style={{ color: SEVERITY_COLORS.error, fontWeight: 600 }}>
              {diagnosticsSummary.errors} error{diagnosticsSummary.errors !== 1 ? "s" : ""}
            </span>
          )}
          {diagnosticsSummary.warnings > 0 && (
            <span style={{ color: SEVERITY_COLORS.warning, fontWeight: 600 }}>
              {diagnosticsSummary.warnings} warning{diagnosticsSummary.warnings !== 1 ? "s" : ""}
            </span>
          )}
          {diagnosticsSummary.infos > 0 && (
            <span style={{ color: SEVERITY_COLORS.info, fontWeight: 600 }}>
              {diagnosticsSummary.infos} info{diagnosticsSummary.infos !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Diagnostic list */}
      {diagnostics.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}>
          {diagnostics.map((d, i) => (
            <div
              key={`${d.code}-${d.sourceEntityId ?? ""}-${i}`}
              style={{
                padding: "4px 8px",
                borderBottom: i < diagnostics.length - 1 ? "1px solid #eee" : undefined,
                display: "flex",
                gap: 8,
                alignItems: "baseline",
              }}
            >
              <span style={{ color: SEVERITY_COLORS[d.severity], fontWeight: 600, flexShrink: 0 }}>
                {SEVERITY_LABELS[d.severity]}
              </span>
              <span style={{ fontFamily: "monospace", color: "#888", flexShrink: 0 }}>{d.code}</span>
              <span>{d.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cannot commit warning */}
      {!canCommit && (
        <div style={{ color: SEVERITY_COLORS.error, fontSize: 13, fontWeight: 600 }}>
          Import blocked — resolve errors before importing.
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            height: 32,
            padding: "0 16px",
            fontSize: 13,
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#fff",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={!canCommit}
          style={{
            height: 32,
            padding: "0 16px",
            fontSize: 13,
            cursor: canCommit ? "pointer" : "not-allowed",
            border: "none",
            borderRadius: 4,
            background: canCommit ? "#1976d2" : "#bbb",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Import
        </button>
      </div>
    </div>
  );
}
