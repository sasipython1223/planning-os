import { describe, expect, it } from "vitest";
import { computeTimelineGeometry } from "./timelineGeometry";

/**
 * Regression tests for Issue sasipython1223/planning-os#45.
 *
 * After import, the worker emits `projectStartDate` straight from XER, which
 * may be empty or use the `YYYY-MM-DD HH:MM` form. Before this fix the
 * timeline geometry's `timelineStart` came out as `NaN`, propagating into
 * Gantt/Histogram pixel math and rendering "undefined NaN" timescale labels.
 *
 * These tests pin the timeline geometry to finite numbers for all inputs.
 */
describe("Issue #45 — timeline geometry hardening", () => {
  it("produces finite geometry for a strict YYYY-MM-DD start date", () => {
    const g = computeTimelineGeometry({ t1: { earlyFinish: 30 } }, "2026-01-01");
    expect(Number.isFinite(g.timelineStart)).toBe(true);
    expect(Number.isFinite(g.timelineEnd)).toBe(true);
    expect(g.timelineEnd).toBeGreaterThan(g.timelineStart);
  });

  it("produces finite geometry for XER-style 'YYYY-MM-DD HH:MM' start date", () => {
    const g = computeTimelineGeometry({ t1: { earlyFinish: 30 } }, "2026-01-15 00:00");
    expect(Number.isFinite(g.timelineStart)).toBe(true);
    expect(Number.isFinite(g.timelineEnd)).toBe(true);
  });

  it("falls back gracefully when projectStartDate is empty (never NaN)", () => {
    const g = computeTimelineGeometry({ t1: { earlyFinish: 30 } }, "");
    expect(Number.isFinite(g.timelineStart)).toBe(true);
    expect(Number.isFinite(g.timelineEnd)).toBe(true);
    expect(Number.isFinite(g.totalTimelineWidth)).toBe(true);
    expect(g.totalTimelineWidth).toBeGreaterThan(0);
  });

  it("falls back gracefully when projectStartDate is malformed", () => {
    const g = computeTimelineGeometry({}, "not-a-date");
    expect(Number.isFinite(g.timelineStart)).toBe(true);
    expect(Number.isFinite(g.timelineEnd)).toBe(true);
  });
});
