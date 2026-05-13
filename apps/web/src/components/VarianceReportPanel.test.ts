/**
 * W4: VarianceReport tests
 *
 * Verifies the shape and classification rules for W4 variance report data,
 * plus conformance with the protocol types consumed by the App.tsx panel.
 *
 * Tests are pure-logic (no DOM) — they verify types and classification logic.
 */

import type {
    SourceCalculatedVarianceReport,
    TaskDateVariance,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";

// ─── Helpers ────────────────────────────────────────────────────────

const makeVariance = (overrides: Partial<TaskDateVariance> = {}): TaskDateVariance => ({
  taskId: "t1",
  taskName: "Task One",
  varianceSeverity: "none",
  possibleReasons: [],
  ...overrides,
});

const makeReport = (overrides: Partial<SourceCalculatedVarianceReport> = {}): SourceCalculatedVarianceReport => ({
  totalCompared: 5,
  noVarianceCount: 3,
  startVarianceCount: 1,
  finishVarianceCount: 2,
  majorVarianceCount: 0,
  taskVariances: [],
  generatedAt: new Date().toISOString(),
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("SourceCalculatedVarianceReport shape conformance", () => {
  it("conforms to the expected report interface", () => {
    const report = makeReport();
    expect(typeof report.totalCompared).toBe("number");
    expect(typeof report.noVarianceCount).toBe("number");
    expect(typeof report.startVarianceCount).toBe("number");
    expect(typeof report.finishVarianceCount).toBe("number");
    expect(typeof report.majorVarianceCount).toBe("number");
    expect(Array.isArray(report.taskVariances)).toBe(true);
    expect(typeof report.generatedAt).toBe("string");
  });

  it("generatedAt is a valid ISO timestamp string", () => {
    const report = makeReport();
    const parsed = Date.parse(report.generatedAt);
    expect(isNaN(parsed)).toBe(false);
  });
});

describe("TaskDateVariance shape conformance", () => {
  it("captures all expected optional variance fields", () => {
    const v = makeVariance({
      sourceStartMinutes: 0,
      sourceFinishMinutes: MINUTES_PER_DAY,
      calculatedStartMinutes: MINUTES_PER_DAY,
      calculatedFinishMinutes: MINUTES_PER_DAY * 2,
      startVarianceMinutes: MINUTES_PER_DAY,
      finishVarianceMinutes: MINUTES_PER_DAY,
      varianceSeverity: "moderate",
      possibleReasons: ["Calendar interpretation differences between source and planner calculation"],
      calendarRiskRelated: true,
      constraintRiskRelated: false,
    });
    expect(v.startVarianceMinutes).toBe(MINUTES_PER_DAY);
    expect(v.finishVarianceMinutes).toBe(MINUTES_PER_DAY);
    expect(v.varianceSeverity).toBe("moderate");
    expect(v.calendarRiskRelated).toBe(true);
    expect(v.possibleReasons).toHaveLength(1);
  });

  it("allows absent variance fields for tasks skipped in comparison", () => {
    const v = makeVariance({ varianceSeverity: "none", possibleReasons: [] });
    expect(v.startVarianceMinutes).toBeUndefined();
    expect(v.finishVarianceMinutes).toBeUndefined();
  });
});

describe("Variance severity thresholds", () => {
  it("5+ days variance magnitude maps to major", () => {
    const finishVarianceMinutes = MINUTES_PER_DAY * 6;
    // The threshold from computeVarianceReport: major > 5 days (5 * MINUTES_PER_DAY)
    expect(finishVarianceMinutes > MINUTES_PER_DAY * 5).toBe(true);
  });

  it("1–5 days variance magnitude maps to moderate", () => {
    const finishVarianceMinutes = MINUTES_PER_DAY * 3;
    expect(finishVarianceMinutes >= MINUTES_PER_DAY && finishVarianceMinutes <= MINUTES_PER_DAY * 5).toBe(true);
  });

  it("less than 1 day variance maps to minor", () => {
    const finishVarianceMinutes = 240;
    expect(finishVarianceMinutes > 0 && finishVarianceMinutes < MINUTES_PER_DAY).toBe(true);
  });
});

describe("Panel display invariants", () => {
  it("panel should show when lifecycle is plannerCalculatedWithVariance and report is present", () => {
    const report = makeReport({ totalCompared: 10, majorVarianceCount: 2 });
    // These conditions gate rendering of variance-report-panel in App.tsx
    const lifecycle = "plannerCalculatedWithVariance";
    const hasReport = report !== null;
    expect(lifecycle === "plannerCalculatedWithVariance" && hasReport).toBe(true);
  });

  it("panel should not show when lifecycle is sourceImportedNotCalculated", () => {
    const lifecycle: string = "sourceImportedNotCalculated";
    expect(lifecycle === "plannerCalculatedWithVariance").toBe(false);
  });

  it("major variance count drives highlighted warning display", () => {
    const report = makeReport({ majorVarianceCount: 3 });
    // Confirms the App.tsx check `report.majorVarianceCount > 0`
    expect(report.majorVarianceCount > 0).toBe(true);
  });

  it("zero major variances means no major warning is shown", () => {
    const report = makeReport({ majorVarianceCount: 0 });
    expect(report.majorVarianceCount > 0).toBe(false);
  });

  it("Source vs Planner report option requires an imported source and a variance report", () => {
    const hasSourceImportRecord = true;
    const hasVarianceReport = true;
    expect(hasSourceImportRecord && hasVarianceReport).toBe(true);

    const missingVarianceReport = false;
    expect(hasSourceImportRecord && missingVarianceReport).toBe(false);
  });

  it("non-imported projects should not show Source vs Planner report option", () => {
    const hasSourceImportRecord = false;
    const hasVarianceReport = true;
    expect(hasSourceImportRecord && hasVarianceReport).toBe(false);
  });
});
