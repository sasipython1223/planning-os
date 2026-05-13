/**
 * @module mspParser
 *
 * MS Project XML Parser — W.6 / W.6.2
 *
 * Parses raw MSP XML file content into typed element objects.
 * Stateless, pure function. Zero imports from protocol, state, or kernel.
 *
 * Uses xmlParserAdapter (fast-xml-parser) for Worker-safe XML parsing.
 * No DOMParser dependency — runs in Node, Web Workers, and browsers.
 *
 * MSP XML element hierarchy (high-value nodes):
 *   <Project>
 *     <Name>, <StartDate>, <MinutesPerDay>
 *     <Tasks> → <Task> (UID, Name, Duration, Summary, OutlineLevel,
 *                        ConstraintType, ConstraintDate, PredecessorLink)
 *     <Resources> → <Resource> (UID, Name, MaxUnits)
 *     <Assignments> → <Assignment> (UID, TaskUID, ResourceUID, Units)
 *
 * Limitations (W.6 scope):
 * - Calendars are not parsed (info diagnostic deferred to mapper)
 * - Extended attributes / custom fields are skipped
 * - Only the first <Project> root element is parsed
 */

import type {
    MspAssignment,
    MspCalendar,
    MspCalendarException,
    MspCalendarWeekDay,
    MspData,
    MspParseError,
    MspParseResult,
    MspParseWarning,
    MspPredecessorLink,
    MspProject,
    MspResource,
    MspTask,
    MspWorkingTime,
} from "../types/mspTypes.js";
import { parseXmlToObject } from "./xmlParserAdapter.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Safely read a string property from an unknown object. Returns "" if absent. */
function str(obj: unknown, key: string): string {
  if (obj != null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return val != null ? String(val).trim() : "";
  }
  return "";
}

/** Safely read an array property from an unknown object. Returns [] if absent. */
function arr(obj: unknown, key: string): unknown[] {
  if (obj != null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return Array.isArray(val) ? val : [];
  }
  return [];
}

/** Safely read a nested object property. Returns undefined if absent or not an object. */
function child(obj: unknown, key: string): unknown {
  if (obj != null && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

// ─── Empty result factory ───────────────────────────────────────────

function emptyData(): MspData {
  return { project: { name: "", startDate: "", minutesPerDay: "" }, tasks: [], resources: [], assignments: [], calendars: [] };
}

// ─── Main Parser ────────────────────────────────────────────────────

/**
 * Parse a raw MSP XML string into structured element data.
 *
 * @param raw  The full MSP XML file content as a string.
 * @returns    Parsed data, errors, and warnings.
 */
export function parseMspXml(raw: string): MspParseResult {
  const errors: MspParseError[] = [];
  const warnings: MspParseWarning[] = [];

  // ── Parse XML via adapter ─────────────────────────────────────
  const xmlResult = parseXmlToObject(raw);
  if (!xmlResult.ok) {
    errors.push({ message: xmlResult.error });
    return { data: emptyData(), errors, warnings };
  }

  const root = xmlResult.data;

  // ── Locate root <Project> element ─────────────────────────────
  const projectObj = child(root, "Project");
  if (projectObj == null) {
    // Report what root keys exist for diagnostics
    const rootKeys = (root != null && typeof root === "object")
      ? Object.keys(root as object).filter(k => !k.startsWith("?"))
      : [];
    const keyInfo = rootKeys.length > 0
      ? `found root element(s): [${rootKeys.join(", ")}]`
      : "no root element found in parsed output";
    errors.push({ message: `Missing root <Project> element — ${keyInfo}` });
    return { data: emptyData(), errors, warnings };
  }
  if (typeof projectObj !== "object") {
    errors.push({ message: `Root <Project> is not a valid element — got ${typeof projectObj}` });
    return { data: emptyData(), errors, warnings };
  }

  // ── Project metadata ──────────────────────────────────────────
  const project: MspProject = {
    name: str(projectObj, "Name"),
    startDate: str(projectObj, "StartDate"),
    minutesPerDay: str(projectObj, "MinutesPerDay"),
    statusDate: str(projectObj, "StatusDate") || undefined,
    minutesPerWeek: str(projectObj, "MinutesPerWeek") || undefined,
    daysPerMonth: str(projectObj, "DaysPerMonth") || undefined,
    calendarUID: str(projectObj, "CalendarUID") || undefined,
    scheduleFromStart: str(projectObj, "ScheduleFromStart") || undefined,
    criticalSlackLimit: str(projectObj, "CriticalSlackLimit") || undefined,
    defaultTaskType: str(projectObj, "DefaultTaskType") || undefined,
  };

  // ── Tasks ─────────────────────────────────────────────────────
  const tasks: MspTask[] = [];
  const tasksContainer = child(projectObj, "Tasks");
  const taskArray = arr(tasksContainer, "Task");

  for (let i = 0; i < taskArray.length; i++) {
    const el = taskArray[i];
    const uid = str(el, "UID");
    if (!uid) {
      warnings.push({ message: `Task at index ${i} missing UID — skipped` });
      continue;
    }

    // Parse PredecessorLinks nested inside this Task
    const predecessorLinks: MspPredecessorLink[] = [];
    const linkArray = arr(el, "PredecessorLink");
    for (const linkEl of linkArray) {
      predecessorLinks.push({
        predecessorUID: str(linkEl, "PredecessorUID"),
        type: str(linkEl, "Type"),
        linkLag: str(linkEl, "LinkLag"),
      });
    }

    const calendarUID = str(el, "CalendarUID");
    tasks.push({
      id: str(el, "ID"),
      uid,
      name: str(el, "Name"),
      duration: str(el, "Duration"),
      summary: str(el, "Summary"),
      outlineLevel: str(el, "OutlineLevel"),
      constraintType: str(el, "ConstraintType"),
      constraintDate: str(el, "ConstraintDate"),
      calendarUID: calendarUID || undefined,
      start: str(el, "Start"),
      finish: str(el, "Finish"),
      actualStart: str(el, "ActualStart"),
      actualFinish: str(el, "ActualFinish"),
      actualDuration: str(el, "ActualDuration"),
      remainingDuration: str(el, "RemainingDuration"),
      remainingStart: str(el, "RemainingStart"),
      remainingFinish: str(el, "RemainingFinish"),
      stop: str(el, "Stop"),
      resume: str(el, "Resume"),
      percentComplete: str(el, "PercentComplete"),
      percentWorkComplete: str(el, "PercentWorkComplete"),
      physicalPercentComplete: str(el, "PhysicalPercentComplete"),
      durationPercentComplete: str(el, "DurationPercentComplete"),
      unitsPercentComplete: str(el, "UnitsPercentComplete"),
      percentCompleteType: str(el, "PercentCompleteType"),
      predecessorLinks,
    });
  }

  // ── Resources ─────────────────────────────────────────────────
  const resources: MspResource[] = [];
  const resourcesContainer = child(projectObj, "Resources");
  const resourceArray = arr(resourcesContainer, "Resource");

  for (let i = 0; i < resourceArray.length; i++) {
    const el = resourceArray[i];
    const uid = str(el, "UID");
    if (!uid) {
      warnings.push({ message: `Resource at index ${i} missing UID — skipped` });
      continue;
    }

    const calResourceUID = str(el, "CalendarUID");
    resources.push({
      uid,
      name: str(el, "Name"),
      maxUnits: str(el, "MaxUnits"),
      calendarUID: calResourceUID || undefined,
    });
  }

  // ── Assignments ───────────────────────────────────────────────
  const assignments: MspAssignment[] = [];
  const assignmentsContainer = child(projectObj, "Assignments");
  const assignmentArray = arr(assignmentsContainer, "Assignment");

  for (let i = 0; i < assignmentArray.length; i++) {
    const el = assignmentArray[i];
    const uid = str(el, "UID");
    if (!uid) {
      warnings.push({ message: `Assignment at index ${i} missing UID — skipped` });
      continue;
    }

    assignments.push({
      uid,
      taskUID: str(el, "TaskUID"),
      resourceUID: str(el, "ResourceUID"),
      units: str(el, "Units"),
    });
  }

  // ── Calendars ─────────────────────────────────────────────────
  const calendars: MspCalendar[] = [];
  const calendarsContainer = child(projectObj, "Calendars");
  const calendarArray = arr(calendarsContainer, "Calendar");

  for (const calEl of calendarArray) {
    const calUID = str(calEl, "UID");
    if (!calUID) continue;

    // Parse WeekDays
    const weekDays: MspCalendarWeekDay[] = [];
    const weekDaysContainer = child(calEl, "WeekDays");
    const weekDayArray = arr(weekDaysContainer, "WeekDay");
    for (const wdEl of weekDayArray) {
      const workingTimesContainer = child(wdEl, "WorkingTimes");
      const workingTimeArray = arr(workingTimesContainer, "WorkingTime");
      const workingTimes: MspWorkingTime[] = workingTimeArray.map(wtEl => ({
        fromTime: str(wtEl, "FromTime"),
        toTime: str(wtEl, "ToTime"),
      }));
      weekDays.push({
        dayType: str(wdEl, "DayType"),
        dayWorking: str(wdEl, "DayWorking"),
        workingTimes,
      });
    }

    // Parse Exceptions
    const exceptions: MspCalendarException[] = [];
    const exceptionsContainer = child(calEl, "Exceptions");
    const exceptionArray = arr(exceptionsContainer, "Exception");
    for (const exEl of exceptionArray) {
      const timePeriod = child(exEl, "TimePeriod");
      const workingTimesContainer = child(exEl, "WorkingTimes");
      const workingTimeArray = arr(workingTimesContainer, "WorkingTime");
      const workingTimes: MspWorkingTime[] = workingTimeArray.map(wtEl => ({
        fromTime: str(wtEl, "FromTime"),
        toTime: str(wtEl, "ToTime"),
      }));
      exceptions.push({
        name: str(exEl, "Name") || undefined,
        fromDate: str(timePeriod, "FromDate"),
        toDate: str(timePeriod, "ToDate"),
        dayWorking: str(exEl, "DayWorking"),
        workingTimes,
        enteredByOccurrences: str(exEl, "EnteredByOccurrences") || undefined,
        type: str(exEl, "Type") || undefined,
      });
    }

    calendars.push({
      uid: calUID,
      name: str(calEl, "Name"),
      isBaseCalendar: str(calEl, "IsBaseCalendar"),
      baseCalendarUID: str(calEl, "BaseCalendarUID"),
      weekDays,
      exceptions,
    });
  }

  const data: MspData = { project, tasks, resources, assignments, calendars };
  return { data, errors, warnings };
}
