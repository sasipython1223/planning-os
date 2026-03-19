/**
 * MSP XML Mapper Unit Tests — W.6
 *
 * Tests the mapMspToCanonical function against crafted MspData.
 * Mapper is isolated from parser — MspData is constructed inline.
 */

import { describe, expect, it } from "vitest";
import { mapMspToCanonical } from "../../src/import/mappers/mspMapper.js";
import type { MspData } from "../../src/import/types/mspTypes.js";

// ─── Helpers ────────────────────────────────────────────────────────

function baseMspData(overrides: Partial<MspData> = {}): MspData {
  return {
    project: { name: "Test Project", startDate: "2026-01-15T08:00:00", minutesPerDay: "480" },
    tasks: [],
    resources: [],
    assignments: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("MSP XML Mapper (W.6)", () => {

  describe("project metadata", () => {
    it("should extract project name and start date", () => {
      const data = baseMspData();
      const result = mapMspToCanonical(data);
      expect(result.projectName).toBe("Test Project");
      expect(result.projectStartDate).toBe("2026-01-15");
    });

    it("should default project name to (unknown) when empty", () => {
      const data = baseMspData({ project: { name: "", startDate: "", minutesPerDay: "480" } });
      const result = mapMspToCanonical(data);
      expect(result.projectName).toBe("(unknown)");
    });
  });

  describe("task mapping", () => {
    it("should map basic tasks with canonical IDs", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Task A", duration: "PT40H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "Task B", duration: "PT80H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].name).toBe("Task A");
      expect(result.tasks[0].duration).toBe(5); // 40h / 8h = 5 days
      expect(result.tasks[1].duration).toBe(10); // 80h / 8h = 10 days
      // Canonical IDs are UUIDs, not MSP UIDs
      expect(result.tasks[0].id).not.toBe("1");
      expect(result.tasks[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("should skip UID 0 (project summary)", () => {
      const data = baseMspData({
        tasks: [
          { uid: "0", name: "Project Summary", duration: "PT0H0M0S", summary: "1", outlineLevel: "0", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "1", name: "Real Task", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe("Real Task");
    });

    it("should map summary tasks with duration 0", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Phase 1", duration: "PT80H0M0S", summary: "1", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].isSummary).toBe(true);
      expect(result.tasks[0].duration).toBe(0);
    });

    it("should compute depth from outlineLevel (1-based → 0-based)", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Level 1", duration: "PT8H0M0S", summary: "1", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "Level 2", duration: "PT8H0M0S", summary: "0", outlineLevel: "2", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].depth).toBe(0);
      expect(result.tasks[1].depth).toBe(1);
    });

    it("should set parentId from outline hierarchy", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Parent", duration: "PT0H0M0S", summary: "1", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "Child", duration: "PT8H0M0S", summary: "0", outlineLevel: "2", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[1].parentId).toBe(result.tasks[0].id);
    });

    it("should emit diagnostic for fractional duration", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Odd", duration: "PT12H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      // 12h / 8h = 1.5 → rounds to 2
      expect(result.tasks[0].duration).toBe(2);
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("DURATION_FRACTIONAL_ROUNDED");
    });

    it("should default unparseable duration to 1 day with diagnostic", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Bad Dur", duration: "not-a-duration", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].duration).toBe(1);
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("DURATION_FRACTIONAL_ROUNDED");
    });
  });

  describe("constraint mapping", () => {
    it("should map exact MSP constraint types (SNET = 4)", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "SNET", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "4", constraintDate: "2026-02-01T08:00:00", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].constraintType).toBe("SNET");
      // Should not emit CONSTRAINT_APPROXIMATED for exact mapping
      const approxDiag = result.diagnostics.filter(d => d.code === "CONSTRAINT_APPROXIMATED");
      expect(approxDiag).toHaveLength(0);
    });

    it("should emit warning for lossy constraint (SNLT = 5 → FNLT)", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "SNLT", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "5", constraintDate: "2026-02-01T08:00:00", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].constraintType).toBe("FNLT");
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("CONSTRAINT_APPROXIMATED");
    });

    it("should emit warning for unknown constraint type", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Unknown", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "99", constraintDate: "", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].constraintType).toBe("ASAP");
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("CONSTRAINT_APPROXIMATED");
    });

    it("should compute constraintDate as day-offset from project start", () => {
      const data = baseMspData({
        project: { name: "Test", startDate: "2026-01-15T08:00:00", minutesPerDay: "480" },
        tasks: [
          { uid: "1", name: "SNET", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "4", constraintDate: "2026-01-20T08:00:00", predecessorLinks: [] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.tasks[0].constraintDate).toBe(5); // 5 days offset
    });
  });

  describe("dependency mapping", () => {
    it("should map predecessor links to canonical dependencies", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Pred", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "Succ", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "1", linkLag: "0" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].type).toBe("FS"); // type 1 = FS
      expect(result.dependencies[0].lag).toBe(0);
    });

    it("should map all dependency types correctly", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "B-FF", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "0", linkLag: "0" }] },
          { uid: "3", name: "C-SF", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "2", linkLag: "0" }] },
          { uid: "4", name: "D-SS", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "3", linkLag: "0" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.dependencies).toHaveLength(3);
      expect(result.dependencies[0].type).toBe("FF");
      expect(result.dependencies[1].type).toBe("SF");
      expect(result.dependencies[2].type).toBe("SS");
    });

    it("should warn on unknown dependency type and default to FS", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "B", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "99", linkLag: "0" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.dependencies[0].type).toBe("FS");
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("DEPENDENCY_TYPE_UNKNOWN");
    });

    it("should warn on link to unknown predecessor UID", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "999", type: "1", linkLag: "0" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.dependencies).toHaveLength(0);
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("DEPENDENCY_TYPE_UNKNOWN");
    });

    it("should convert lag from tenths of minutes to working days", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "B", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "1", linkLag: "4800" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      // 4800 tenths of minutes = 480 minutes = 8 hours = 1 working day
      expect(result.dependencies[0].lag).toBe(1);
    });

    it("should emit diagnostic for fractional lag", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
          { uid: "2", name: "B", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [{ predecessorUID: "1", type: "1", linkLag: "7200" }] },
        ],
      });
      const result = mapMspToCanonical(data);
      // 7200 tenths of minutes = 720 minutes = 12 hours = 1.5 days → rounds to 2
      expect(result.dependencies[0].lag).toBe(2);
      const codes = result.diagnostics.map(d => d.code);
      expect(codes).toContain("LAG_FRACTIONAL_ROUNDED");
    });
  });

  describe("resource mapping", () => {
    it("should map resources with MaxUnits as percent", () => {
      const data = baseMspData({
        resources: [
          { uid: "1", name: "Engineer", maxUnits: "100" },
          { uid: "2", name: "Part-time", maxUnits: "50" },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.resources).toHaveLength(2);
      expect(result.resources[0].name).toBe("Engineer");
      expect(result.resources[0].maxUnitsPerDay).toBe(1); // 100% = 1.0
      expect(result.resources[1].maxUnitsPerDay).toBe(0.5); // 50% = 0.5
    });

    it("should skip UID 0 resources", () => {
      const data = baseMspData({
        resources: [
          { uid: "0", name: "Unassigned", maxUnits: "100" },
          { uid: "1", name: "Real", maxUnits: "100" },
        ],
      });
      const result = mapMspToCanonical(data);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].name).toBe("Real");
    });
  });

  describe("assignment mapping", () => {
    it("should map assignments resolving task and resource UIDs", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Task A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
        resources: [{ uid: "1", name: "Dev", maxUnits: "100" }],
        assignments: [{ uid: "1", taskUID: "1", resourceUID: "1", units: "100" }],
      });
      const result = mapMspToCanonical(data);
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].unitsPerDay).toBe(1);
    });

    it("should skip assignments with resourceUID 0 silently", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Task A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
        assignments: [{ uid: "1", taskUID: "1", resourceUID: "0", units: "100" }],
      });
      const result = mapMspToCanonical(data);
      expect(result.assignments).toHaveLength(0);
    });

    it("should warn on assignment with unknown task UID", () => {
      const data = baseMspData({
        resources: [{ uid: "1", name: "Dev", maxUnits: "100" }],
        assignments: [{ uid: "1", taskUID: "999", resourceUID: "1", units: "100" }],
      });
      const result = mapMspToCanonical(data);
      expect(result.assignments).toHaveLength(0);
      const warnDiags = result.diagnostics.filter(d => d.severity === "warning");
      expect(warnDiags.length).toBeGreaterThan(0);
    });

    it("should warn on assignment with unknown resource UID", () => {
      const data = baseMspData({
        tasks: [
          { uid: "1", name: "Task A", duration: "PT8H0M0S", summary: "0", outlineLevel: "1", constraintType: "0", constraintDate: "", predecessorLinks: [] },
        ],
        assignments: [{ uid: "1", taskUID: "1", resourceUID: "99", units: "100" }],
      });
      const result = mapMspToCanonical(data);
      expect(result.assignments).toHaveLength(0);
      const warnDiags = result.diagnostics.filter(d => d.severity === "warning");
      expect(warnDiags.length).toBeGreaterThan(0);
    });
  });

  describe("unsupported feature diagnostics", () => {
    it("should always emit info diagnostics for unsupported features", () => {
      const data = baseMspData();
      const result = mapMspToCanonical(data);
      const infoCodes = result.diagnostics.filter(d => d.severity === "info").map(d => d.code);
      expect(infoCodes).toContain("UNSUPPORTED_ACTUALS");
      expect(infoCodes).toContain("UNSUPPORTED_COST");
      expect(infoCodes).toContain("CALENDAR_SIMPLIFIED");
    });
  });
});
