/**
 * XER Parser Unit Tests — W.2
 *
 * Tests the parseXer function against crafted XER content.
 * Parser is isolated: no protocol, state, or kernel imports.
 */

import { describe, expect, it } from "vitest";
import { parseXer } from "../../src/import/parsers/xerParser.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a minimal valid XER string from table sections. */
function buildXer(...sections: string[]): string {
  return ["ERMHDR\t19.12\t2026-03-19", ...sections, "%E"].join("\n");
}

function projectTable(rows: string[][]): string {
  const fields = "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tPROJECT\n${fields}\n${dataRows}\n%E`;
}

function taskTable(rows: string[][]): string {
  const fields = "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tTASK\n${fields}\n${dataRows}\n%E`;
}

function taskPredTable(rows: string[][]): string {
  const fields = "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tTASKPRED\n${fields}\n${dataRows}\n%E`;
}

function rsrcTable(rows: string[][]): string {
  const fields = "%F\trsrc_id\trsrc_name\tmax_qty_per_hr";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tRSRC\n${fields}\n${dataRows}\n%E`;
}

function taskRsrcTable(rows: string[][]): string {
  const fields = "%F\ttaskrsrc_id\ttask_id\trsrc_id\ttarget_qty_per_hr";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tTASKRSRC\n${fields}\n${dataRows}\n%E`;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("XER Parser (W.2)", () => {

  describe("header validation", () => {
    it("should reject files without ERMHDR", () => {
      const result = parseXer("not a valid file");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("ERMHDR");
    });

    it("should accept a minimal valid XER", () => {
      const result = parseXer(buildXer());
      expect(result.errors).toHaveLength(0);
      expect(result.data.projects).toHaveLength(0);
    });
  });

  describe("PROJECT table", () => {
    it("should parse a single project row", () => {
      const xer = buildXer(projectTable([
        ["P1", "My Project", "2026-01-15", "8"],
      ]));
      const result = parseXer(xer);
      expect(result.errors).toHaveLength(0);
      expect(result.data.projects).toHaveLength(1);
      expect(result.data.projects[0].proj_id).toBe("P1");
      expect(result.data.projects[0].proj_short_name).toBe("My Project");
      expect(result.data.projects[0].plan_start_date).toBe("2026-01-15");
      expect(result.data.projects[0].day_hr_cnt).toBe("8");
    });
  });

  describe("TASK table", () => {
    it("should parse multiple task rows", () => {
      const xer = buildXer(
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
        taskTable([
          ["T1", "P1", "W1", "Foundation", "TT_TASK", "40", "CS_ASAP", ""],
          ["T2", "P1", "W1", "Framing", "TT_TASK", "80", "CS_SNET", "2026-02-01"],
        ]),
      );
      const result = parseXer(xer);
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[0].task_name).toBe("Foundation");
      expect(result.data.tasks[0].target_drtn_hr_cnt).toBe("40");
      expect(result.data.tasks[1].cstr_type).toBe("CS_SNET");
      expect(result.data.tasks[1].cstr_date).toBe("2026-02-01");
    });

    it("should handle WBS (summary) tasks", () => {
      const xer = buildXer(taskTable([
        ["T10", "P1", "W1", "Phase 1", "TT_WBS", "0", "CS_ASAP", ""],
      ]));
      const result = parseXer(xer);
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].task_type).toBe("TT_WBS");
    });
  });

  describe("TASKPRED table", () => {
    it("should parse predecessor links", () => {
      const xer = buildXer(taskPredTable([
        ["TP1", "T2", "T1", "PR_FS", "0"],
        ["TP2", "T3", "T2", "PR_SS", "16"],
      ]));
      const result = parseXer(xer);
      expect(result.data.taskPreds).toHaveLength(2);
      expect(result.data.taskPreds[0].pred_type).toBe("PR_FS");
      expect(result.data.taskPreds[1].lag_hr_cnt).toBe("16");
    });
  });

  describe("RSRC and TASKRSRC tables", () => {
    it("should parse resources and assignments", () => {
      const xer = buildXer(
        rsrcTable([["R1", "Crane Crew", "1.5"]]),
        taskRsrcTable([["TR1", "T1", "R1", "0.5"]]),
      );
      const result = parseXer(xer);
      expect(result.data.resources).toHaveLength(1);
      expect(result.data.resources[0].rsrc_name).toBe("Crane Crew");
      expect(result.data.taskRsrcs).toHaveLength(1);
      expect(result.data.taskRsrcs[0].target_qty_per_hr).toBe("0.5");
    });
  });

  describe("unrecognized tables", () => {
    it("should warn on unknown tables and continue", () => {
      const xer = buildXer(
        "%T\tACCOUNT\n%F\tacct_id\tacct_name\n%R\tA1\tGeneral\n%E",
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
      );
      const result = parseXer(xer);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("ACCOUNT");
      expect(result.data.projects).toHaveLength(1);
    });
  });

  describe("error cases", () => {
    it("should error on data row before field definition", () => {
      const xer = buildXer(
        "%T\tPROJECT\n%R\tP1\tBad\t2026-01-01\t8\n%E",
      );
      const result = parseXer(xer);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("before field definition");
    });
  });

  describe("full realistic XER", () => {
    it("should parse a multi-table XER without errors", () => {
      const xer = buildXer(
        projectTable([["P1", "Bridge Construction", "2026-03-01", "8"]]),
        taskTable([
          ["T1", "P1", "W1", "Site Prep", "TT_TASK", "40", "CS_ASAP", ""],
          ["T2", "P1", "W1", "Excavation", "TT_TASK", "80", "CS_SNET", "2026-03-15"],
          ["T3", "P1", "W1", "Concrete", "TT_TASK", "120", "CS_ASAP", ""],
        ]),
        taskPredTable([
          ["TP1", "T2", "T1", "PR_FS", "0"],
          ["TP2", "T3", "T2", "PR_FS", "16"],
        ]),
        rsrcTable([
          ["R1", "Excavator", "1"],
          ["R2", "Concrete Crew", "2"],
        ]),
        taskRsrcTable([
          ["TR1", "T2", "R1", "1"],
          ["TR2", "T3", "R2", "1.5"],
        ]),
      );
      const result = parseXer(xer);
      expect(result.errors).toHaveLength(0);
      expect(result.data.projects).toHaveLength(1);
      expect(result.data.tasks).toHaveLength(3);
      expect(result.data.taskPreds).toHaveLength(2);
      expect(result.data.resources).toHaveLength(2);
      expect(result.data.taskRsrcs).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("should handle empty content after header", () => {
      const result = parseXer("ERMHDR\t19.12\n");
      expect(result.errors).toHaveLength(0);
      expect(result.data.tasks).toHaveLength(0);
    });

    it("should handle Windows-style line endings", () => {
      const xer = buildXer(projectTable([["P1", "Test", "2026-01-01", "8"]])).replace(/\n/g, "\r\n");
      const result = parseXer(xer);
      expect(result.errors).toHaveLength(0);
      expect(result.data.projects).toHaveLength(1);
    });

    it("should handle missing fields gracefully (defaults to empty string)", () => {
      const xer = buildXer(
        "%T\tPROJECT\n%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt\n%R\tP1\n%E",
      );
      const result = parseXer(xer);
      expect(result.data.projects).toHaveLength(1);
      expect(result.data.projects[0].proj_short_name).toBe("");
      expect(result.data.projects[0].plan_start_date).toBe("");
    });
  });
});
