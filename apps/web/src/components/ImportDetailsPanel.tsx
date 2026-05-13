import { useEffect, useMemo, useState } from "react";
import type { ImportDetailsViewModel } from "../services/importDetailsViewModel";

type ImportDetailsPanelProps = {
  readonly viewModel: ImportDetailsViewModel;
  readonly onClose: () => void;
};

type TabId = "project-details" | "calendars";
type CalendarFilter = "all" | "global" | "project" | "resource";

function badgeStyle(status: "ACTIVE" | "SIMPLIFIED" | "PRESERVED_ONLY") {
  if (status === "ACTIVE") return { color: "#1b5e20", background: "#e8f5e9" };
  if (status === "SIMPLIFIED") return { color: "#e65100", background: "#fff3e0" };
  return { color: "#37474f", background: "#eceff1" };
}

function statusLabel(status: "ACTIVE" | "SIMPLIFIED" | "PRESERVED_ONLY"): string {
  if (status === "ACTIVE") return "Active";
  if (status === "SIMPLIFIED") return "Simplified";
  return "Preserved only";
}

export function ImportDetailsPanel({ viewModel, onClose }: ImportDetailsPanelProps) {
  const [tab, setTab] = useState<TabId>("project-details");
  const [filter, setFilter] = useState<CalendarFilter>("all");

  const filteredCalendars = useMemo(() => {
    if (filter === "all") return viewModel.calendars;
    return viewModel.calendars.filter((c) => {
      if (filter === "global") return c.type === "Global";
      if (filter === "project") return c.type === "Project";
      return c.type === "Resource";
    });
  }, [viewModel.calendars, filter]);

  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(
    filteredCalendars[0]?.id ?? viewModel.calendars[0]?.id ?? null,
  );

  useEffect(() => {
    if (!filteredCalendars.length) {
      setSelectedCalendarId(null);
      return;
    }
    if (!selectedCalendarId || !filteredCalendars.some((c) => c.id === selectedCalendarId)) {
      setSelectedCalendarId(filteredCalendars[0].id);
    }
  }, [filteredCalendars, selectedCalendarId]);

  const selectedCalendar = selectedCalendarId ? viewModel.calendarDetailsById[selectedCalendarId] : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Details"
      style={{
        width: "min(1200px, 95vw)",
        height: "min(760px, 90vh)",
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
          <strong style={{ fontSize: 15 }}>Import Details</strong>
          <span style={{ fontSize: 12, color: "#607d8b" }}>(Read-only verification)</span>
        </div>
        <button onClick={onClose} style={{ border: "1px solid #cfd8dc", background: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Close</button>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid #eceff1" }}>
        <button
          data-testid="import-details-tab-project"
          onClick={() => setTab("project-details")}
          style={{
            border: tab === "project-details" ? "1px solid #1565c0" : "1px solid #cfd8dc",
            background: tab === "project-details" ? "#e3f2fd" : "#fff",
            color: tab === "project-details" ? "#0d47a1" : "#37474f",
            borderRadius: 6,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Project Details
        </button>
        <button
          data-testid="import-details-tab-calendars"
          onClick={() => setTab("calendars")}
          style={{
            border: tab === "calendars" ? "1px solid #1565c0" : "1px solid #cfd8dc",
            background: tab === "calendars" ? "#e3f2fd" : "#fff",
            color: tab === "calendars" ? "#0d47a1" : "#37474f",
            borderRadius: 6,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Calendars
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {tab === "project-details" && (
          <div data-testid="import-details-project-tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "6px 10px", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>Source format</span><span>{viewModel.projectDetails.sourceFormat}</span>
              <span style={{ fontWeight: 600 }}>File name</span><span>{viewModel.projectDetails.fileName}</span>
              <span style={{ fontWeight: 600 }}>Project name</span><span>{viewModel.projectDetails.projectName}</span>
              {viewModel.projectDetails.sourceProjectId && <><span style={{ fontWeight: 600 }}>Source project ID</span><span>{viewModel.projectDetails.sourceProjectId}</span></>}
              <span style={{ fontWeight: 600 }}>Project Start</span><span data-testid="project-details-start">{viewModel.projectDetails.projectStart}</span>
              {viewModel.projectDetails.dataDate && <><span style={{ fontWeight: 600 }}>Data Date</span><span data-testid="project-details-data-date">{viewModel.projectDetails.dataDate}</span></>}
              {viewModel.projectDetails.statusDate && <><span style={{ fontWeight: 600 }}>Status Date</span><span data-testid="project-details-status-date">{viewModel.projectDetails.statusDate}</span></>}
              {viewModel.projectDetails.mustFinishBy && <><span style={{ fontWeight: 600 }}>Must Finish By</span><span>{viewModel.projectDetails.mustFinishBy}</span></>}
              {viewModel.projectDetails.importLifecycle === "sourceImportedNotCalculated" && viewModel.projectDetails.sourceRollupFinish && (
                <>
                  <span style={{ fontWeight: 600 }}>Source Rollup Finish</span>
                  <span data-testid="project-details-source-rollup-finish">{viewModel.projectDetails.sourceRollupFinish}</span>
                </>
              )}
              {viewModel.projectDetails.importLifecycle !== "sourceImportedNotCalculated" && viewModel.projectDetails.plannerRollupFinish && (
                <>
                  <span style={{ fontWeight: 600 }}>Planner Rollup Finish</span>
                  <span data-testid="project-details-planner-rollup-finish">{viewModel.projectDetails.plannerRollupFinish}</span>
                </>
              )}
              {viewModel.projectDetails.defaultCalendar && <><span style={{ fontWeight: 600 }}>Default Calendar</span><span data-testid="project-details-default-calendar">{viewModel.projectDetails.defaultCalendar}</span></>}
              {viewModel.projectDetails.hoursPerDay !== undefined && <><span style={{ fontWeight: 600 }}>Hours/day</span><span data-testid="project-details-hours-day">{viewModel.projectDetails.hoursPerDay}</span></>}
              {viewModel.projectDetails.hoursPerWeek !== undefined && <><span style={{ fontWeight: 600 }}>Hours/week</span><span data-testid="project-details-hours-week">{viewModel.projectDetails.hoursPerWeek}</span></>}
              {viewModel.projectDetails.hoursPerMonth !== undefined && <><span style={{ fontWeight: 600 }}>Hours/month</span><span data-testid="project-details-hours-month">{viewModel.projectDetails.hoursPerMonth}</span></>}
              {viewModel.projectDetails.hoursPerYear !== undefined && <><span style={{ fontWeight: 600 }}>Hours/year</span><span>{viewModel.projectDetails.hoursPerYear}</span></>}
              <span style={{ fontWeight: 600 }}>Schedule options</span>
              <span>{viewModel.projectDetails.scheduleOptionsPreservedInactive ? "Preserved (inactive)" : "None detected"}</span>
              <span style={{ fontWeight: 600 }}>Import lifecycle</span><span>{viewModel.projectDetails.importLifecycle}</span>
              <span style={{ fontWeight: 600 }}>Recalculation status</span><span>{viewModel.projectDetails.recalculationStatus}</span>
              <span style={{ fontWeight: 600 }}>Variance report status</span><span>{viewModel.projectDetails.varianceStatus}</span>
            </div>

            <div style={{ border: "1px solid #c8e6c9", background: "#f1f8e9", color: "#2e7d32", borderRadius: 8, padding: 10, fontSize: 12 }}>
              {viewModel.sourceSettingsNotice}
            </div>
            <div style={{ border: "1px solid #ffe0b2", background: "#fff8e1", color: "#8d6e63", borderRadius: 8, padding: 10, fontSize: 12 }}>
              {viewModel.engineNotice}
            </div>
            <div style={{ border: "1px solid #ef9a9a", background: "#ffebee", color: "#b71c1c", borderRadius: 8, padding: 10, fontSize: 12 }}>
              {viewModel.recalculationNotice}
            </div>
          </div>
        )}

        {tab === "calendars" && (
          <div data-testid="import-details-calendars-tab" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 12, height: "100%" }}>
            <div style={{ border: "1px solid #dfe6eb", borderRadius: 8, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, borderBottom: "1px solid #eceff1" }}>
                <strong style={{ fontSize: 13 }}>Calendars</strong>
                <select data-testid="calendar-filter" value={filter} onChange={(e) => setFilter(e.target.value as CalendarFilter)}>
                  <option value="all">All</option>
                  <option value="global">Global</option>
                  <option value="project">Project</option>
                  <option value="resource">Resource</option>
                </select>
              </div>
              <div style={{ overflow: "auto" }}>
                {filteredCalendars.map((c) => {
                  const selected = c.id === selectedCalendarId;
                  return (
                    <button
                      key={c.id}
                      data-testid={`calendar-row-${c.id}`}
                      onClick={() => setSelectedCalendarId(c.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        borderBottom: "1px solid #eceff1",
                        background: selected ? "#eef7ff" : "#fff",
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: "#607d8b" }}>
                            {c.type}{c.isDefault ? " • Default" : ""}
                            {c.parentCalendarName ? ` • Base: ${c.parentCalendarName}` : ""}
                          </div>
                        </div>
                        <span style={{ ...badgeStyle(c.engineStatus), borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{statusLabel(c.engineStatus)}</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "#78909c" }}>
                        Tasks: {c.usageTaskCount} • Resources: {c.usageResourceCount} • Exceptions: {c.exceptionCount}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ border: "1px solid #dfe6eb", borderRadius: 8, minHeight: 0, overflow: "auto", padding: 12 }}>
              {!selectedCalendar ? (
                <div style={{ fontSize: 13, color: "#78909c" }}>Select a calendar to view details.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: "4px 10px", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>Source calendar ID</span><span>{selectedCalendar.sourceCalendarId}</span>
                    <span style={{ fontWeight: 600 }}>Calendar name</span><span>{selectedCalendar.name}</span>
                    <span style={{ fontWeight: 600 }}>Type</span><span>{selectedCalendar.type}</span>
                    <span style={{ fontWeight: 600 }}>Parent/base calendar</span><span>{selectedCalendar.parentCalendarName ?? selectedCalendar.parentCalendarId ?? "(none)"}</span>
                    <span style={{ fontWeight: 600 }}>Inheritance resolved</span><span data-testid="calendar-detail-inheritance">{selectedCalendar.inheritanceResolved ? "Yes" : "No"}</span>
                    <span style={{ fontWeight: 600 }}>Raw source preserved</span><span>{selectedCalendar.rawSourcePreserved ? "Yes" : "No"}</span>
                    <span style={{ fontWeight: 600 }}>Engine active status</span><span>{statusLabel(selectedCalendar.engineStatus)}</span>
                    {selectedCalendar.hoursPerDay !== undefined && <><span style={{ fontWeight: 600 }}>Hours/day</span><span>{selectedCalendar.hoursPerDay}</span></>}
                    {selectedCalendar.hoursPerWeek !== undefined && <><span style={{ fontWeight: 600 }}>Hours/week</span><span>{selectedCalendar.hoursPerWeek}</span></>}
                    {selectedCalendar.hoursPerMonth !== undefined && <><span style={{ fontWeight: 600 }}>Hours/month</span><span>{selectedCalendar.hoursPerMonth}</span></>}
                    {selectedCalendar.hoursPerYear !== undefined && <><span style={{ fontWeight: 600 }}>Hours/year</span><span>{selectedCalendar.hoursPerYear}</span></>}
                    <span style={{ fontWeight: 600 }}>Working pattern summary</span><span>{selectedCalendar.workingPatternSummary}</span>
                  </div>

                  <div style={{ borderTop: "1px solid #eceff1", paddingTop: 8 }}>
                    <strong style={{ fontSize: 13 }}>Workweek</strong>
                    <div data-testid="calendar-week-grid" style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(7, minmax(90px, 1fr))", gap: 6 }}>
                      {selectedCalendar.weeklyHoursByDay.map((day) => (
                        <div key={day.dayLabel} style={{ border: "1px solid #e0e0e0", borderRadius: 6, padding: 6, background: "#fafafa" }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{day.dayLabel}</div>
                          <div style={{ fontSize: 12, color: "#455a64" }}>{day.hours}h</div>
                          <div style={{ fontSize: 11, color: "#78909c" }} title={day.periodsText}>{day.periodsText}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: "#78909c" }}>
                      {selectedCalendar.workingPatternSummary.includes("Inferred") ? "Work hours inferred from source totals. Exact time periods were not fully parsed." : "Time periods preserved from source calendar definition."}
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid #eceff1", paddingTop: 8 }}>
                    <strong style={{ fontSize: 13 }}>Exceptions / Holidays</strong>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#546e7a" }}>
                      Total: {selectedCalendar.exceptionCount} • Local: {selectedCalendar.exceptionCountLocal} • Inherited: {selectedCalendar.exceptionCountInherited}
                    </div>
                    {selectedCalendar.hasParseWarning && (
                      <div style={{ marginTop: 6, border: "1px solid #ffcc80", background: "#fff8e1", borderRadius: 6, padding: 8, fontSize: 11, color: "#8d6e63" }} data-testid="calendar-parse-warning">
                        <strong>Parsing note:</strong> {selectedCalendar.parseWarningMessage ?? viewModel.parseNotice}
                      </div>
                    )}
                    {selectedCalendar.exceptions.length === 0 ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#78909c" }}>{viewModel.parseNotice}</div>
                    ) : (
                      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Date</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Type</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Hours</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Source</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Parse status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCalendar.exceptions.map((ex, idx) => (
                            <tr key={`${ex.date}-${idx}`}>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{ex.date}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{ex.type}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{ex.hours ?? "—"}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{ex.source}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{ex.parseStatus}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ borderTop: "1px solid #eceff1", paddingTop: 8 }}>
                    <strong style={{ fontSize: 13 }}>Preserved Source Activity Dates</strong>
                    <div style={{ marginTop: 4, fontSize: 11, color: "#546e7a" }}>These are imported source dates from the file. They may differ from Planner-calculated TaskTable dates after recalculation.</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: "#8d6e63" }}>{viewModel.assignmentNotice}</div>
                    {selectedCalendar.assignedActivities.length === 0 ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#78909c" }}>No activities assigned to this calendar in imported mapping.</div>
                    ) : (
                      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Activity ID</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Activity Name</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>WBS path</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Source Start</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Source Finish</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Assignment fidelity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCalendar.assignedActivities.map((a) => (
                            <tr key={a.taskId} data-testid={`used-by-activity-${a.taskId}`}>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }} title="Source Activity ID (preserved from imported schedule)">{a.activityId}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }} title="Source Activity Name (preserved from imported schedule)">{a.activityName}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }} title="Source WBS Path (preserved from imported schedule)">{a.wbsPath ?? "—"}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }} title="Imported source start date (preserved from original schedule file)">{a.sourceStart ?? "—"}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }} title="Imported source finish date (preserved from original schedule file)">{a.sourceFinish ?? "—"}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{a.assignmentFidelity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ borderTop: "1px solid #eceff1", paddingTop: 8 }}>
                    <strong style={{ fontSize: 13 }}>Used By Resources</strong>
                    {selectedCalendar.assignedResources.length === 0 ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#78909c" }}>No resource-calendar assignment details are currently available in canonical import mapping.</div>
                    ) : (
                      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Resource ID</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Resource name</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #eceff1" }}>Assignment fidelity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCalendar.assignedResources.map((r) => (
                            <tr key={r.resourceId}>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{r.resourceId}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{r.resourceName}</td>
                              <td style={{ borderBottom: "1px solid #f5f5f5", padding: "2px 0" }}>{r.assignmentFidelity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
