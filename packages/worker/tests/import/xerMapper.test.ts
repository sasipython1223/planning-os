/**
 * XER Mapper Unit Tests — W.3
 *
 * Tests the mapXerToCanonical function against crafted XerData objects.
 * Mapper is tested in isolation from the parser and orchestrator.
 */

import { describe, expect, it } from "vitest";
import { mapXerToCanonical } from "../../src/import/mappers/xerMapper.js";
import type { XerData } from "../../src/import/types/xerTypes.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a minimal XerData with defaults for all tables. */
function buildData(overrides: Partial<XerData> = {}): XerData {
  return {
    projects: overrides.projects ?? [{ proj_id: "P1", proj_short_name: "Test", plan_start_date: "2026-01-01", day_hr_cnt: "8" }],
    wbs: overrides.wbs ?? [],
    tasks: overrides.tasks ?? [],
    taskPreds: overrides.taskPreds ?? [],
    resources: overrides.resources ?? [],
    taskRsrcs: overrides.taskRsrcs ?? [],
    calendars: overrides.calendars ?? [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("XER Mapper (W.3)", () => {

  describe("project metadata", () => {
    it("should extract project name and start date", () => {
      const result = mapXerToCanonical(buildData());
      expect(result.projectName).toBe("Test");
      expect(result.projectStartDate).toBe("2026-01-01");
    });

    it("should default to (unknown) when no project data", () => {
      const result = mapXerToCanonical(buildData({ projects: [] }));
      expect(result.projectName).toBe("(unknown)");
      expect(result.projectStartDate).toBe("");
    });

    it("should warn on multi-project XER and use first", () => {
      const result = mapXerToCanonical(buildData({
        projects: [
          { proj_id: "P1", proj_short_name: "First", plan_start_date: "2026-01-01", day_hr_cnt: "8" },
          { proj_id: "P2", proj_short_name: "Second", plan_start_date: "2026-02-01", day_hr_cnt: "8" },
        ],
      }));
      expect(result.projectName).toBe("First");
      const diag = result.diagnostics.find(d => d.code === "MULTI_PROJECT_XER");
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe("warning");
    });
  });

  describe("WBS → summary tasks", () => {
    it("should create summary tasks from PROJWBS entries", () => {
      const result = mapXerToCanonical(buildData({
        wbs: [
          { wbs_id: "W1", proj_id: "P1", parent_wbs_id: "", wbs_short_name: "Root", wbs_name: "Project Root" },
        ],
      }));
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].isSummary).toBe(true);
      expect(result.tasks[0].name).toBe("Project Root");
      expect(result.tasks[0].duration).toBe(0);
      expect(result.tasks[0].depth).toBe(0);
    });

    it("should build hierarchy with correct depth and parentId", () => {
      const result = mapXerToCanonical(buildData({
        wbs: [
          { wbs_id: "W1", proj_id: "P1", parent_wbs_id: "", wbs_short_name: "Root", wbs_name: "Root" },
          { wbs_id: "W2", proj_id: "P1", parent_wbs_id: "W1", wbs_short_name: "Phase1", wbs_name: "Phase 1" },
          { wbs_id: "W3", proj_id: "P1", parent_wbs_id: "W2", wbs_short_name: "Sub", wbs_name: "Sub Phase" },
        ],
      }));
      expect(result.tasks).toHaveLength(3);
      // Root
      expect(result.tasks[0].depth).toBe(0);
      expect(result.tasks[0].parentId).toBeUndefined();
      // Phase 1
      expect(result.tasks[1].depth).toBe(1);
      expect(result.tasks[1].parentId).toBe(result.tasks[0].id);
      // Sub Phase
      expect(result.tasks[2].depth).toBe(2);
      expect(result.tasks[2].parentId).toBe(result.tasks[1].id);
    });
  });

  describe("task mapping", () => {
    it("should map a simple task with correct fields", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Design", task_type: "TT_TASK", target_drtn_hr_cnt: "40", cstr_type: "CS_ASAP", cstr_date: "" },
        ],
      }));
      const mapped = result.tasks[0];
      expect(mapped.name).toBe("Design");
      expect(mapped.duration).toBe(5); // 40hrs / 8hrs = 5 days
      expect(mapped.isSummary).toBe(false);
      expect(mapped.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it("should skip TT_WBS tasks (handled by PROJWBS)", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "WBS Summary", task_type: "TT_WBS", target_drtn_hr_cnt: "0", cstr_type: "", cstr_date: "" },
          { task_id: "T2", proj_id: "P1", wbs_id: "", task_name: "Real Work", task_type: "TT_TASK", target_drtn_hr_cnt: "16", cstr_type: "", cstr_date: "" },
        ],
      }));
      // Only the real task should be mapped
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe("Real Work");
    });

    it("should set parentId from WBS lookup", () => {
      const result = mapXerToCanonical(buildData({
        wbs: [
          { wbs_id: "W1", proj_id: "P1", parent_wbs_id: "", wbs_short_name: "Root", wbs_name: "Root" },
        ],
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "W1", task_name: "Task A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
      }));
      const wbsTask = result.tasks.find(t => t.isSummary);
      const leafTask = result.tasks.find(t => !t.isSummary);
      expect(leafTask!.parentId).toBe(wbsTask!.id);
      expect(leafTask!.depth).toBe(1);
    });

    it("should enforce minimum duration of 1 day", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Zero", task_type: "TT_TASK", target_drtn_hr_cnt: "0", cstr_type: "", cstr_date: "" },
        ],
      }));
      expect(result.tasks[0].duration).toBe(1);
    });

    it("should use custom hoursPerDay from project settings", () => {
      const result = mapXerToCanonical(buildData({
        projects: [{ proj_id: "P1", proj_short_name: "Test", plan_start_date: "2026-01-01", day_hr_cnt: "10" }],
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Task", task_type: "TT_TASK", target_drtn_hr_cnt: "50", cstr_type: "", cstr_date: "" },
        ],
      }));
      expect(result.tasks[0].duration).toBe(5); // 50/10 = 5
    });
  });

  describe("duration rounding diagnostics", () => {
    it("should warn on fractional duration rounding", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Odd Hours", task_type: "TT_TASK", target_drtn_hr_cnt: "12", cstr_type: "", cstr_date: "" },
        ],
      }));
      // 12/8 = 1.5 → rounds to 2
      expect(result.tasks[0].duration).toBe(2);
      const diag = result.diagnostics.find(d => d.code === "DURATION_FRACTIONAL_ROUNDED");
      expect(diag).toBeDefined();
      expect(diag!.sourceEntityId).toBe("T1");
    });

    it("should not warn on clean integer durations", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Clean", task_type: "TT_TASK", target_drtn_hr_cnt: "40", cstr_type: "", cstr_date: "" },
        ],
      }));
      const diag = result.diagnostics.find(d => d.code === "DURATION_FRACTIONAL_ROUNDED");
      expect(diag).toBeUndefined();
    });
  });

  describe("constraint mapping", () => {
    it("should map exact constraint types without diagnostic", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_SNET", cstr_date: "2026-02-01" },
          { task_id: "T2", proj_id: "P1", wbs_id: "", task_name: "B", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_FNLT", cstr_date: "2026-03-01" },
          { task_id: "T3", proj_id: "P1", wbs_id: "", task_name: "C", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_MSO", cstr_date: "2026-04-01" },
        ],
      }));
      const t1 = result.tasks.find(t => t.name === "A")!;
      const t2 = result.tasks.find(t => t.name === "B")!;
      const t3 = result.tasks.find(t => t.name === "C")!;
      expect(t1.constraintType).toBe("SNET");
      expect(t2.constraintType).toBe("FNLT");
      expect(t3.constraintType).toBe("MSO");
      const approxDiags = result.diagnostics.filter(d => d.code === "CONSTRAINT_APPROXIMATED");
      expect(approxDiags).toHaveLength(0);
    });

    it("should approximate CS_FNET as SNET with warning", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_FNET", cstr_date: "2026-02-01" },
        ],
      }));
      expect(result.tasks[0].constraintType).toBe("SNET");
      const diag = result.diagnostics.find(d => d.code === "CONSTRAINT_APPROXIMATED");
      expect(diag).toBeDefined();
      expect(diag!.originalValue).toBe("CS_FNET");
      expect(diag!.mappedValue).toBe("SNET");
    });

    it("should approximate CS_SNLT as FNLT with warning", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_SNLT", cstr_date: "2026-02-01" },
        ],
      }));
      expect(result.tasks[0].constraintType).toBe("FNLT");
      const diag = result.diagnostics.find(d => d.code === "CONSTRAINT_APPROXIMATED");
      expect(diag!.originalValue).toBe("CS_SNLT");
      expect(diag!.mappedValue).toBe("FNLT");
    });

    it("should default unknown constraint to ASAP with warning", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_UNKNOWN", cstr_date: "" },
        ],
      }));
      expect(result.tasks[0].constraintType).toBe("ASAP");
      const diag = result.diagnostics.find(d => d.code === "CONSTRAINT_APPROXIMATED");
      expect(diag).toBeDefined();
      expect(diag!.mappedValue).toBe("ASAP");
    });

    it("should compute constraint date as day-offset from project start", () => {
      const result = mapXerToCanonical(buildData({
        projects: [{ proj_id: "P1", proj_short_name: "Test", plan_start_date: "2026-01-01", day_hr_cnt: "8" }],
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "CS_SNET", cstr_date: "2026-01-11" },
        ],
      }));
      expect(result.tasks[0].constraintDate).toBe(10); // 10 days after start
    });
  });

  describe("dependency mapping", () => {
    it("should map all four dependency types", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
          { task_id: "T2", proj_id: "P1", wbs_id: "", task_name: "B", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        taskPreds: [
          { task_pred_id: "TP1", task_id: "T2", pred_task_id: "T1", pred_type: "PR_FS", lag_hr_cnt: "0" },
        ],
      }));
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].type).toBe("FS");
      expect(result.dependencies[0].lag).toBe(0);
    });

    it("should default unknown dep type to FS with warning", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
          { task_id: "T2", proj_id: "P1", wbs_id: "", task_name: "B", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        taskPreds: [
          { task_pred_id: "TP1", task_id: "T2", pred_task_id: "T1", pred_type: "PR_WEIRD", lag_hr_cnt: "0" },
        ],
      }));
      expect(result.dependencies[0].type).toBe("FS");
      const diag = result.diagnostics.find(d => d.code === "DEPENDENCY_TYPE_UNKNOWN");
      expect(diag).toBeDefined();
    });

    it("should convert lag hours to days and warn on fractional", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
          { task_id: "T2", proj_id: "P1", wbs_id: "", task_name: "B", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        taskPreds: [
          { task_pred_id: "TP1", task_id: "T2", pred_task_id: "T1", pred_type: "PR_FS", lag_hr_cnt: "12" },
        ],
      }));
      // 12/8 = 1.5 → rounds to 2
      expect(result.dependencies[0].lag).toBe(2);
      const diag = result.diagnostics.find(d => d.code === "LAG_FRACTIONAL_ROUNDED");
      expect(diag).toBeDefined();
    });

    it("should skip dependencies with dangling task references", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "A", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        taskPreds: [
          { task_pred_id: "TP1", task_id: "T2", pred_task_id: "T1", pred_type: "PR_FS", lag_hr_cnt: "0" },
        ],
      }));
      expect(result.dependencies).toHaveLength(0);
      const diag = result.diagnostics.find(d => d.message.includes("unknown task"));
      expect(diag).toBeDefined();
    });
  });

  describe("resource mapping", () => {
    it("should map resources with unit conversion", () => {
      const result = mapXerToCanonical(buildData({
        resources: [
          { rsrc_id: "R1", rsrc_name: "Crane Crew", max_qty_per_hr: "1.5" },
        ],
      }));
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].name).toBe("Crane Crew");
      expect(result.resources[0].maxUnitsPerDay).toBe(12); // 1.5 * 8
    });

    it("should default maxUnitsPerDay to 1 when missing", () => {
      const result = mapXerToCanonical(buildData({
        resources: [
          { rsrc_id: "R1", rsrc_name: "Unknown", max_qty_per_hr: "" },
        ],
      }));
      expect(result.resources[0].maxUnitsPerDay).toBe(1);
    });
  });

  describe("assignment mapping", () => {
    it("should map assignments with ID resolution", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Task", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        resources: [
          { rsrc_id: "R1", rsrc_name: "Crew", max_qty_per_hr: "1" },
        ],
        taskRsrcs: [
          { taskrsrc_id: "TR1", task_id: "T1", rsrc_id: "R1", target_qty_per_hr: "0.5" },
        ],
      }));
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].unitsPerDay).toBe(4); // 0.5 * 8
      // Verify ID resolution
      const task = result.tasks.find(t => !t.isSummary)!;
      expect(result.assignments[0].taskId).toBe(task.id);
      expect(result.assignments[0].resourceId).toBe(result.resources[0].id);
    });

    it("should skip assignments with dangling references", () => {
      const result = mapXerToCanonical(buildData({
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "", task_name: "Task", task_type: "TT_TASK", target_drtn_hr_cnt: "8", cstr_type: "", cstr_date: "" },
        ],
        taskRsrcs: [
          { taskrsrc_id: "TR1", task_id: "T1", rsrc_id: "R_MISSING", target_qty_per_hr: "1" },
        ],
      }));
      expect(result.assignments).toHaveLength(0);
      const diag = result.diagnostics.find(d => d.message.includes("unknown entity"));
      expect(diag).toBeDefined();
    });
  });

  describe("calendar diagnostics", () => {
    it("should emit CALENDAR_SIMPLIFIED when calendars present", () => {
      const result = mapXerToCanonical(buildData({
        calendars: [
          { clndr_id: "C1", clndr_name: "Standard", clndr_data: "..." },
        ],
      }));
      const diag = result.diagnostics.find(d => d.code === "CALENDAR_SIMPLIFIED");
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe("info");
    });

    it("should not emit calendar diagnostic when no calendars", () => {
      const result = mapXerToCanonical(buildData({ calendars: [] }));
      const diag = result.diagnostics.find(d => d.code === "CALENDAR_SIMPLIFIED");
      expect(diag).toBeUndefined();
    });
  });

  describe("empty data", () => {
    it("should handle completely empty data gracefully", () => {
      const result = mapXerToCanonical(buildData({
        projects: [],
        wbs: [],
        tasks: [],
        taskPreds: [],
        resources: [],
        taskRsrcs: [],
        calendars: [],
      }));
      expect(result.tasks).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.resources).toHaveLength(0);
      expect(result.assignments).toHaveLength(0);
    });
  });

  describe("full realistic mapping", () => {
    it("should map a multi-entity XER correctly", () => {
      const result = mapXerToCanonical(buildData({
        wbs: [
          { wbs_id: "W1", proj_id: "P1", parent_wbs_id: "", wbs_short_name: "Proj", wbs_name: "Project" },
          { wbs_id: "W2", proj_id: "P1", parent_wbs_id: "W1", wbs_short_name: "Ph1", wbs_name: "Phase 1" },
        ],
        tasks: [
          { task_id: "T1", proj_id: "P1", wbs_id: "W2", task_name: "Design", task_type: "TT_TASK", target_drtn_hr_cnt: "40", cstr_type: "CS_ASAP", cstr_date: "" },
          { task_id: "T2", proj_id: "P1", wbs_id: "W2", task_name: "Build", task_type: "TT_TASK", target_drtn_hr_cnt: "80", cstr_type: "CS_SNET", cstr_date: "2026-02-01" },
        ],
        taskPreds: [
          { task_pred_id: "TP1", task_id: "T2", pred_task_id: "T1", pred_type: "PR_FS", lag_hr_cnt: "0" },
        ],
        resources: [
          { rsrc_id: "R1", rsrc_name: "Engineers", max_qty_per_hr: "0.5" },
        ],
        taskRsrcs: [
          { taskrsrc_id: "TR1", task_id: "T1", rsrc_id: "R1", target_qty_per_hr: "0.25" },
        ],
      }));

      // 2 WBS summaries + 2 leaf tasks
      expect(result.tasks).toHaveLength(4);
      expect(result.tasks.filter(t => t.isSummary)).toHaveLength(2);
      expect(result.tasks.filter(t => !t.isSummary)).toHaveLength(2);

      expect(result.dependencies).toHaveLength(1);
      expect(result.resources).toHaveLength(1);
      expect(result.assignments).toHaveLength(1);

      // Design task: 40hrs/8 = 5 days
      const design = result.tasks.find(t => t.name === "Design")!;
      expect(design.duration).toBe(5);

      // Build task: 80hrs/8 = 10 days, SNET constraint
      const build = result.tasks.find(t => t.name === "Build")!;
      expect(build.duration).toBe(10);
      expect(build.constraintType).toBe("SNET");

      // No warnings other than info-level (no fractional, no lossy constraint)
      const warnings = result.diagnostics.filter(d => d.severity === "warning");
      expect(warnings).toHaveLength(0);
    });
  });
});
