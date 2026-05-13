/**
 * W3B Calendar Mapper Extraction Tests
 *
 * Verifies:
 * 1. XER mapper outputs calendarDefinitions
 * 2. XER mapper populates calendarFidelity.totalCalendars
 * 3. XER task calendar assignments counted and preserved
 * 4. MSP mapper outputs calendarDefinitions
 * 5. MSP mapper populates calendarFidelity.totalCalendars
 * 6. MSP task and resource calendar assignments counted and preserved
 * 7. Calendar diagnostics emitted where expected
 * 8. Import commit preserves calendarDefinitions from mapper output
 * 9. Existing W3A calendarFoundation tests still pass (covered separately)
 * 10. Scheduling output unchanged when calendarDefinitions present
 */

import { describe, expect, it } from "vitest";
import { mapMspToCanonical } from "../../src/import/mappers/mspMapper.js";
import { mapXerToCanonical } from "../../src/import/mappers/xerMapper.js";
import type { MspCalendar, MspData } from "../../src/import/types/mspTypes.js";
import type { XerData, XerTask } from "../../src/import/types/xerTypes.js";

// ─── XER Helpers ─────────────────────────────────────────────────────

function baseXerTask(overrides: Partial<XerTask> = {}): XerTask {
  return {
    task_id: "T1",
    task_code: "A-0010",
    proj_id: "P1",
    wbs_id: "WBS1",
    task_name: "Task 1",
    task_type: "TT_Task",
    target_drtn_hr_cnt: "16",
    cstr_type: "CS_ASAP",
    cstr_date: "",
    ...overrides,
  };
}

function baseXerData(overrides: Partial<XerData> = {}): XerData {
  return {
    projects: [{ proj_id: "P1", proj_short_name: "Test", plan_start_date: "2026-01-05", day_hr_cnt: "8" }],
    wbs: [{ wbs_id: "WBS1", proj_id: "P1", wbs_name: "Root WBS", wbs_short_name: "ROOT", parent_wbs_id: "" }],
    tasks: [],
    taskPreds: [],
    resources: [],
    taskRsrcs: [],
    calendars: [],
    ...overrides,
  };
}

const RICH_CLNDR_DATA = "(0||8|(0|0:00|)(1|8:00|17:00)(2|8:00|17:00)(3|8:00|17:00)(4|8:00|17:00)(5|8:00|17:00)(6|0:00|))";

// ─── MSP Helpers ─────────────────────────────────────────────────────

function baseMspCalendar(overrides: Partial<MspCalendar> = {}): MspCalendar {
  return {
    uid: "CAL1",
    name: "Standard",
    isBaseCalendar: "1",
    baseCalendarUID: "-1",
    weekDays: [
      { dayType: "2", dayWorking: "1", workingTimes: [{ fromTime: "08:00:00", toTime: "17:00:00" }] }, // Mon
      { dayType: "3", dayWorking: "1", workingTimes: [{ fromTime: "08:00:00", toTime: "17:00:00" }] }, // Tue
      { dayType: "4", dayWorking: "1", workingTimes: [{ fromTime: "08:00:00", toTime: "17:00:00" }] }, // Wed
      { dayType: "5", dayWorking: "1", workingTimes: [{ fromTime: "08:00:00", toTime: "17:00:00" }] }, // Thu
      { dayType: "6", dayWorking: "1", workingTimes: [{ fromTime: "08:00:00", toTime: "17:00:00" }] }, // Fri
      { dayType: "1", dayWorking: "0", workingTimes: [] }, // Sun
      { dayType: "7", dayWorking: "0", workingTimes: [] }, // Sat
    ],
    exceptions: [],
    ...overrides,
  };
}

function baseMspData(overrides: Partial<MspData> = {}): MspData {
  return {
    project: { name: "Test Project", startDate: "2026-01-05T08:00:00", minutesPerDay: "480" },
    tasks: [],
    resources: [],
    assignments: [],
    calendars: [],
    ...overrides,
  };
}

// ─── XER Tests ───────────────────────────────────────────────────────

describe("W3B: XER calendar mapper extraction", () => {

  it("outputs calendarDefinitions keyed by clndr_id", () => {
    const data = baseXerData({
      calendars: [
        { clndr_id: "C1", clndr_name: "Standard 5-day", clndr_data: RICH_CLNDR_DATA },
        { clndr_id: "C2", clndr_name: "Night Shift", clndr_data: "" },
      ],
    });
    const result = mapXerToCanonical(data);
    expect(Object.keys(result.calendarDefinitions)).toHaveLength(2);
    expect(result.calendarDefinitions["C1" as any]).toBeDefined();
    expect(result.calendarDefinitions["C1" as any].name).toBe("Standard 5-day");
    expect(result.calendarDefinitions["C2" as any]).toBeDefined();
  });

  it("populates calendarFidelity.totalCalendars from XER calendars", () => {
    const data = baseXerData({
      calendars: [
        { clndr_id: "C1", clndr_name: "Cal 1", clndr_data: RICH_CLNDR_DATA },
        { clndr_id: "C2", clndr_name: "Cal 2", clndr_data: "" },
      ],
    });
    const result = mapXerToCanonical(data);
    expect(result.calendarFidelity.totalCalendars).toBe(2);
  });

  it("emits CALENDAR_IMPORTED_RICH for parseable clndr_data", () => {
    const data = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "Standard", clndr_data: RICH_CLNDR_DATA }],
    });
    const result = mapXerToCanonical(data);
    const richDiag = result.diagnostics.find(d => d.code === "CALENDAR_IMPORTED_RICH");
    expect(richDiag).toBeDefined();
    expect(richDiag!.severity).toBe("info");
  });

  it("emits CALENDAR_SIMPLIFIED_FOR_ENGINE for unparseable clndr_data", () => {
    const data = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "Unknown Format", clndr_data: "gibberish" }],
    });
    const result = mapXerToCanonical(data);
    const simplDiag = result.diagnostics.find(d => d.code === "CALENDAR_SIMPLIFIED_FOR_ENGINE");
    expect(simplDiag).toBeDefined();
    expect(simplDiag!.severity).toBe("info");
    expect(result.calendarFidelity.calendarsSimplifiedForEngine).toBe(1);
  });

  it("parses rich clndr_data into working days only (Mon-Fri)", () => {
    const data = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "5-day", clndr_data: RICH_CLNDR_DATA }],
    });
    const result = mapXerToCanonical(data);
    const cal = result.calendarDefinitions["C1" as any];
    expect(cal).toBeDefined();
    // Mon(1) through Fri(5) should be present; Sun(0) and Sat(6) absent
    expect(cal.weeklyPattern[1]).toBeDefined(); // Mon
    expect(cal.weeklyPattern[5]).toBeDefined(); // Fri
    expect(cal.weeklyPattern[0]).toBeUndefined(); // Sun — non-working
    expect(cal.weeklyPattern[6]).toBeUndefined(); // Sat — non-working
  });

  it("counts task calendar assignments and sets assignedCalendarId", () => {
    const data = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "Standard", clndr_data: RICH_CLNDR_DATA }],
      tasks: [
        baseXerTask({ task_id: "T1", clndr_id: "C1" }),
        baseXerTask({ task_id: "T2", task_code: "A-0020" }),
      ],
    });
    const result = mapXerToCanonical(data);
    expect(result.calendarFidelity.taskCalendarAssignments).toBe(1);
    const t1 = result.tasks.find(t => t.sourceActivityId === "A-0010");
    expect(t1?.assignedCalendarId).toBe("C1");
    const t2 = result.tasks.find(t => t.sourceActivityId === "A-0020");
    expect(t2?.assignedCalendarId).toBeUndefined();
  });

  it("emits TASK_CALENDAR_IGNORED_BY_ENGINE when tasks have calendar assignments", () => {
    const data = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "Standard", clndr_data: RICH_CLNDR_DATA }],
      tasks: [baseXerTask({ clndr_id: "C1" })],
    });
    const result = mapXerToCanonical(data);
    const diag = result.diagnostics.find(d => d.code === "TASK_CALENDAR_IGNORED_BY_ENGINE");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("info");
  });

  it("emits UNRESOLVED_BASE_CALENDAR when base_clndr_id is present", () => {
    const data = baseXerData({
      calendars: [
        { clndr_id: "C1", clndr_name: "Derived", clndr_data: "", base_clndr_id: "C99" },
      ],
    });
    const result = mapXerToCanonical(data);
    const diag = result.diagnostics.find(d => d.code === "UNRESOLVED_BASE_CALENDAR");
    expect(diag).toBeDefined();
    expect(result.calendarFidelity.calendarsWithInheritance).toBe(1);
  });

  it("returns empty calendarDefinitions and zero fidelity when no calendars", () => {
    const data = baseXerData({ calendars: [] });
    const result = mapXerToCanonical(data);
    expect(Object.keys(result.calendarDefinitions)).toHaveLength(0);
    expect(result.calendarFidelity.totalCalendars).toBe(0);
    expect(result.calendarFidelity.taskCalendarAssignments).toBe(0);
  });

  it("scheduling result is unaffected by calendar sidecar data (tasks have same count)", () => {
    const withCal = baseXerData({
      calendars: [{ clndr_id: "C1", clndr_name: "Std", clndr_data: RICH_CLNDR_DATA }],
      tasks: [baseXerTask({ clndr_id: "C1" })],
    });
    const withoutCal = baseXerData({
      tasks: [baseXerTask()],
    });
    const r1 = mapXerToCanonical(withCal);
    const r2 = mapXerToCanonical(withoutCal);
    // Same number of canonical tasks
    expect(r1.tasks.length).toBe(r2.tasks.length);
    // Same duration preserved
    expect(r1.tasks[0]?.durationWorkMinutes).toBe(r2.tasks[0]?.durationWorkMinutes);
  });
});

// ─── MSP Tests ───────────────────────────────────────────────────────

describe("W3B: MSP calendar mapper extraction", () => {

  it("outputs calendarDefinitions keyed by calendar UID", () => {
    const cal = baseMspCalendar({ uid: "1", name: "Standard" });
    const data = baseMspData({ calendars: [cal] });
    const result = mapMspToCanonical(data);
    expect(Object.keys(result.calendarDefinitions)).toHaveLength(1);
    expect(result.calendarDefinitions["1" as any]).toBeDefined();
    expect(result.calendarDefinitions["1" as any].name).toBe("Standard");
  });

  it("populates calendarFidelity.totalCalendars from MSP calendars", () => {
    const data = baseMspData({
      calendars: [
        baseMspCalendar({ uid: "1" }),
        baseMspCalendar({ uid: "2", name: "Night" }),
      ],
    });
    const result = mapMspToCanonical(data);
    expect(result.calendarFidelity.totalCalendars).toBe(2);
  });

  it("parses MSP WeekDays into proper WeeklyWorkPattern (Mon-Fri working)", () => {
    const data = baseMspData({ calendars: [baseMspCalendar()] });
    const result = mapMspToCanonical(data);
    const cal = result.calendarDefinitions["CAL1" as any];
    expect(cal).toBeDefined();
    // Mon(1) through Fri(5) working
    expect(cal.weeklyPattern[1]).toBeDefined(); // Mon
    expect(cal.weeklyPattern[5]).toBeDefined(); // Fri
    // Sun(0) and Sat(6) not in pattern (non-working = absent)
    expect(cal.weeklyPattern[0]).toBeUndefined();
    expect(cal.weeklyPattern[6]).toBeUndefined();
    // Check time interval for Monday
    expect(cal.weeklyPattern[1]![0].startMinute).toBe(8 * 60);  // 08:00
    expect(cal.weeklyPattern[1]![0].endMinute).toBe(17 * 60);   // 17:00
  });

  it("emits CALENDAR_IMPORTED_RICH for calendars with working days", () => {
    const data = baseMspData({ calendars: [baseMspCalendar()] });
    const result = mapMspToCanonical(data);
    const diag = result.diagnostics.find(d => d.code === "CALENDAR_IMPORTED_RICH");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("info");
  });

  it("preserves non-recurring exceptions (holidays)", () => {
    const calWithHoliday = baseMspCalendar({
      exceptions: [{
        name: "New Year",
        fromDate: "2026-01-01T00:00:00",
        toDate: "2026-01-01T23:59:59",
        dayWorking: "0",
        workingTimes: [],
        enteredByOccurrences: "0",
      }],
    });
    const data = baseMspData({ calendars: [calWithHoliday] });
    const result = mapMspToCanonical(data);
    const cal = result.calendarDefinitions["CAL1" as any];
    expect(cal.exceptions).toHaveLength(1);
    expect(cal.exceptions[0].date).toBe("2026-01-01");
    expect(cal.exceptions[0].name).toBe("New Year");
    expect(cal.exceptions[0].workIntervals).toHaveLength(0); // non-working
    expect(result.calendarFidelity.exceptionCount).toBe(1);
  });

  it("emits UNSUPPORTED_EXCEPTION_PATTERN for recurring exceptions", () => {
    const calWithRecurring = baseMspCalendar({
      exceptions: [{
        fromDate: "2026-12-25T00:00:00",
        toDate: "2026-12-25T23:59:59",
        dayWorking: "0",
        workingTimes: [],
        enteredByOccurrences: "1", // recurring
      }],
    });
    const data = baseMspData({ calendars: [calWithRecurring] });
    const result = mapMspToCanonical(data);
    const cal = result.calendarDefinitions["CAL1" as any];
    // Recurring exception not added
    expect(cal.exceptions).toHaveLength(0);
    const diag = result.diagnostics.find(d => d.code === "UNSUPPORTED_EXCEPTION_PATTERN");
    expect(diag).toBeDefined();
  });

  it("counts and emits TASK_CALENDAR_IGNORED_BY_ENGINE for task calendar assignments", () => {
    const data = baseMspData({
      calendars: [baseMspCalendar({ uid: "1" })],
      tasks: [{
        uid: "1",
        id: "1",
        name: "Task A",
        duration: "PT8H",
        summary: "0",
        outlineLevel: "1",
        constraintType: "",
        constraintDate: "",
        calendarUID: "1",
        predecessorLinks: [],
        actualStart: "",
        actualFinish: "",
        actualDuration: "",
        remainingDuration: "",
        remainingStart: "",
        remainingFinish: "",
        stop: "",
        resume: "",
        percentComplete: "",
        percentWorkComplete: "",
        physicalPercentComplete: "",
        durationPercentComplete: "",
        unitsPercentComplete: "",
        percentCompleteType: "",
      }],
    });
    const result = mapMspToCanonical(data);
    expect(result.calendarFidelity.taskCalendarAssignments).toBe(1);
    const t = result.tasks[0];
    expect(t?.assignedCalendarId).toBe("1");
    const diag = result.diagnostics.find(d => d.code === "TASK_CALENDAR_IGNORED_BY_ENGINE");
    expect(diag).toBeDefined();
  });

  it("counts and emits RESOURCE_CALENDAR_PRESERVED_INACTIVE for resource calendar assignments", () => {
    const data = baseMspData({
      calendars: [baseMspCalendar({ uid: "1" })],
      resources: [{
        uid: "R1",
        name: "Worker A",
        maxUnits: "100",
        calendarUID: "1",
      }],
    });
    const result = mapMspToCanonical(data);
    expect(result.calendarFidelity.resourceCalendarAssignments).toBe(1);
    const diag = result.diagnostics.find(d => d.code === "RESOURCE_CALENDAR_PRESERVED_INACTIVE");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("info");
  });

  it("emits UNRESOLVED_BASE_CALENDAR when calendar inherits from another", () => {
    const derived = baseMspCalendar({
      uid: "2",
      name: "Derived",
      baseCalendarUID: "1",
      isBaseCalendar: "0",
    });
    const data = baseMspData({ calendars: [derived] });
    const result = mapMspToCanonical(data);
    expect(result.calendarFidelity.calendarsWithInheritance).toBe(1);
    const diag = result.diagnostics.find(d => d.code === "UNRESOLVED_BASE_CALENDAR");
    expect(diag).toBeDefined();
  });

  it("returns empty calendarDefinitions and zero fidelity when no calendars", () => {
    const data = baseMspData({ calendars: [] });
    const result = mapMspToCanonical(data);
    expect(Object.keys(result.calendarDefinitions)).toHaveLength(0);
    expect(result.calendarFidelity.totalCalendars).toBe(0);
    expect(result.calendarFidelity.taskCalendarAssignments).toBe(0);
    expect(result.calendarFidelity.resourceCalendarAssignments).toBe(0);
  });

  it("scheduling task count is unaffected by calendar sidecar data", () => {
    const withCal = baseMspData({
      calendars: [baseMspCalendar()],
      tasks: [{
        uid: "1", id: "1", name: "Task A", duration: "PT8H", summary: "0",
        outlineLevel: "1", constraintType: "", constraintDate: "", calendarUID: "CAL1",
        predecessorLinks: [], actualStart: "", actualFinish: "", actualDuration: "",
        remainingDuration: "", remainingStart: "", remainingFinish: "",
        stop: "", resume: "", percentComplete: "", percentWorkComplete: "",
        physicalPercentComplete: "", durationPercentComplete: "",
        unitsPercentComplete: "", percentCompleteType: "",
      }],
    });
    const withoutCal = baseMspData({
      tasks: [{
        uid: "1", id: "1", name: "Task A", duration: "PT8H", summary: "0",
        outlineLevel: "1", constraintType: "", constraintDate: "",
        predecessorLinks: [], actualStart: "", actualFinish: "", actualDuration: "",
        remainingDuration: "", remainingStart: "", remainingFinish: "",
        stop: "", resume: "", percentComplete: "", percentWorkComplete: "",
        physicalPercentComplete: "", durationPercentComplete: "",
        unitsPercentComplete: "", percentCompleteType: "",
      }],
    });
    const r1 = mapMspToCanonical(withCal);
    const r2 = mapMspToCanonical(withoutCal);
    expect(r1.tasks.length).toBe(r2.tasks.length);
    expect(r1.tasks[0]?.durationWorkMinutes).toBe(r2.tasks[0]?.durationWorkMinutes);
  });
});
