/**
 * Preview Orchestrator Unit Tests — W.2
 *
 * Tests the runImportPreview function and the held candidate lifecycle.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
    clearPendingCandidate,
    getPendingCandidate,
} from "../../src/import/importCandidate.js";
import { runImportPreview } from "../../src/import/previewOrchestrator.js";

// ─── Helper ─────────────────────────────────────────────────────────

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

function wbsTable(rows: string[][]): string {
  const fields = "%F\twbs_id\tproj_id\tparent_wbs_id\twbs_short_name\twbs_name";
  const dataRows = rows.map(r => `%R\t${r.join("\t")}`).join("\n");
  return `%T\tPROJWBS\n${fields}\n${dataRows}\n%E`;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Preview Orchestrator (W.2)", () => {
  beforeEach(() => {
    clearPendingCandidate();
  });

  describe("successful preview", () => {
    it("should return IMPORT_PREVIEW for valid XER", () => {
      const xer = buildXer(
        projectTable([["P1", "Test Project", "2026-01-15", "8"]]),
        taskTable([
          ["T1", "P1", "W1", "Task A", "TT_TASK", "40", "CS_ASAP", ""],
          ["T2", "P1", "W1", "Task B", "TT_TASK", "80", "CS_SNET", "2026-02-01"],
        ]),
        taskPredTable([["TP1", "T2", "T1", "PR_FS", "0"]]),
      );
      const result = runImportPreview("req-1", "xer", xer);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.message.type).toBe("IMPORT_PREVIEW");
      expect(result.message.reqId).toBe("req-1");
      expect(result.message.payload.projectName).toBe("Test Project");
      expect(result.message.payload.projectStartDate).toBe("2026-01-15");
      expect(result.message.payload.format).toBe("xer");
      expect(result.message.payload.summary.taskCount).toBe(2);
      expect(result.message.payload.summary.dependencyCount).toBe(1);
      expect(result.message.payload.canCommit).toBe(true);
    });

    it("should store a pending candidate on success", () => {
      const xer = buildXer(
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
        taskTable([["T1", "P1", "W1", "Task A", "TT_TASK", "40", "CS_ASAP", ""]]),
      );
      runImportPreview("req-2", "xer", xer);

      const candidate = getPendingCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.projectName).toBe("Test");
      expect(candidate!.rawData.tasks).toHaveLength(1);
    });

    it("should replace previous candidate on new preview (staleness guard)", () => {
      const xer1 = buildXer(projectTable([["P1", "First", "2026-01-01", "8"]]));
      const xer2 = buildXer(projectTable([["P2", "Second", "2026-02-01", "8"]]));

      runImportPreview("req-1", "xer", xer1);
      expect(getPendingCandidate()!.projectName).toBe("First");

      runImportPreview("req-2", "xer", xer2);
      expect(getPendingCandidate()!.projectName).toBe("Second");
    });
  });

  describe("error cases", () => {
    it("should NACK on oversized content", () => {
      const huge = "ERMHDR\t19.12\n" + "x".repeat(51 * 1024 * 1024);
      const result = runImportPreview("req-1", "xer", huge);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("FILE_TOO_LARGE");
    });

    it("should report parse errors for invalid XER header", () => {
      const result = runImportPreview("req-1", "xer", "not a valid file");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Parse errors are surfaced as diagnostics — canCommit should be false
      expect(result.message.payload.diagnosticsSummary.errors).toBeGreaterThan(0);
      expect(result.message.payload.canCommit).toBe(false);
    });
  });

  describe("candidate lifecycle", () => {
    it("should clear candidate via clearPendingCandidate", () => {
      const xer = buildXer(projectTable([["P1", "Test", "2026-01-01", "8"]]));
      runImportPreview("req-1", "xer", xer);
      expect(getPendingCandidate()).not.toBeNull();

      clearPendingCandidate();
      expect(getPendingCandidate()).toBeNull();
    });

    it("should store candidate for msp-xml with parse errors (canCommit=false)", () => {
      runImportPreview("req-1", "msp-xml", "<data/>");
      const candidate = getPendingCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.canCommit).toBe(false);
    });

    it("should not store candidate on size error", () => {
      const huge = "x".repeat(51 * 1024 * 1024);
      runImportPreview("req-1", "xer", huge);
      expect(getPendingCandidate()).toBeNull();
    });
  });

  describe("summary counts", () => {
    it("should report zero counts for empty project", () => {
      const xer = buildXer(projectTable([["P1", "Empty", "2026-01-01", "8"]]));
      const result = runImportPreview("req-1", "xer", xer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.payload.summary.taskCount).toBe(0);
      expect(result.message.payload.summary.dependencyCount).toBe(0);
      expect(result.message.payload.summary.resourceCount).toBe(0);
      expect(result.message.payload.summary.assignmentCount).toBe(0);
    });

    it("should show unknown project name when PROJECT table missing", () => {
      const xer = buildXer(
        taskTable([["T1", "P1", "W1", "Task A", "TT_TASK", "40", "CS_ASAP", ""]]),
      );
      const result = runImportPreview("req-1", "xer", xer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.payload.projectName).toBe("(unknown)");
    });
  });

  describe("mapper integration (W.3)", () => {
    it("should include mapped canonical data in candidate", () => {
      const xer = buildXer(
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
        taskTable([["T1", "P1", "", "Task A", "TT_TASK", "40", "CS_ASAP", ""]]),
      );
      runImportPreview("req-1", "xer", xer);

      const candidate = getPendingCandidate();
      expect(candidate!.mappedTasks).toBeDefined();
      expect(candidate!.mappedTasks).toHaveLength(1);
      expect(candidate!.mappedTasks![0].name).toBe("Task A");
      expect(candidate!.mappedTasks![0].duration).toBe(5); // 40hrs / 8hrs = 5 days
      expect(candidate!.mappedDependencies).toHaveLength(0);
    });

    it("should include mapping diagnostics in preview message", () => {
      const xer = buildXer(
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
        taskTable([["T1", "P1", "", "Odd", "TT_TASK", "12", "CS_FNET", "2026-02-01"]]),
      );
      const result = runImportPreview("req-1", "xer", xer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const payload = result.message.payload;
      expect(payload.diagnosticsSummary.warnings).toBeGreaterThan(0);
      const codes = payload.diagnostics.map(d => d.code);
      expect(codes).toContain("CONSTRAINT_APPROXIMATED");
      expect(codes).toContain("DURATION_FRACTIONAL_ROUNDED");
    });

    it("should count WBS summary tasks in task count", () => {
      const xer = buildXer(
        projectTable([["P1", "Test", "2026-01-01", "8"]]),
        wbsTable([["W1", "P1", "", "Root", "Project Root"]]),
        taskTable([["T1", "P1", "W1", "Leaf Task", "TT_TASK", "16", "", ""]]),
      );
      const result = runImportPreview("req-1", "xer", xer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 1 WBS summary + 1 leaf task = 2 total
      expect(result.message.payload.summary.taskCount).toBe(2);
    });

    it("should not include mapped data when parse has errors", () => {
      runImportPreview("req-1", "xer", "not a valid file");

      const candidate = getPendingCandidate();
      expect(candidate!.mappedTasks).toBeUndefined();
    });
  });

  describe("MSP XML routing (W.6)", () => {
    it("should return IMPORT_PREVIEW for valid MSP XML", () => {
      const xml = [
        '<?xml version="1.0"?>',
        "<Project>",
        "<Name>MSP Test</Name>",
        "<StartDate>2026-02-01T08:00:00</StartDate>",
        "<MinutesPerDay>480</MinutesPerDay>",
        "<Tasks>",
        "<Task><UID>1</UID><Name>Task A</Name><Duration>PT40H0M0S</Duration><Summary>0</Summary><OutlineLevel>1</OutlineLevel><ConstraintType>0</ConstraintType></Task>",
        "</Tasks>",
        "</Project>",
      ].join("\n");

      const result = runImportPreview("req-msp-1", "msp-xml", xml);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.message.type).toBe("IMPORT_PREVIEW");
      expect(result.message.reqId).toBe("req-msp-1");
      expect(result.message.payload.format).toBe("msp-xml");
      expect(result.message.payload.projectName).toBe("MSP Test");
      expect(result.message.payload.summary.taskCount).toBe(1);
      expect(result.message.payload.canCommit).toBe(true);
    });

    it("should store pending candidate for MSP XML", () => {
      const xml = [
        '<?xml version="1.0"?>',
        "<Project>",
        "<Name>MSP Candidate</Name>",
        "<StartDate>2026-02-01T08:00:00</StartDate>",
        "<MinutesPerDay>480</MinutesPerDay>",
        "<Tasks>",
        "<Task><UID>1</UID><Name>Task A</Name><Duration>PT8H0M0S</Duration><Summary>0</Summary><OutlineLevel>1</OutlineLevel><ConstraintType>0</ConstraintType></Task>",
        "</Tasks>",
        "</Project>",
      ].join("\n");

      runImportPreview("req-msp-2", "msp-xml", xml);
      const candidate = getPendingCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.format).toBe("msp-xml");
      expect(candidate!.projectName).toBe("MSP Candidate");
      expect(candidate!.mappedTasks).toBeDefined();
      expect(candidate!.mappedTasks).toHaveLength(1);
    });

    it("should report parse errors for malformed MSP XML", () => {
      const result = runImportPreview("req-msp-3", "msp-xml", "not xml at all <<<");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.payload.diagnosticsSummary.errors).toBeGreaterThan(0);
      expect(result.message.payload.canCommit).toBe(false);
    });

    it("should report parse error for XML without <Project> root", () => {
      const result = runImportPreview("req-msp-4", "msp-xml", '<?xml version="1.0"?><Data></Data>');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.message.payload.diagnosticsSummary.errors).toBeGreaterThan(0);
      expect(result.message.payload.canCommit).toBe(false);
    });

    it("should include MSP mapping diagnostics in preview message", () => {
      const xml = [
        '<?xml version="1.0"?>',
        "<Project>",
        "<Name>Diagnostics Test</Name>",
        "<StartDate>2026-01-15T08:00:00</StartDate>",
        "<MinutesPerDay>480</MinutesPerDay>",
        "<Tasks>",
        '<Task><UID>1</UID><Name>Constrained</Name><Duration>PT8H0M0S</Duration><Summary>0</Summary><OutlineLevel>1</OutlineLevel><ConstraintType>5</ConstraintType><ConstraintDate>2026-02-01T08:00:00</ConstraintDate></Task>',
        "</Tasks>",
        "</Project>",
      ].join("\n");

      const result = runImportPreview("req-msp-5", "msp-xml", xml);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const codes = result.message.payload.diagnostics.map(d => d.code);
      expect(codes).toContain("CONSTRAINT_APPROXIMATED");
    });
  });
});
