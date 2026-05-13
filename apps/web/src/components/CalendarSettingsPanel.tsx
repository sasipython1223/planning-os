import type { BaseCalendarDefinition, CalendarId, PlannerCalendar, PlannerCalendarExceptionType, SourceImportRecord, Task } from "@planner/protocol";
import { useEffect, useMemo, useState } from "react";
import { addCalendarException, applyWorkweekPreset, updateHoursPerPeriod, type WorkweekPreset } from "../services/calendarCustomization";

type CalendarSettingsPanelProps = {
  readonly plannerCalendars: Record<string, PlannerCalendar>;
  readonly sourceImportRecord: SourceImportRecord | null;
  readonly tasks: readonly Task[];
  readonly selectedTaskIds: readonly string[];
  readonly projectDefaultCalendarId: CalendarId;
  readonly onClose: () => void;
  readonly onSavePlannerCalendar: (calendar: PlannerCalendar) => void;
  readonly onCloneImportedCalendar: (sourceCalendarId: CalendarId) => void;
  readonly onSetProjectDefault: (calendarId: CalendarId) => void;
  readonly onAssignCalendarToActivities: (calendarId: CalendarId, taskIds: readonly string[]) => void;
};

type SettingsTab = "list" | "workweek" | "periods" | "exceptions" | "used-by";

type CalendarRow = {
  id: string;
  name: string;
  type: "Global" | "Project" | "Resource";
  source: "imported-readonly" | "planner-editable" | "cloned-from-import";
  editable: boolean;
  usedByCount: number;
  isDefault: boolean;
};

function inferType(def: BaseCalendarDefinition): "Global" | "Project" | "Resource" {
  if (def.sourceCalendarType === "project") return "Project";
  if (def.sourceCalendarType === "resource") return "Resource";
  return "Global";
}

function baseDefToDraft(def: BaseCalendarDefinition, projectDefaultCalendarId: CalendarId): PlannerCalendar {
  const weeklyHoursMutable: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const day of [0, 1, 2, 3, 4, 5, 6] as const) {
    const intervals = def.weeklyPattern[day] ?? [];
    weeklyHoursMutable[day] = intervals.reduce((sum, iv) => sum + (iv.endMinute - iv.startMinute), 0) / 60;
  }
  const weekly = Object.values(weeklyHoursMutable).reduce((sum, v) => sum + v, 0);
  const day = def.sourceHoursPerDay ?? Math.max(...Object.values(weeklyHoursMutable), 8);
  const now = new Date().toISOString();

  return {
    calendarId: def.id,
    name: def.name,
    type: inferType(def),
    source: "imported-readonly",
    parentCalendarId: def.parentCalendarId,
    isDefaultProjectCalendar: def.id === projectDefaultCalendarId,
    hoursPerDay: day,
    hoursPerWeek: def.sourceHoursPerWeek ?? weekly,
    hoursPerMonth: def.sourceHoursPerMonth ?? (weekly * 4),
    hoursPerYear: def.sourceHoursPerYear ?? (weekly * 52),
    weeklyHours: weeklyHoursMutable,
    weeklyWorkPeriods: def.weeklyPattern,
    exceptions: def.exceptions.map((ex) => ({
      date: ex.date,
      type: ex.workIntervals.length === 0 ? "non-working" : "custom",
      workIntervals: ex.workIntervals,
      name: ex.name,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function CalendarSettingsPanel({
  plannerCalendars,
  sourceImportRecord,
  tasks,
  selectedTaskIds,
  projectDefaultCalendarId,
  onClose,
  onSavePlannerCalendar,
  onCloneImportedCalendar,
  onSetProjectDefault,
  onAssignCalendarToActivities,
}: CalendarSettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("list");
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);

  const importedDefs = sourceImportRecord?.resolvedCalendarDefinitions ?? sourceImportRecord?.calendarDefinitions ?? {};

  const rows = useMemo<CalendarRow[]>(() => {
    const taskUsage = new Map<string, number>();
    for (const t of tasks) {
      if (!t.assignedCalendarId) continue;
      const key = t.assignedCalendarId as string;
      taskUsage.set(key, (taskUsage.get(key) ?? 0) + 1);
    }

    const importedRows = Object.values(importedDefs).map((def) => ({
      id: def.id as string,
      name: def.name,
      type: inferType(def),
      source: "imported-readonly" as const,
      editable: false,
      usedByCount: taskUsage.get(def.id as string) ?? 0,
      isDefault: def.id === projectDefaultCalendarId,
    }));

    const plannerRows = Object.values(plannerCalendars).map((cal) => ({
      id: cal.calendarId as string,
      name: cal.name,
      type: cal.type,
      source: cal.source,
      editable: cal.source !== "imported-readonly",
      usedByCount: taskUsage.get(cal.calendarId as string) ?? 0,
      isDefault: cal.calendarId === projectDefaultCalendarId,
    }));

    const merged = new Map<string, CalendarRow>();
    for (const row of importedRows) merged.set(row.id, row);
    for (const row of plannerRows) merged.set(row.id, row);
    return [...merged.values()];
  }, [importedDefs, plannerCalendars, projectDefaultCalendarId, tasks]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedCalendarId(null);
      return;
    }
    if (!selectedCalendarId || !rows.some((r) => r.id === selectedCalendarId)) {
      setSelectedCalendarId(rows[0].id);
    }
  }, [rows, selectedCalendarId]);

  const selectedRow = rows.find((r) => r.id === selectedCalendarId) ?? null;
  const selectedImported = selectedRow ? importedDefs[selectedRow.id as CalendarId] : undefined;
  const selectedPlanner = selectedRow ? plannerCalendars[selectedRow.id] : undefined;
  const [draft, setDraft] = useState<PlannerCalendar | null>(null);

  useEffect(() => {
    if (!selectedRow) {
      setDraft(null);
      return;
    }
    if (selectedPlanner) {
      setDraft({ ...selectedPlanner });
      return;
    }
    if (selectedImported) {
      setDraft(baseDefToDraft(selectedImported, projectDefaultCalendarId));
      return;
    }
    setDraft(null);
  }, [selectedPlanner, selectedImported, selectedRow, projectDefaultCalendarId]);

  const usedByTasks = useMemo(() => {
    if (!selectedRow) return [];
    return tasks.filter((t) => (t.assignedCalendarId as string | undefined) === selectedRow.id);
  }, [selectedRow, tasks]);

  const hasAnyCalendars = rows.length > 0;

  const saveDraft = () => {
    if (!draft || !selectedRow?.editable) return;
    onSavePlannerCalendar({ ...draft, source: draft.source === "imported-readonly" ? "planner-editable" : draft.source });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Calendar Settings" style={{ width: "min(1200px, 95vw)", height: "min(760px, 90vh)", background: "#fff", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
        <strong>Calendar Settings</strong>
        <button onClick={onClose}>Close</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", flex: 1, minHeight: 0 }}>
        <div style={{ borderRight: "1px solid #eceff1", overflow: "auto" }}>
          {rows.map((row) => (
            <button key={row.id} data-testid={`calendar-settings-row-${row.id}`} onClick={() => setSelectedCalendarId(row.id)} style={{ width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #eceff1", background: row.id === selectedCalendarId ? "#eef7ff" : "#fff", padding: 10, cursor: "pointer" }}>
              <div style={{ fontWeight: 600 }}>{row.name}</div>
              <div style={{ fontSize: 12, color: "#607d8b" }}>{row.type} • {row.source}{row.isDefault ? " • Default" : ""}</div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: "1px solid #eceff1" }}>
            <button data-testid="calendar-settings-tab-list" onClick={() => setTab("list")}>Calendar List</button>
            <button data-testid="calendar-settings-tab-workweek" onClick={() => setTab("workweek")}>Workweek</button>
            <button data-testid="calendar-settings-tab-periods" onClick={() => setTab("periods")}>Time Periods</button>
            <button data-testid="calendar-settings-tab-exceptions" onClick={() => setTab("exceptions")}>Exceptions / Public Holidays</button>
            <button data-testid="calendar-settings-tab-used-by" onClick={() => setTab("used-by")}>Used By</button>
          </div>

          <div style={{ padding: 12, overflow: "auto" }}>
            {!hasAnyCalendars ? (
              <div data-testid="calendar-settings-empty-state" style={{ color: "#546e7a", fontSize: 13 }}>
                No calendars available in this view yet.
              </div>
            ) : !selectedRow || !draft ? <div>Select a calendar.</div> : (
              <>
                <div style={{ marginBottom: 10, fontSize: 12, color: "#546e7a" }}>
                  {selectedRow.source === "imported-readonly"
                    ? "Imported source calendar: read-only. Clone to create editable Planner calendar."
                    : "Planner editable calendar."}
                </div>

                {selectedRow.source === "imported-readonly" && (
                  <div
                    data-testid="calendar-read-only-badge"
                    style={{
                      display: "inline-block",
                      marginBottom: 10,
                      fontSize: 11,
                      color: "#7f1d1d",
                      background: "#fee2e2",
                      border: "1px solid #fecaca",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    Read-only imported calendar
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button data-testid="set-project-default-calendar" onClick={() => onSetProjectDefault(draft.calendarId)}>Set as Project Default Calendar</button>
                  {selectedRow.source === "imported-readonly" && (
                    <button data-testid="clone-imported-calendar" onClick={() => onCloneImportedCalendar(draft.calendarId)}>Clone as Editable Calendar</button>
                  )}
                  <button
                    data-testid="assign-calendar-to-selected"
                    onClick={() => onAssignCalendarToActivities(draft.calendarId, selectedTaskIds)}
                    disabled={selectedTaskIds.length === 0}
                  >
                    Assign to Selected Activities ({selectedTaskIds.length})
                  </button>
                </div>

                <div data-testid="assignment-inactive-notice" style={{ border: "1px solid #ffcc80", background: "#fff8e1", borderRadius: 6, padding: 8, fontSize: 12, color: "#8d6e63", marginBottom: 12 }}>
                  Activity calendar assignments are stored, but recalculation still uses project calendar until W5B-B is implemented.
                </div>

                {tab === "list" && (
                  <div>
                    <div><strong>Name:</strong> {draft.name}</div>
                    <div><strong>Source:</strong> {selectedRow.source}</div>
                    <div><strong>Used By:</strong> {usedByTasks.length} activities</div>
                  </div>
                )}

                {tab === "workweek" && (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      {(["5d-8h", "6d-8h", "7d-8h", "4d-10h"] as WorkweekPreset[]).map((preset) => (
                        <button
                          key={preset}
                          data-testid={`preset-${preset}`}
                          disabled={!selectedRow.editable}
                          onClick={() => setDraft(applyWorkweekPreset(draft, preset))}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      Weekly hours: Sun {draft.weeklyHours[0]} | Mon {draft.weeklyHours[1]} | Tue {draft.weeklyHours[2]} | Wed {draft.weeklyHours[3]} | Thu {draft.weeklyHours[4]} | Fri {draft.weeklyHours[5]} | Sat {draft.weeklyHours[6]}
                    </div>
                  </div>
                )}

                {tab === "periods" && (
                  <div style={{ display: "grid", gridTemplateColumns: "160px 120px", gap: 8, alignItems: "center" }}>
                    <label>Hours/day</label>
                    <input data-testid="hours-day-input" type="number" disabled={!selectedRow.editable} value={draft.hoursPerDay} onChange={(e) => setDraft(updateHoursPerPeriod(draft, { hoursPerDay: Number(e.target.value) }))} />
                    <label>Hours/week</label>
                    <input data-testid="hours-week-input" type="number" disabled={!selectedRow.editable} value={draft.hoursPerWeek} onChange={(e) => setDraft(updateHoursPerPeriod(draft, { hoursPerWeek: Number(e.target.value) }))} />
                    <label>Hours/month</label>
                    <input data-testid="hours-month-input" type="number" disabled={!selectedRow.editable} value={draft.hoursPerMonth} onChange={(e) => setDraft(updateHoursPerPeriod(draft, { hoursPerMonth: Number(e.target.value) }))} />
                    <label>Hours/year</label>
                    <input data-testid="hours-year-input" type="number" disabled={!selectedRow.editable} value={draft.hoursPerYear} onChange={(e) => setDraft(updateHoursPerPeriod(draft, { hoursPerYear: Number(e.target.value) }))} />
                  </div>
                )}

                {tab === "exceptions" && (
                  <div>
                    <button
                      data-testid="add-nonwork-exception"
                      disabled={!selectedRow.editable}
                      onClick={() => {
                        const today = new Date().toISOString().slice(0, 10);
                        const type: PlannerCalendarExceptionType = "non-working";
                        setDraft(addCalendarException(draft, { date: today, type, workIntervals: [] }));
                      }}
                    >
                      Add Non-working Day
                    </button>
                    <div style={{ marginTop: 8, fontSize: 12 }}>Exceptions: {draft.exceptions.length}</div>
                  </div>
                )}

                {tab === "used-by" && (
                  <div>
                    {usedByTasks.length === 0 ? <div>No activities assigned.</div> : (
                      <ul>
                        {usedByTasks.map((task) => (
                          <li key={task.id}>{task.name} ({task.id})</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {selectedRow.editable && (
                  <div style={{ marginTop: 14 }}>
                    <button data-testid="save-planner-calendar" onClick={saveDraft}>Save Calendar</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
