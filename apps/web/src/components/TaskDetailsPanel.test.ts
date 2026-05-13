import type { ConstraintType, Task, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { buildAllDiags, highestSeverity, mapCodeToUiDiag } from "./TaskDetailsPanel";
import { constraintBadgeStyle } from "./TaskTable";

/**
 * Pure-logic tests for the constraint update payload construction
 * used by ConstraintEditor inside TaskDetailsPanel.
 * No DOM rendering required — mirrors the exact branching logic.
 */

const DATED_TYPES: ReadonlySet<ConstraintType> = new Set(["SNET", "FNLT", "MSO", "MFO"]);

function buildConstraintUpdate(
  _task: Task,
  next: ConstraintType,
): { constraintType: ConstraintType; constraintDateMinutes?: WorkMinutes | null } {
  const nextDated = DATED_TYPES.has(next);
  return {
    constraintType: next,
    ...(!nextDated ? { constraintDateMinutes: null } : {}),
  };
}

/** Pure check mirroring ConstraintEditor's needsDate derivation. */
function constraintNeedsDate(ct: ConstraintType | undefined, constraintDateMinutes: WorkMinutes | null | undefined): boolean {
  const effective = ct ?? "ASAP";
  return DATED_TYPES.has(effective) && (constraintDateMinutes == null);
}

const HARD_TYPES: ReadonlySet<ConstraintType> = new Set(["MSO", "MFO"]);

type DiagLevel = "error" | "info";
type ConstraintDiag = { level: DiagLevel; message: string };

/** Mirrors constraintDiagnostics from ConstraintEditor. */
function constraintDiagnostics(ct: ConstraintType, constraintDateMinutes: WorkMinutes | null | undefined): ConstraintDiag[] {
  const diags: ConstraintDiag[] = [];
  if (DATED_TYPES.has(ct) && constraintDateMinutes == null) {
    diags.push({ level: "error", message: `${ct} requires a constraint date.` });
  }
  if (ct === "ALAP" && constraintDateMinutes != null) {
    diags.push({ level: "info", message: "Date is ignored for ALAP." });
  }
  if (HARD_TYPES.has(ct)) {
    diags.push({ level: "info", message: "Hard constraint — overrides computed schedule." });
  }
  return diags;
}

const baseTask: Task = { id: "A", name: "A", durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" };

describe("Phase V.6 — Constraint diagnostics logic", () => {
  it("SNET with null date → error diagnostic", () => {
    const diags = constraintDiagnostics("SNET", null);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
    expect(diags[0].message).toContain("SNET");
  });

  it("SNET with date set → no diagnostics", () => {
    expect(constraintDiagnostics("SNET", 10 as WorkMinutes)).toHaveLength(0);
  });

  it("FNLT with null date → error diagnostic", () => {
    const diags = constraintDiagnostics("FNLT", null);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
  });

  it("ALAP with date present → info diagnostic", () => {
    const diags = constraintDiagnostics("ALAP", 5 as WorkMinutes);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("info");
    expect(diags[0].message).toContain("ignored");
  });

  it("ALAP with null date → no diagnostics", () => {
    expect(constraintDiagnostics("ALAP", null)).toHaveLength(0);
  });

  it("ASAP → no diagnostics", () => {
    expect(constraintDiagnostics("ASAP", null)).toHaveLength(0);
  });

  it("MSO with date → hard constraint info only", () => {
    const diags = constraintDiagnostics("MSO", 10 as WorkMinutes);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("info");
    expect(diags[0].message).toContain("Hard constraint");
  });

  it("MSO with null date → error + hard constraint info", () => {
    const diags = constraintDiagnostics("MSO", null);
    expect(diags).toHaveLength(2);
    expect(diags[0].level).toBe("error");
    expect(diags[1].level).toBe("info");
  });

  it("MFO with date → hard constraint info only", () => {
    const diags = constraintDiagnostics("MFO", 20 as WorkMinutes);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("Hard constraint");
  });

  it("MFO with null date → error + hard constraint info", () => {
    const diags = constraintDiagnostics("MFO", null);
    expect(diags).toHaveLength(2);
  });
});

describe("constraintNeedsDate helper", () => {
  it("SNET with null date → needs date", () => {
    expect(constraintNeedsDate("SNET", null)).toBe(true);
  });
  it("SNET with date → does not need date", () => {
    expect(constraintNeedsDate("SNET", 10 as WorkMinutes)).toBe(false);
  });
  it("ASAP → does not need date", () => {
    expect(constraintNeedsDate("ASAP", null)).toBe(false);
  });
});

describe("Phase V.3 — ConstraintEditor payload logic", () => {
  it("switching to SNET does not inject constraintDateMinutes", () => {
    const updates = buildConstraintUpdate(baseTask, "SNET");
    expect(updates.constraintType).toBe("SNET");
    expect(updates).not.toHaveProperty("constraintDateMinutes");
  });

  it("switching to FNLT preserves existing constraintDateMinutes", () => {
    const task = { ...baseTask, constraintType: "SNET" as ConstraintType, constraintDateMinutes: (10 * MINUTES_PER_DAY) as WorkMinutes };
    const updates = buildConstraintUpdate(task, "FNLT");
    expect(updates.constraintType).toBe("FNLT");
    // constraintDateMinutes not overwritten — no key in update
    expect(updates).not.toHaveProperty("constraintDateMinutes");
  });

  it("switching to ASAP clears constraintDateMinutes", () => {
    const task = { ...baseTask, constraintType: "SNET" as ConstraintType, constraintDateMinutes: (10 * MINUTES_PER_DAY) as WorkMinutes };
    const updates = buildConstraintUpdate(task, "ASAP");
    expect(updates.constraintType).toBe("ASAP");
    expect(updates.constraintDateMinutes).toBeNull();
  });

  it("switching to ALAP clears constraintDateMinutes", () => {
    const task = { ...baseTask, constraintType: "MSO" as ConstraintType, constraintDateMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes };
    const updates = buildConstraintUpdate(task, "ALAP");
    expect(updates.constraintType).toBe("ALAP");
    expect(updates.constraintDateMinutes).toBeNull();
  });

  it("switching to MSO does not inject constraintDateMinutes when date is null", () => {
    const task = { ...baseTask, constraintType: "ASAP" as ConstraintType, constraintDateMinutes: null };
    const updates = buildConstraintUpdate(task, "MSO");
    expect(updates.constraintType).toBe("MSO");
    expect(updates).not.toHaveProperty("constraintDateMinutes");
  });

  it("switching to MFO keeps existing constraintDateMinutes", () => {
    const task = { ...baseTask, constraintType: "FNLT" as ConstraintType, constraintDateMinutes: (20 * MINUTES_PER_DAY) as WorkMinutes };
    const updates = buildConstraintUpdate(task, "MFO");
    expect(updates.constraintType).toBe("MFO");
    expect(updates).not.toHaveProperty("constraintDateMinutes");
  });

  it("DATED_TYPES contains exactly SNET, FNLT, MSO, MFO", () => {
    expect(DATED_TYPES.has("SNET")).toBe(true);
    expect(DATED_TYPES.has("FNLT")).toBe(true);
    expect(DATED_TYPES.has("MSO")).toBe(true);
    expect(DATED_TYPES.has("MFO")).toBe(true);
    expect(DATED_TYPES.has("ASAP")).toBe(false);
    expect(DATED_TYPES.has("ALAP")).toBe(false);
  });
});

describe("Phase V.8 — constraintBadgeStyle", () => {
  it("returns null for undefined", () => {
    expect(constraintBadgeStyle(undefined)).toBeNull();
  });

  it("returns null for ASAP", () => {
    expect(constraintBadgeStyle("ASAP")).toBeNull();
  });

  it("returns amber badge for MSO", () => {
    const b = constraintBadgeStyle("MSO");
    expect(b).not.toBeNull();
    expect(b!.label).toBe("MSO");
    expect(b!.bg).toBe("#fff3e0");
  });

  it("returns amber badge for MFO", () => {
    const b = constraintBadgeStyle("MFO");
    expect(b).not.toBeNull();
    expect(b!.label).toBe("MFO");
    expect(b!.bg).toBe("#fff3e0");
  });

  it("returns blue badge for SNET", () => {
    const b = constraintBadgeStyle("SNET");
    expect(b).not.toBeNull();
    expect(b!.label).toBe("SNET");
    expect(b!.bg).toBe("#e3f2fd");
  });

  it("returns blue badge for FNLT", () => {
    const b = constraintBadgeStyle("FNLT");
    expect(b).not.toBeNull();
    expect(b!.label).toBe("FNLT");
    expect(b!.bg).toBe("#e3f2fd");
  });

  it("returns muted badge for ALAP", () => {
    const b = constraintBadgeStyle("ALAP");
    expect(b).not.toBeNull();
    expect(b!.label).toBe("ALAP");
    expect(b!.bg).toBe("#eceff1");
  });
});

describe("Phase V.10b — mapCodeToUiDiag", () => {
  it("maps MISSING_DATE_FOR_CONSTRAINT to error with constraint type in message", () => {
    const d = mapCodeToUiDiag("MISSING_DATE_FOR_CONSTRAINT", "SNET");
    expect(d.code).toBe("MISSING_DATE_FOR_CONSTRAINT");
    expect(d.level).toBe("error");
    expect(d.message).toContain("SNET");
  });

  it("maps DATE_IGNORED_BY_MODE to info", () => {
    const d = mapCodeToUiDiag("DATE_IGNORED_BY_MODE", "ALAP");
    expect(d.code).toBe("DATE_IGNORED_BY_MODE");
    expect(d.level).toBe("info");
    expect(d.message).toContain("ignored");
  });

  it("maps GENERATING_NEGATIVE_FLOAT to error", () => {
    const d = mapCodeToUiDiag("GENERATING_NEGATIVE_FLOAT", "SNET");
    expect(d.code).toBe("GENERATING_NEGATIVE_FLOAT");
    expect(d.level).toBe("error");
    expect(d.message).toContain("negative float");
  });

  it("maps SUPERSEDED_BY_LOGIC to info", () => {
    const d = mapCodeToUiDiag("SUPERSEDED_BY_LOGIC", "SNET");
    expect(d.code).toBe("SUPERSEDED_BY_LOGIC");
    expect(d.level).toBe("info");
    expect(d.message).toContain("satisfied by logic");
  });

  it("maps SUPERSEDED_BY_CALENDAR to info", () => {
    const d = mapCodeToUiDiag("SUPERSEDED_BY_CALENDAR", "SNET");
    expect(d.code).toBe("SUPERSEDED_BY_CALENDAR");
    expect(d.level).toBe("info");
    expect(d.message).toContain("non-working day");
  });
});

describe("Phase V.10b — buildAllDiags", () => {
  it("returns only local hard-constraint hint for MSO with no worker codes", () => {
    const diags = buildAllDiags([], "MSO");
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("HARD_CONSTRAINT_INFO");
    expect(diags[0].level).toBe("info");
  });

  it("returns worker code + local hint for MSO with MISSING_DATE", () => {
    const diags = buildAllDiags(["MISSING_DATE_FOR_CONSTRAINT"], "MSO");
    expect(diags).toHaveLength(2);
    expect(diags[0].code).toBe("MISSING_DATE_FOR_CONSTRAINT");
    expect(diags[0].level).toBe("error");
    expect(diags[1].code).toBe("HARD_CONSTRAINT_INFO");
  });

  it("returns empty for ASAP with no worker codes", () => {
    expect(buildAllDiags([], "ASAP")).toHaveLength(0);
  });

  it("returns only worker code for ALAP with DATE_IGNORED", () => {
    const diags = buildAllDiags(["DATE_IGNORED_BY_MODE"], "ALAP");
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("DATE_IGNORED_BY_MODE");
  });

  it("returns only worker code for SNET with MISSING_DATE", () => {
    const diags = buildAllDiags(["MISSING_DATE_FOR_CONSTRAINT"], "SNET");
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("MISSING_DATE_FOR_CONSTRAINT");
    expect(diags[0].level).toBe("error");
  });
});

describe("Phase V.11 — highestSeverity", () => {
  it("returns null for undefined codes", () => {
    expect(highestSeverity(undefined, "ASAP")).toBeNull();
  });

  it("returns null for empty codes on ASAP", () => {
    expect(highestSeverity([], "ASAP")).toBeNull();
  });

  it("returns error when MISSING_DATE present for SNET", () => {
    expect(highestSeverity(["MISSING_DATE_FOR_CONSTRAINT"], "SNET")).toBe("error");
  });

  it("returns info for SUPERSEDED_BY_LOGIC on SNET", () => {
    expect(highestSeverity(["SUPERSEDED_BY_LOGIC"], "SNET")).toBe("info");
  });

  it("returns error when mixed error + info codes present", () => {
    expect(highestSeverity(["SUPERSEDED_BY_LOGIC", "GENERATING_NEGATIVE_FLOAT"], "SNET")).toBe("error");
  });

  it("returns info for MSO with no worker codes (hard constraint hint only)", () => {
    expect(highestSeverity([], "MSO")).toBe("info");
  });

  it("returns error for MSO with MISSING_DATE (error outranks info hint)", () => {
    expect(highestSeverity(["MISSING_DATE_FOR_CONSTRAINT"], "MSO")).toBe("error");
  });
});
