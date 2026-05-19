import { describe, expect, it } from "vitest";
import { formatDateShort, projectDate, projectDateShort } from "./dateProjection";

/**
 * Regression tests for Issue sasipython1223/planning-os#45.
 *
 * Real-world Primavera/XER projects deliver `plan_start_date` in formats
 * such as `YYYY-MM-DD HH:MM[:SS]` or, when absent, an empty string. Before
 * this fix, `parseUTC` produced an Invalid Date for those inputs, which
 * rendered the Gantt timescale labels as the literal text "undefined NaN".
 *
 * These tests pin the hardened behaviour: the strict canonical form still
 * round-trips, common XER forms are accepted, and malformed/empty inputs
 * fall back to today's UTC midnight so downstream labels stay finite.
 */
describe("Issue #45 — date projection hardening", () => {
  it("projects a strict YYYY-MM-DD date in UTC", () => {
    const d = projectDate("2026-01-15", 0);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(15);
    expect(formatDateShort(d)).toBe("Jan 15");
  });

  it("accepts XER-style 'YYYY-MM-DD HH:MM' dates", () => {
    expect(projectDateShort("2026-01-15 00:00", 0)).toBe("Jan 15");
    expect(projectDateShort("2026-03-07 08:30:00", 0)).toBe("Mar 7");
  });

  it("accepts ISO 'YYYY-MM-DDTHH:MM:SSZ' dates", () => {
    expect(projectDateShort("2026-12-25T12:34:56Z", 0)).toBe("Dec 25");
  });

  it("never produces 'undefined NaN' for empty input", () => {
    const label = projectDateShort("", 0);
    expect(label).not.toContain("undefined");
    expect(label).not.toContain("NaN");
  });

  it("never produces 'undefined NaN' for malformed input", () => {
    const label = projectDateShort("not-a-date", 0);
    expect(label).not.toContain("undefined");
    expect(label).not.toContain("NaN");
  });

  it("preserves day-offset arithmetic across the fallback path", () => {
    const a = projectDate("", 0).getTime();
    const b = projectDate("", 5).getTime();
    expect(b - a).toBe(5 * 86_400_000);
  });
});
