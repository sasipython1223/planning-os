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
};

// ─── Task Element ───────────────────────────────────────────────────

export type MspTask = {
  readonly uid: string;
  readonly name: string;
  readonly duration: string;
  readonly summary: string;
  readonly outlineLevel: string;
  readonly constraintType: string;
  readonly constraintDate: string;
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
  readonly maxUnits: string;
};

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
