import type { CSSProperties } from "react";
import type { SourcePlannerRecalculationReportViewModel } from "../services/sourcePlannerReportViewModel";

type SourcePlannerRecalculationReportPanelProps = {
  readonly viewModel: SourcePlannerRecalculationReportViewModel;
  readonly onClose: () => void;
};

const TABLE_CELL: CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "6px 8px",
  fontSize: 12,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

export function SourcePlannerRecalculationReportPanel({ viewModel, onClose }: SourcePlannerRecalculationReportPanelProps) {
  const { summary, rows } = viewModel;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Source vs Planner Recalculation Report"
      style={{
        width: "min(1400px, 98vw)",
        height: "min(820px, 94vh)",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>Source vs Planner Recalculation Report</strong>
          <span style={{ fontSize: 12, color: "#607d8b" }}>(Read-only diagnostics)</span>
        </div>
        <button onClick={onClose} style={{ border: "1px solid #cfd8dc", background: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Close</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid #e7d9ff", background: "#f8f2ff", borderRadius: 8, padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "6px 10px", fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>Project / Schedule</span><span data-testid="report-project-name">{summary.projectName}</span>
            <span style={{ fontWeight: 600 }}>Imported Source Rollup Finish</span><span data-testid="report-source-rollup-finish">{summary.importedSourceRollupFinish ?? "—"}</span>
            <span style={{ fontWeight: 600 }}>Project Must Finish By</span><span data-testid="report-must-finish-by">{summary.projectMustFinishBy ?? "—"}</span>
            <span style={{ fontWeight: 600 }}>Planner Rollup Finish</span><span data-testid="report-planner-rollup-finish">{summary.plannerRollupFinish ?? "—"}</span>
            <span style={{ fontWeight: 600 }}>Finish Movement</span><span data-testid="report-finish-movement">{summary.finishMovement}</span>
            <span style={{ fontWeight: 600 }}>Activities Compared</span><span data-testid="report-activities-compared">{summary.activitiesCompared}</span>
            <span style={{ fontWeight: 600 }}>Start Differences</span><span data-testid="report-start-differences">{summary.startDifferences}</span>
            <span style={{ fontWeight: 600 }}>Finish Differences</span><span data-testid="report-finish-differences">{summary.finishDifferences}</span>
            <span style={{ fontWeight: 600 }}>Major Variances</span><span data-testid="report-major-variances">{summary.majorVariances}</span>
            <span style={{ fontWeight: 600 }}>Calendar Risk Level</span><span data-testid="report-calendar-risk-level">{summary.calendarRiskLevel}</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#5b4080" }} data-testid="report-explanatory-text">
            {summary.explanatoryText}
          </div>
          {summary.highlightedDiagnostics.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Relevant diagnostics</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }} data-testid="report-diagnostics-list">
                {summary.highlightedDiagnostics.map((diag) => (
                  <li key={diag}>{diag}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "#fafafa", zIndex: 1 }}>
              <tr>
                <th style={TABLE_CELL}>Activity ID</th>
                <th style={TABLE_CELL}>Activity Name</th>
                <th style={TABLE_CELL}>WBS Path</th>
                <th style={TABLE_CELL}>Source Start</th>
                <th style={TABLE_CELL}>Planner Start</th>
                <th style={TABLE_CELL}>Start Variance</th>
                <th style={TABLE_CELL}>Source Finish</th>
                <th style={TABLE_CELL}>Planner Finish</th>
                <th style={TABLE_CELL}>Finish Variance</th>
                <th style={TABLE_CELL}>Source Duration</th>
                <th style={TABLE_CELL}>Planner Duration</th>
                <th style={TABLE_CELL}>Duration Variance</th>
                <th style={TABLE_CELL}>Source Total Float</th>
                <th style={TABLE_CELL}>Planner Total Float</th>
                <th style={TABLE_CELL}>Float Variance</th>
                <th style={TABLE_CELL}>Calendar ID</th>
                <th style={TABLE_CELL}>Calendar Name</th>
                <th style={TABLE_CELL}>Variance Reason Tag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.taskId} data-testid={`report-row-${row.taskId}`}>
                  <td style={TABLE_CELL}>{row.activityId}</td>
                  <td style={TABLE_CELL}>{row.activityName}</td>
                  <td style={TABLE_CELL}>{row.wbsPath ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.sourceStart ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.plannerStart ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.startVariance}</td>
                  <td style={TABLE_CELL}>{row.sourceFinish ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.plannerFinish ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.finishVariance}</td>
                  <td style={TABLE_CELL}>{row.sourceDuration ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.plannerDuration ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.durationVariance}</td>
                  <td style={TABLE_CELL}>{row.sourceTotalFloat ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.plannerTotalFloat ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.floatVariance}</td>
                  <td style={TABLE_CELL}>{row.calendarId ?? "—"}</td>
                  <td style={TABLE_CELL}>{row.calendarName ?? "—"}</td>
                  <td style={TABLE_CELL} title={row.reasonLabel}>{row.reasonTag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
