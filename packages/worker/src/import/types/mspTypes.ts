/**
 * @module mspTypes
 *
 * Raw MSP XML Element Types — Parser Output
 *
 * These types represent the raw elements parsed from a Microsoft Project XML file.
 * They are format-specific and carry no canonical semantics.
 *
 * ⚠️ ISOLATED — zero imports from protocol, state, or kernel.
 * Parsers operate on raw strings and return these plain objects.
 * Canonical mapping from these types is done by the mapper (W.6).
 *
 * MSP XML structure reference:
 * - Root element: <Project>
 * - Tasks: <Tasks><Task> ... </Task></Tasks>
 * - Resources: <Resources><Resource> ... </Resource></Resources>
 * - Assignments: <Assignments><Assignment> ... </Assignment></Assignments>
 * - Calendars: <Calendars><Calendar> ... </Calendar></Calendars>
 * - PredecessorLinks: nested inside <Task><PredecessorLink> ... </PredecessorLink></Task>
 */

// ─── Project Metadata ───────────────────────────────────────────────

export type MspProject = {
  readonly name: string;
  readonly startDate: string;
  readonly minutesPerDay: string;
  readonly statusDate?: string;
  /** W4.3: MinutesPerWeek from MSP XML <Project> element. */
  readonly minutesPerWeek?: string;
  /** W4.3: DaysPerMonth from MSP XML <Project> element. */
  readonly daysPerMonth?: string;
  /** W4.3: CalendarUID of the project's default calendar. */
  readonly calendarUID?: string;
  /** W4.3: ScheduleFromStart — "1"=from start, "0"=from finish. */
  readonly scheduleFromStart?: string;
  /** W4.3: CriticalSlackLimit (days). */
  readonly criticalSlackLimit?: string;
  /** W4.3: DefaultTaskType — "0"=FDU, "1"=FW, "2"=FDW. */
  readonly defaultTaskType?: string;
};

// ─── Task Element ───────────────────────────────────────────────────

export type MspTask = {
  readonly id?: string;
  readonly uid: string;
  readonly name: string;
  readonly duration: string;
  readonly summary: string;
  readonly outlineLevel: string;
  readonly constraintType: string;
  readonly constraintDate: string;
  /** Calendar UID assigned to this task. References MspCalendar.uid. */
  readonly calendarUID?: string;
  readonly start?: string;
  readonly finish?: string;
  readonly actualStart?: string;
  readonly actualFinish?: string;
  readonly actualDuration?: string;
  readonly remainingDuration?: string;
  readonly remainingStart?: string;
  readonly remainingFinish?: string;
  readonly stop?: string;
  readonly resume?: string;
  readonly percentComplete?: string;
  readonly percentWorkComplete?: string;
  readonly physicalPercentComplete?: string;
  readonly durationPercentComplete?: string;
  readonly unitsPercentComplete?: string;
  readonly percentCompleteType?: string;
  readonly predecessorLinks: readonly MspPredecessorLink[];
};

// ─── PredecessorLink (nested inside Task) ───────────────────────────

export type MspPredecessorLink = {
  readonly predecessorUID: string;
  readonly type: string;
  readonly linkLag: string;
};

// ─── Resource Element ───────────────────────────────────────────────

export type MspResource = {
  readonly uid: string;
  readonly name: string;
  readonly maxUnits: string;  /** Calendar UID assigned to this resource. References MspCalendar.uid. */
  readonly calendarUID?: string;
};

// ─── Calendar Element ────────────────────────────────────────────────

/** Working time interval within a day, from MSP <WorkingTimes><WorkingTime>. */
export type MspWorkingTime = {
  readonly fromTime: string;  // "HH:mm:ss"
  readonly toTime: string;    // "HH:mm:ss"
};

/**
 * MSP <WeekDay> element within a calendar.
 * DayType: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat.
 */
export type MspCalendarWeekDay = {
  readonly dayType: string;        // "1".."7"
  readonly dayWorking: string;     // "0" or "1"
  readonly workingTimes: readonly MspWorkingTime[];
};

/**
 * MSP <Exception> element within a calendar.
 * Covers single-date holidays and non-standard working days.
 */
export type MspCalendarException = {
  readonly name?: string;
  readonly fromDate: string;       // ISO datetime string
  readonly toDate: string;         // ISO datetime string
  readonly dayWorking: string;     // "0" or "1"
  readonly workingTimes: readonly MspWorkingTime[];
  /** From <EnteredByOccurrences>: "0" = date range, "1" = recurring. */
  readonly enteredByOccurrences?: string;
  /** From <RecurringDay> or other recurrence indicators. */
  readonly type?: string;
};

/** Parsed MSP <Calendar> element. */
export type MspCalendar = {
  readonly uid: string;
  readonly name: string;
  /** "1" if this is a base calendar, "0" if derived. */
  readonly isBaseCalendar: string;
  /** UID of the base calendar this one inherits from. "-1" means no base. */
  readonly baseCalendarUID: string;
  readonly weekDays: readonly MspCalendarWeekDay[];
  readonly exceptions: readonly MspCalendarException[];};

// ─── Assignment Element ─────────────────────────────────────────────

export type MspAssignment = {
  readonly uid: string;
  readonly taskUID: string;
  readonly resourceUID: string;
  readonly units: string;
};

// ─── Aggregate MSP Data ─────────────────────────────────────────────

/**
 * All parsed elements from a single MSP XML file.
 * Absent sections are represented as empty arrays.
 */
export type MspData = {
  readonly project: MspProject;
  readonly tasks: readonly MspTask[];
  readonly resources: readonly MspResource[];
  readonly assignments: readonly MspAssignment[];
  /** Parsed calendars from <Calendars> section. Empty if not present. */
  readonly calendars: readonly MspCalendar[];
};

// ─── Parse Result ───────────────────────────────────────────────────

export type MspParseError = {
  readonly message: string;
};

export type MspParseWarning = {
  readonly message: string;
};

export type MspParseResult = {
  readonly data: MspData;
  readonly errors: readonly MspParseError[];
  readonly warnings: readonly MspParseWarning[];
};
