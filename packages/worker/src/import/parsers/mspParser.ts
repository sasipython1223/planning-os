/**
 * @module mspParser
 *
 * MS Project XML Parser — W.6
 *
 * Parses raw MSP XML file content into typed element objects.
 * Stateless, pure function. Zero imports from protocol, state, or kernel.
 *
 * Uses the Worker-native DOMParser for XML parsing.
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
    MspData,
    MspParseError,
    MspParseResult,
    MspParseWarning,
    MspPredecessorLink,
    MspProject,
    MspResource,
    MspTask,
} from "../types/mspTypes.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Read the text content of a child element by tag name. Returns "" if absent. */
function childText(parent: Element, tagName: string): string {
  const el = parent.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() ?? "";
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

  // ── XML parse via DOMParser ───────────────────────────────────
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(raw, "application/xml");
  } catch {
    errors.push({ message: "Failed to parse XML document" });
    return {
      data: { project: { name: "", startDate: "", minutesPerDay: "" }, tasks: [], resources: [], assignments: [] },
      errors,
      warnings,
    };
  }

  // Check for XML parse errors (DOMParser embeds <parsererror>)
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    errors.push({ message: `XML parse error: ${parseError.textContent?.trim() ?? "unknown"}` });
    return {
      data: { project: { name: "", startDate: "", minutesPerDay: "" }, tasks: [], resources: [], assignments: [] },
      errors,
      warnings,
    };
  }

  // ── Locate root <Project> element ─────────────────────────────
  const projectEl = doc.getElementsByTagName("Project")[0];
  if (!projectEl) {
    errors.push({ message: "Missing root <Project> element — not a valid MSP XML file" });
    return {
      data: { project: { name: "", startDate: "", minutesPerDay: "" }, tasks: [], resources: [], assignments: [] },
      errors,
      warnings,
    };
  }

  // ── Project metadata ──────────────────────────────────────────
  const project: MspProject = {
    name: childText(projectEl, "Name"),
    startDate: childText(projectEl, "StartDate"),
    minutesPerDay: childText(projectEl, "MinutesPerDay"),
  };

  // ── Tasks ─────────────────────────────────────────────────────
  const tasks: MspTask[] = [];
  const taskElements = projectEl.getElementsByTagName("Task");

  for (let i = 0; i < taskElements.length; i++) {
    const el = taskElements[i];
    // Skip tasks nested inside other non-Tasks containers (MSP XML is flat under <Tasks>)
    if (el.parentElement?.tagName !== "Tasks") continue;

    const uid = childText(el, "UID");
    if (!uid) {
      warnings.push({ message: `Task at index ${i} missing UID — skipped` });
      continue;
    }

    // Parse PredecessorLinks nested inside this Task
    const predecessorLinks: MspPredecessorLink[] = [];
    const linkElements = el.getElementsByTagName("PredecessorLink");
    for (let j = 0; j < linkElements.length; j++) {
      const linkEl = linkElements[j];
      predecessorLinks.push({
        predecessorUID: childText(linkEl, "PredecessorUID"),
        type: childText(linkEl, "Type"),
        linkLag: childText(linkEl, "LinkLag"),
      });
    }

    tasks.push({
      uid,
      name: childText(el, "Name"),
      duration: childText(el, "Duration"),
      summary: childText(el, "Summary"),
      outlineLevel: childText(el, "OutlineLevel"),
      constraintType: childText(el, "ConstraintType"),
      constraintDate: childText(el, "ConstraintDate"),
      predecessorLinks,
    });
  }

  // ── Resources ─────────────────────────────────────────────────
  const resources: MspResource[] = [];
  const resourceElements = projectEl.getElementsByTagName("Resource");

  for (let i = 0; i < resourceElements.length; i++) {
    const el = resourceElements[i];
    if (el.parentElement?.tagName !== "Resources") continue;

    const uid = childText(el, "UID");
    if (!uid) {
      warnings.push({ message: `Resource at index ${i} missing UID — skipped` });
      continue;
    }

    resources.push({
      uid,
      name: childText(el, "Name"),
      maxUnits: childText(el, "MaxUnits"),
    });
  }

  // ── Assignments ───────────────────────────────────────────────
  const assignments: MspAssignment[] = [];
  const assignmentElements = projectEl.getElementsByTagName("Assignment");

  for (let i = 0; i < assignmentElements.length; i++) {
    const el = assignmentElements[i];
    if (el.parentElement?.tagName !== "Assignments") continue;

    const uid = childText(el, "UID");
    if (!uid) {
      warnings.push({ message: `Assignment at index ${i} missing UID — skipped` });
      continue;
    }

    assignments.push({
      uid,
      taskUID: childText(el, "TaskUID"),
      resourceUID: childText(el, "ResourceUID"),
      units: childText(el, "Units"),
    });
  }

  const data: MspData = { project, tasks, resources, assignments };
  return { data, errors, warnings };
}
