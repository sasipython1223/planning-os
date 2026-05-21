import { describe, expect, it } from "vitest";
import {
  COLUMN_SCHEMA,
  getDisplayTotalFloat,
  getDisplayActivityId,
  getTaskIndentPx,
  getTaskRowKind,
  TASK_TABLE_INDENT_WIDTH,
  TASK_TABLE_MAX_INDENT_DEPTH,
  toWorkerTaskUpdate,
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

  it("shows activity id only for activity rows with non-empty value", () => {
    expect(getDisplayActivityId({ isSummary: true, activityId: "A100" })).toBe("—");
    expect(getDisplayActivityId({ isSummary: false, activityId: "" })).toBe("—");
    expect(getDisplayActivityId({ isSummary: false, activityId: "   " })).toBe("—");
    expect(getDisplayActivityId({ isSummary: false, activityId: "A100" })).toBe("A100");
  });
});

describe("W5B-UI.R5C — TaskTable identity columns", () => {
  it("keeps separate Activity ID and Activity Name columns", () => {
    expect(COLUMN_SCHEMA.some((c) => c.key === "activityId" && c.label === "Act ID")).toBe(true);
    expect(COLUMN_SCHEMA.some((c) => c.key === "task" && c.title === "Activity Name")).toBe(true);
  });
});
