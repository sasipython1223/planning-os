import { describe, expect, it } from "vitest";
import { projectScheduleResult } from "../../src/schedule/ProjectionAdapter.js";

describe("W5B-B2.12A.12 — ProjectionAdapter output contract extension", () => {
  it("preserves canonical minute values and derives workdays without rounding/truncation", () => {
    const boundaryCases = [
      { minutes: 479, expectedWorkdays: 479 / 480 },
      { minutes: 480, expectedWorkdays: 1 },
      { minutes: 481, expectedWorkdays: 481 / 480 },
      { minutes: 960, expectedWorkdays: 2 },
      { minutes: 961, expectedWorkdays: 961 / 480 },
    ];

    for (const { minutes, expectedWorkdays } of boundaryCases) {
      const projected = projectScheduleResult({ totalFloat: minutes });

      expect(projected.totalFloat).toBe(minutes);
      expect(projected.totalFloatMinutes).toBe(minutes);
      expect(projected.totalFloatWorkdays).toBe(expectedWorkdays);
    }
  });

  it("supports explicit minutesPerDay without mutating the source object", () => {
    const input = { totalFloat: 961, taskId: "A1" };
    const snapshot = structuredClone(input);

    const projected = projectScheduleResult(input, 480);

    expect(input).toStrictEqual(snapshot);
    expect(projected.totalFloatMinutes).toBe(961);
    expect(projected.totalFloatWorkdays).toBe(961 / 480);
    expect(projected.taskId).toBe("A1");
  });

  it("keeps workday values derived/non-authoritative while legacy totalFloat remains available", () => {
    const canonicalMinutes = 481;
    const projected = projectScheduleResult({ totalFloat: canonicalMinutes });

    expect(projected.totalFloat).toBe(canonicalMinutes);
    expect(projected.totalFloatMinutes).toBe(canonicalMinutes);
    expect(projected.totalFloatWorkdays).toBe(481 / 480);
    expect(projected.totalFloatWorkdays).not.toBe(projected.totalFloatMinutes);
  });
});
