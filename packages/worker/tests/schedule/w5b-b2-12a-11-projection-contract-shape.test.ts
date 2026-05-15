import { describe, expect, it } from "vitest";
import { projectScheduleResult } from "../../src/schedule/ProjectionAdapter.js";

describe("W5B-B2.12A.11 — ProjectionAdapter future contract shape (production adapter)", () => {
  it("documents boundary minute values for projected workdays", () => {
    const boundaryCases = [
      { minutes: 479, expectedWorkdays: 479 / 480 },
      { minutes: 480, expectedWorkdays: 1 },
      { minutes: 481, expectedWorkdays: 481 / 480 },
      { minutes: 960, expectedWorkdays: 2 },
      { minutes: 961, expectedWorkdays: 961 / 480 },
    ];

    for (const testCase of boundaryCases) {
      const projected = projectScheduleResult({ totalFloat: testCase.minutes });

      expect(projected.totalFloatMinutes).toBe(testCase.minutes);
      expect(projected.totalFloatWorkdays).toBe(testCase.expectedWorkdays);
    }
  });

  it("keeps canonical *Minutes values separate from projected *Workdays values", () => {
    const projected = projectScheduleResult({ totalFloat: 481 });

    expect(projected).toStrictEqual({
      totalFloat: 481,
      totalFloatMinutes: 481,
      totalFloatWorkdays: 481 / 480,
    });
    expect(Number.isInteger(projected.totalFloatMinutes)).toBe(true);
    expect(projected.totalFloatWorkdays).not.toBe(projected.totalFloatMinutes);
  });

  it("does not mutate input facts while deriving projected workday values", () => {
    const input = {
      totalFloat: 481,
      taskId: "A",
      isCritical: false,
    };

    const inputSnapshot = structuredClone(input);
    const projected = projectScheduleResult(input);

    expect(input).toStrictEqual(inputSnapshot);
    expect(projected.totalFloatMinutes).toBe(481);
    expect(projected.totalFloatWorkdays).toBe(481 / 480);
    expect(projected.totalFloat).toBe(481);
    expect(projected.taskId).toBe("A");
    expect(projected.isCritical).toBe(false);
  });

  it("documents that freeFloat projection pairing remains a follow-up", () => {
    const projected = projectScheduleResult({ totalFloat: 480 });

    expect(projected.totalFloatMinutes).toBe(480);
    expect(projected.totalFloatWorkdays).toBe(1);
    expect("freeFloatMinutes" in projected).toBe(false);
    expect("freeFloatWorkdays" in projected).toBe(false);
  });

  it("documents that projected workdays are derived display values, not authoritative inputs", () => {
    const canonicalMinutes = 481;
    const projected = projectScheduleResult({ totalFloat: canonicalMinutes });

    const simulatedAuthoritativeInput = projected.totalFloatMinutes;

    expect(simulatedAuthoritativeInput).toBe(canonicalMinutes);
    expect(projected.totalFloatWorkdays).toBe(481 / 480);
  });
});
