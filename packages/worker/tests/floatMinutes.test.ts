import { describe, expect, it } from "vitest";
import { getTotalFloatMinutesForComparison, maxAbsTotalFloatVarianceMinutes } from "../src/floatMinutes.js";

describe("floatMinutes comparator/evidence helpers", () => {
  it("prefers raw-minute totalFloatMinutes when available", () => {
    const value = {
      totalFloat: 999,
      totalFloatMinutes: 12,
      totalFloatWorkdays: -99,
    };

    expect(
      getTotalFloatMinutesForComparison(value as { totalFloat: number; totalFloatMinutes: number }),
    ).toBe(12);
  });

  it("falls back to legacy totalFloat when totalFloatMinutes is absent", () => {
    expect(getTotalFloatMinutesForComparison({ totalFloat: -7 })).toBe(-7);
  });

  it("computes max absolute variance in minutes from raw-minute fields", () => {
    const max = maxAbsTotalFloatVarianceMinutes([
      {
        left: { totalFloat: 100, totalFloatMinutes: 10 },
        right: { totalFloat: 0, totalFloatMinutes: 7 },
      },
      {
        left: { totalFloat: -100, totalFloatMinutes: -6 },
        right: { totalFloat: 100, totalFloatMinutes: 2 },
      },
    ]);

    expect(max).toBe(8);
  });

  it("returns zero when there are no comparison pairs", () => {
    expect(maxAbsTotalFloatVarianceMinutes([])).toBe(0);
  });
});
