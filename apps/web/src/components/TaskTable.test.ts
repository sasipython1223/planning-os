import { describe, expect, it } from "vitest";
import { getDisplayTotalFloat, toWorkerTaskUpdate } from "./TaskTable";

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
