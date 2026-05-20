import { describe, expect, it } from "vitest";
import {
  getDisplayTotalFloat,
  getTaskIndentPx,
  getTaskRowKind,
  getWbsBandColor,
  getWbsDepthMarkerColors,
  getWbsMarkerColor,
  TASK_TABLE_INDENT_WIDTH,
  TASK_TABLE_MAX_INDENT_DEPTH,
  toWorkerTaskUpdate,
  WBS_BAND_COLORS,
  WBS_MARKER_COLORS,
} from "./TaskTable";

describe("W5B-B2.12A.17 — TaskTable float display migration", () => {
  it("prefers totalFloatWorkdays for UI display when available", () => {
    const displayed = getDisplayTotalFloat({
      earlyStart: 0,
      earlyFinish: 5,
      lateStart: 0,
      lateFinish: 5,
      totalFloat: 480,
      totalFloatWorkdays: 1,
      isCritical: true,
    });
    expect(displayed).toBe(1);
  });

  it("falls back to legacy totalFloat when totalFloatWorkdays is absent", () => {
    const displayed = getDisplayTotalFloat({
      earlyStart: 0,
      earlyFinish: 5,
      lateStart: 0,
      lateFinish: 5,
      totalFloat: 3,
      isCritical: false,
    });
    expect(displayed).toBe(3);
  });

  it("falls back to legacy totalFloat when totalFloatWorkdays is non-finite", () => {
    const displayed = getDisplayTotalFloat({
      earlyStart: 0,
      earlyFinish: 5,
      lateStart: 0,
      lateFinish: 5,
      totalFloat: -2,
      totalFloatWorkdays: Number.NaN,
      isCritical: false,
    });
    expect(displayed).toBe(-2);
  });

  it("returns placeholder dash when schedule result is unavailable", () => {
    expect(getDisplayTotalFloat(undefined)).toBe("—");
  });
});

describe("W5B-B2.12A.17 — read-only UI safeguards", () => {
  it("strips display/workday float fields before forwarding UI updates", () => {
    const update = toWorkerTaskUpdate({
      name: "Renamed",
      duration: 8,
      totalFloat: 4,
      totalFloatMinutes: 1920,
      totalFloatWorkdays: 4,
      freeFloat: 2,
      freeFloatMinutes: 960,
      freeFloatWorkdays: 2,
    });

    expect(update).toEqual({ name: "Renamed", duration: 8 });
    expect(update).not.toHaveProperty("totalFloatWorkdays");
    expect(update).not.toHaveProperty("totalFloatMinutes");
    expect(update).not.toHaveProperty("totalFloat");
    expect(update).not.toHaveProperty("freeFloatWorkdays");
    expect(update).not.toHaveProperty("freeFloatMinutes");
    expect(update).not.toHaveProperty("freeFloat");
  });
});

describe("W5B-UI.R5A — TaskTable WBS display helpers", () => {
  it("uses existing hierarchy depth for safe indentation", () => {
    expect(getTaskIndentPx(0)).toBe(0);
    expect(getTaskIndentPx(3)).toBe(3 * TASK_TABLE_INDENT_WIDTH);
  });

  it("clamps invalid or excessive hierarchy depth for display only", () => {
    expect(getTaskIndentPx(undefined)).toBe(0);
    expect(getTaskIndentPx(null)).toBe(0);
    expect(getTaskIndentPx(Number.NaN)).toBe(0);
    expect(getTaskIndentPx(-4)).toBe(0);
    expect(getTaskIndentPx(TASK_TABLE_MAX_INDENT_DEPTH + 20)).toBe(
      TASK_TABLE_MAX_INDENT_DEPTH * TASK_TABLE_INDENT_WIDTH,
    );
  });

  it("classifies rows using existing summary metadata only", () => {
    expect(getTaskRowKind({ isSummary: true })).toBe("summary");
    expect(getTaskRowKind({ isSummary: false })).toBe("activity");
  });
});

describe("W5B-UI.R5B — WBS banding / visual grouping helpers", () => {
  it("returns deeper-tinted band colour for shallower WBS depth", () => {
    expect(getWbsBandColor(0)).toBe(WBS_BAND_COLORS[0]);
    expect(getWbsBandColor(1)).toBe(WBS_BAND_COLORS[1]);
    expect(getWbsBandColor(2)).toBe(WBS_BAND_COLORS[2]);
    expect(getWbsBandColor(3)).toBe(WBS_BAND_COLORS[3]);
  });

  it("clamps excessive WBS depth to the last band colour", () => {
    expect(getWbsBandColor(100)).toBe(WBS_BAND_COLORS[WBS_BAND_COLORS.length - 1]);
  });

  it("falls back safely for missing or invalid depth in band colour", () => {
    expect(getWbsBandColor(undefined)).toBe(WBS_BAND_COLORS[2]);
    expect(getWbsBandColor(null)).toBe(WBS_BAND_COLORS[2]);
    expect(getWbsBandColor(Number.NaN)).toBe(WBS_BAND_COLORS[2]);
    expect(getWbsBandColor(-1)).toBe(WBS_BAND_COLORS[2]);
  });

  it("returns depth-based marker colours for WBS summary rows", () => {
    expect(getWbsMarkerColor(0)).toBe(WBS_MARKER_COLORS[0]);
    expect(getWbsMarkerColor(1)).toBe(WBS_MARKER_COLORS[1]);
    expect(getWbsMarkerColor(2)).toBe(WBS_MARKER_COLORS[2]);
    expect(getWbsMarkerColor(3)).toBe(WBS_MARKER_COLORS[3]);
  });

  it("clamps excessive WBS depth to the last marker colour", () => {
    expect(getWbsMarkerColor(50)).toBe(WBS_MARKER_COLORS[WBS_MARKER_COLORS.length - 1]);
  });

  it("falls back safely for missing or invalid depth in marker colour", () => {
    expect(getWbsMarkerColor(undefined)).toBe(WBS_MARKER_COLORS[2]);
    expect(getWbsMarkerColor(null)).toBe(WBS_MARKER_COLORS[2]);
    expect(getWbsMarkerColor(Number.NaN)).toBe(WBS_MARKER_COLORS[2]);
    expect(getWbsMarkerColor(-1)).toBe(WBS_MARKER_COLORS[2]);
  });
});

describe("W5B-UI.R5B — WBS stacked depth-indicator bars", () => {
  it("returns one bar colour for root-level WBS (depth 0)", () => {
    expect(getWbsDepthMarkerColors(0)).toEqual([WBS_MARKER_COLORS[0]]);
  });

  it("returns stacked bar colours for each WBS nesting level", () => {
    expect(getWbsDepthMarkerColors(1)).toEqual([WBS_MARKER_COLORS[0], WBS_MARKER_COLORS[1]]);
    expect(getWbsDepthMarkerColors(2)).toEqual([WBS_MARKER_COLORS[0], WBS_MARKER_COLORS[1], WBS_MARKER_COLORS[2]]);
    expect(getWbsDepthMarkerColors(3)).toEqual([...WBS_MARKER_COLORS]);
  });

  it("clamps stacked bars to available colour levels at excessive depth", () => {
    expect(getWbsDepthMarkerColors(100)).toEqual([...WBS_MARKER_COLORS]);
  });

  it("falls back to single root-level bar for invalid or missing depth", () => {
    expect(getWbsDepthMarkerColors(undefined)).toEqual([WBS_MARKER_COLORS[0]]);
    expect(getWbsDepthMarkerColors(null)).toEqual([WBS_MARKER_COLORS[0]]);
    expect(getWbsDepthMarkerColors(Number.NaN)).toEqual([WBS_MARKER_COLORS[0]]);
    expect(getWbsDepthMarkerColors(-1)).toEqual([WBS_MARKER_COLORS[0]]);
  });
});
