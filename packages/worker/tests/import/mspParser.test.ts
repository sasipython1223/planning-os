/**
 * MSP XML Parser Unit Tests — W.6
 *
 * Tests the parseMspXml function against crafted MSP XML content.
 * Parser is isolated: no protocol, state, or kernel imports.
 */

import { describe, expect, it } from "vitest";
import { parseMspXml } from "../../src/import/parsers/mspParser.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a minimal valid MSP XML string with custom inner content. */
function buildMspXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n${inner}\n</Project>`;
}

function projectMeta(name = "Test Project", startDate = "2026-01-15T08:00:00", minutesPerDay = "480"): string {
  return `<Name>${name}</Name><StartDate>${startDate}</StartDate><MinutesPerDay>${minutesPerDay}</MinutesPerDay>`;
}

function taskXml(uid: string, name: string, opts: { duration?: string; summary?: string; outlineLevel?: string; constraintType?: string; constraintDate?: string; predecessorLinks?: string } = {}): string {
  const dur = opts.duration ?? "PT40H0M0S";
  const smry = opts.summary ?? "0";
  const ol = opts.outlineLevel ?? "1";
  const ct = opts.constraintType ?? "0";
  const cd = opts.constraintDate ? `<ConstraintDate>${opts.constraintDate}</ConstraintDate>` : "";
  const pls = opts.predecessorLinks ?? "";
  return `<Task><UID>${uid}</UID><Name>${name}</Name><Duration>${dur}</Duration><Summary>${smry}</Summary><OutlineLevel>${ol}</OutlineLevel><ConstraintType>${ct}</ConstraintType>${cd}${pls}</Task>`;
}

function predecessorLinkXml(predUID: string, type = "1", lag = "0"): string {
  return `<PredecessorLink><PredecessorUID>${predUID}</PredecessorUID><Type>${type}</Type><LinkLag>${lag}</LinkLag></PredecessorLink>`;
}

function resourceXml(uid: string, name: string, maxUnits = "100"): string {
  return `<Resource><UID>${uid}</UID><Name>${name}</Name><MaxUnits>${maxUnits}</MaxUnits></Resource>`;
}

function assignmentXml(uid: string, taskUID: string, resourceUID: string, units = "100"): string {
  return `<Assignment><UID>${uid}</UID><TaskUID>${taskUID}</TaskUID><ResourceUID>${resourceUID}</ResourceUID><Units>${units}</Units></Assignment>`;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("MSP XML Parser (W.6)", () => {

  describe("XML structure validation", () => {
    it("should reject malformed XML", () => {
      const result = parseMspXml("<not valid xml>>>");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("XML parse error");
    });

    it("should reject XML without <Project> root", () => {
      const result = parseMspXml('<?xml version="1.0"?><Data></Data>');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("Missing root <Project>");
    });

    it("should accept a minimal valid MSP XML", () => {
      const result = parseMspXml(buildMspXml(projectMeta()));
      expect(result.errors).toHaveLength(0);
      expect(result.data.project.name).toBe("Test Project");
      expect(result.data.tasks).toHaveLength(0);
    });
  });

  describe("project metadata", () => {
    it("should extract project name, startDate, minutesPerDay", () => {
      const xml = buildMspXml(projectMeta("My Schedule", "2026-03-01T08:00:00", "480"));
      const result = parseMspXml(xml);
      expect(result.data.project.name).toBe("My Schedule");
      expect(result.data.project.startDate).toBe("2026-03-01T08:00:00");
      expect(result.data.project.minutesPerDay).toBe("480");
    });
  });

  describe("task parsing", () => {
    it("should parse tasks from <Tasks> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Task A")}
          ${taskXml("2", "Task B", { duration: "PT80H0M0S" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[0].uid).toBe("1");
      expect(result.data.tasks[0].name).toBe("Task A");
      expect(result.data.tasks[1].uid).toBe("2");
      expect(result.data.tasks[1].duration).toBe("PT80H0M0S");
    });

    it("should warn on task missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks><Task><Name>No UID</Name></Task></Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain("missing UID");
    });

    it("should parse summary tasks", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Phase 1", { summary: "1", outlineLevel: "1" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[0].summary).toBe("1");
      expect(result.data.tasks[0].outlineLevel).toBe("1");
    });

    it("should parse predecessor links", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Task A")}
          ${taskXml("2", "Task B", { predecessorLinks: predecessorLinkXml("1", "1", "4800") })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[1].predecessorLinks).toHaveLength(1);
      expect(result.data.tasks[1].predecessorLinks[0].predecessorUID).toBe("1");
      expect(result.data.tasks[1].predecessorLinks[0].type).toBe("1");
      expect(result.data.tasks[1].predecessorLinks[0].linkLag).toBe("4800");
    });

    it("should parse constraint type and date", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>
          ${taskXml("1", "Constrained", { constraintType: "4", constraintDate: "2026-02-01T08:00:00" })}
        </Tasks>`);
      const result = parseMspXml(xml);
      expect(result.data.tasks[0].constraintType).toBe("4");
      expect(result.data.tasks[0].constraintDate).toBe("2026-02-01T08:00:00");
    });
  });

  describe("resource parsing", () => {
    it("should parse resources from <Resources> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Resources>
          ${resourceXml("1", "Engineer", "100")}
          ${resourceXml("2", "Designer", "50")}
        </Resources>`);
      const result = parseMspXml(xml);
      expect(result.data.resources).toHaveLength(2);
      expect(result.data.resources[0].uid).toBe("1");
      expect(result.data.resources[0].name).toBe("Engineer");
      expect(result.data.resources[0].maxUnits).toBe("100");
    });

    it("should warn on resource missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Resources><Resource><Name>No UID</Name></Resource></Resources>`);
      const result = parseMspXml(xml);
      expect(result.data.resources).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("assignment parsing", () => {
    it("should parse assignments from <Assignments> container", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Tasks>${taskXml("1", "Task A")}</Tasks>
        <Resources>${resourceXml("1", "Engineer")}</Resources>
        <Assignments>
          ${assignmentXml("1", "1", "1", "100")}
        </Assignments>`);
      const result = parseMspXml(xml);
      expect(result.data.assignments).toHaveLength(1);
      expect(result.data.assignments[0].taskUID).toBe("1");
      expect(result.data.assignments[0].resourceUID).toBe("1");
    });

    it("should warn on assignment missing UID", () => {
      const xml = buildMspXml(`${projectMeta()}
        <Assignments><Assignment><TaskUID>1</TaskUID></Assignment></Assignments>`);
      const result = parseMspXml(xml);
      expect(result.data.assignments).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("empty sections", () => {
    it("should return empty arrays when sections are absent", () => {
      const xml = buildMspXml(projectMeta());
      const result = parseMspXml(xml);
      expect(result.data.tasks).toHaveLength(0);
      expect(result.data.resources).toHaveLength(0);
      expect(result.data.assignments).toHaveLength(0);
    });
  });
});
