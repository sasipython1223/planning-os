import type { ImportDiagnostic, ImportDiagnosticCode, ImportDiagnosticsSummary, ImportFormat, ImportSummary, SourceProjectSettings } from "@planner/protocol";
import { CALENDAR_DIAGNOSTIC_CODES, classifyCalendarRisk, RISK_LEVEL_COLOR, RISK_LEVEL_LABEL } from "../services/calendarRisk.js";

export interface ImportPreviewData {
  readonly projectName: string;
  readonly projectStartDate: string;
  readonly format: ImportFormat;
  readonly sourceFileName?: string;
  readonly summary: ImportSummary;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly diagnosticsSummary: ImportDiagnosticsSummary;
  readonly canCommit: boolean;
  /** W4.3: Project-level default settings preserved from the source file. */
  readonly sourceProjectSettings?: SourceProjectSettings;
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
  const { projectName, projectStartDate, format, sourceFileName, summary, diagnostics, diagnosticsSummary, canCommit, sourceProjectSettings } = data;

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
        {sourceFileName && (
          <>
            <span style={{ fontWeight: 600 }}>File:</span>
            <span>{sourceFileName}</span>
          </>
        )}
        {summary.sourceDataDate && (
          <>
            <span style={{ fontWeight: 600 }}>Source Data Date:</span>
            <span>{summary.sourceDataDate}</span>
          </>
        )}
        {summary.sourceStatusDate && (
          <>
            <span style={{ fontWeight: 600 }}>Source Status Date:</span>
            <span>{summary.sourceStatusDate}</span>
          </>
        )}
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
      {(summary.activitiesWithActuals !== undefined || summary.activitiesWithProgress !== undefined) && (
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
          {summary.activitiesWithActuals !== undefined && (
            <span><strong>{summary.activitiesWithActuals}</strong> activities with source actuals</span>
          )}
          {summary.activitiesWithProgress !== undefined && (
            <span><strong>{summary.activitiesWithProgress}</strong> activities with source progress</span>
          )}
          {summary.activitiesWithRemainingDuration !== undefined && (
            <span><strong>{summary.activitiesWithRemainingDuration}</strong> activities with remaining duration</span>
          )}
        </div>
      )}

      {/* W3D: Calendar fidelity + risk summary */}
      {summary.calendarFidelity && (() => {
        const fidelity = summary.calendarFidelity!;
        const calDiags = diagnostics.filter(d => CALENDAR_DIAGNOSTIC_CODES.has(d.code as ImportDiagnosticCode));
        const risk = classifyCalendarRisk(fidelity, diagnostics);
        const riskColor = RISK_LEVEL_COLOR[risk.level];
        return (
          <div
            data-testid="calendar-fidelity-section"
            style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, borderTop: "1px solid #eee", paddingTop: 10 }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>Calendar Fidelity</div>

            {/* Counts */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "#555" }}>
              <span data-testid="cal-total"><strong>{fidelity.totalCalendars}</strong> calendar{fidelity.totalCalendars !== 1 ? "s" : ""} imported</span>
              {fidelity.taskCalendarAssignments > 0 && (
                <span data-testid="cal-task-assignments"><strong>{fidelity.taskCalendarAssignments}</strong> task calendar assignments</span>
              )}
              {fidelity.resourceCalendarAssignments > 0 && (
                <span data-testid="cal-resource-assignments"><strong>{fidelity.resourceCalendarAssignments}</strong> resource calendar assignments</span>
              )}
              {fidelity.exceptionCount > 0 && (
                <span data-testid="cal-exceptions"><strong>{fidelity.exceptionCount}</strong> exception days</span>
              )}
              {fidelity.calendarsWithInheritance > 0 && (
                <span data-testid="cal-inheritance"><strong>{fidelity.calendarsWithInheritance}</strong> with inheritance</span>
              )}
              {(fidelity.unresolvedInheritanceCount ?? 0) > 0 && (
                <span data-testid="cal-unresolved-inheritance" style={{ color: "#d32f2f" }}>
                  <strong>{fidelity.unresolvedInheritanceCount}</strong> unresolved inheritance
                </span>
              )}
              {fidelity.calendarsSimplifiedForEngine > 0 && (
                <span data-testid="cal-simplified"><strong>{fidelity.calendarsSimplifiedForEngine}</strong> simplified for engine</span>
              )}
            </div>

            {/* Risk badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#555" }}>Recalculation risk:</span>
              <span
                data-testid="cal-risk-level"
                style={{ fontWeight: 700, color: riskColor }}
              >
                {RISK_LEVEL_LABEL[risk.level]}
              </span>
            </div>

            {/* Risk warning for high/medium */}
            {(risk.level === "high" || risk.level === "medium") && (
              <div
                data-testid="cal-risk-warning"
                style={{
                  padding: "6px 10px",
                  borderRadius: 4,
                  background: risk.level === "high" ? "#fff3f3" : "#fff8ee",
                  border: `1px solid ${riskColor}`,
                  color: riskColor,
                  fontSize: 12,
                }}
              >
                {risk.reason}
              </div>
            )}

            {/* Source preservation notice */}
            <div style={{ color: "#888", fontStyle: "italic" }}>
              Imported source dates are preserved. Rich calendars are preserved for audit/import fidelity.
            </div>
            <div style={{ color: "#888", fontStyle: "italic" }}>
              Planner-Studio recalculation does not yet use all imported task/resource/lag calendars.
              {(risk.level === "high" || risk.level === "medium") && " If recalculated, dates may vary where these risks exist."}
            </div>

            {/* Calendar-specific diagnostics grouped summary */}
            {calDiags.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 600, color: "#555", marginBottom: 2 }}>Calendar notices</div>
                <div
                  data-testid="cal-diagnostic-group"
                  style={{ maxHeight: 120, overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: 4 }}
                >
                  {calDiags.map((d, i) => (
                    <div
                      key={`cal-diag-${d.code}-${d.sourceEntityId ?? ""}-${i}`}
                      style={{
                        padding: "3px 8px",
                        borderBottom: i < calDiags.length - 1 ? "1px solid #f0f0f0" : undefined,
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: RISK_LEVEL_COLOR[d.severity === "error" ? "high" : d.severity === "warning" ? "medium" : "low"], fontWeight: 600, flexShrink: 0 }}>
                        {d.severity === "error" ? "Error" : d.severity === "warning" ? "Warn" : "Info"}
                      </span>
                      <span style={{ fontFamily: "monospace", color: "#888", flexShrink: 0 }}>{d.code}</span>
                      <span style={{ color: "#555" }}>{d.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* W4.3: Project default settings section */}
      {sourceProjectSettings && (() => {
        const s = sourceProjectSettings;
        const hasHoursPeriod = s.hoursPerDay !== undefined || s.hoursPerWeek !== undefined || s.hoursPerMonth !== undefined
          || s.minutesPerDay !== undefined || s.minutesPerWeek !== undefined || s.daysPerMonth !== undefined;
        const hasCalendarInfo = s.defaultCalendarName || s.defaultCalendarId || s.defaultCalendarUID;
        const hasScheduleOptions = s.rawScheduleOptions != null
          || s.outOfSequenceProgressMode !== undefined
          || s.criticalFloatThreshold !== undefined
          || s.useExpectedFinishDates !== undefined
          || s.scheduleFrom !== undefined;

        if (!hasHoursPeriod && !hasCalendarInfo && !hasScheduleOptions && !s.mustFinishBy) return null;

        return (
          <div
            data-testid="project-settings-section"
            style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, borderTop: "1px solid #eee", paddingTop: 10 }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>Project Default Settings (Preserved)</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", color: "#555" }}>
              {hasCalendarInfo && (
                <>
                  <span style={{ fontWeight: 600 }}>Default Calendar:</span>
                  <span data-testid="ps-default-calendar">{s.defaultCalendarName ?? s.defaultCalendarId ?? s.defaultCalendarUID}</span>
                </>
              )}
              {s.mustFinishBy && (
                <>
                  <span style={{ fontWeight: 600 }}>Must Finish By:</span>
                  <span data-testid="ps-must-finish-by">{s.mustFinishBy}</span>
                </>
              )}
              {s.hoursPerDay !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Hours/Day:</span>
                  <span data-testid="ps-hours-per-day">{s.hoursPerDay}h</span>
                </>
              )}
              {s.hoursPerWeek !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Hours/Week:</span>
                  <span data-testid="ps-hours-per-week">{s.hoursPerWeek}h</span>
                </>
              )}
              {s.hoursPerMonth !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Hours/Month:</span>
                  <span data-testid="ps-hours-per-month">{s.hoursPerMonth}h</span>
                </>
              )}
              {s.minutesPerDay !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Minutes/Day:</span>
                  <span data-testid="ps-minutes-per-day">{s.minutesPerDay} min</span>
                </>
              )}
              {s.minutesPerWeek !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Minutes/Week:</span>
                  <span data-testid="ps-minutes-per-week">{s.minutesPerWeek} min</span>
                </>
              )}
              {s.daysPerMonth !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Days/Month:</span>
                  <span data-testid="ps-days-per-month">{s.daysPerMonth}</span>
                </>
              )}
              {s.scheduleFrom && (
                <>
                  <span style={{ fontWeight: 600 }}>Schedule From:</span>
                  <span data-testid="ps-schedule-from">{s.scheduleFrom}</span>
                </>
              )}
              {s.criticalFloatThreshold !== undefined && (
                <>
                  <span style={{ fontWeight: 600 }}>Critical Float Threshold:</span>
                  <span data-testid="ps-critical-float">{s.criticalFloatThreshold}d</span>
                </>
              )}
              {s.outOfSequenceProgressMode && (
                <>
                  <span style={{ fontWeight: 600 }}>Out-of-Sequence:</span>
                  <span data-testid="ps-oos-progress">{s.outOfSequenceProgressMode}</span>
                </>
              )}
            </div>
            {hasScheduleOptions && (
              <div
                data-testid="ps-schedule-options-notice"
                style={{
                  padding: "5px 8px",
                  borderRadius: 4,
                  background: "#fff8ee",
                  border: "1px solid #ed6c02",
                  color: "#b26000",
                  fontSize: 11,
                }}
              >
                Schedule options preserved but inactive — Planner-Studio recalculation may differ until these settings are active in the engine.
              </div>
            )}
          </div>
        );
      })()}

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
