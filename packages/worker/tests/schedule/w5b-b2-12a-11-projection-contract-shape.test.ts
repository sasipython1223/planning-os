import { describe, expect, it } from "vitest";

const MINUTES_PER_DAY = 480;

type FutureProjectionContractInput = {
  totalFloatMinutes: number;
  freeFloatMinutes?: number;
  minutesPerDay?: number;
};

type FutureProjectionContractOutput = {
  totalFloatMinutes: number;
  totalFloatWorkdays: number;
  freeFloatMinutes?: number;
  freeFloatWorkdays?: number;
};

/**
 * Test-only helper for milestone W5B-B2.12A.11.
 *
 * This intentionally models the intended future ProjectionAdapter output contract
 * shape without changing any production adapter or protocol code.
 */
function projectFutureContractShape(input: FutureProjectionContractInput): FutureProjectionContractOutput {
  const minutesPerDay = input.minutesPerDay ?? MINUTES_PER_DAY;

  return {
    totalFloatMinutes: input.totalFloatMinutes,
    totalFloatWorkdays: input.totalFloatMinutes / minutesPerDay,
    ...(input.freeFloatMinutes === undefined
      ? {}
      : {
          freeFloatMinutes: input.freeFloatMinutes,
          freeFloatWorkdays: input.freeFloatMinutes / minutesPerDay,
        }),
  };
}

describe("W5B-B2.12A.11 — ProjectionAdapter future contract shape (test-only)", () => {
  it("documents boundary minute values for projected workdays", () => {
    const boundaryCases = [
      { minutes: 479, expectedWorkdays: 479 / 480 },
      { minutes: 480, expectedWorkdays: 1 },
      { minutes: 481, expectedWorkdays: 481 / 480 },
      { minutes: 960, expectedWorkdays: 2 },
      { minutes: 961, expectedWorkdays: 961 / 480 },
    ];

    for (const testCase of boundaryCases) {
      const projected = projectFutureContractShape({ totalFloatMinutes: testCase.minutes });

      expect(projected.totalFloatMinutes).toBe(testCase.minutes);
      expect(projected.totalFloatWorkdays).toBe(testCase.expectedWorkdays);
    }
  });

  it("keeps canonical *Minutes values separate from projected *Workdays values", () => {
    const projected = projectFutureContractShape({ totalFloatMinutes: 481 });

    expect(projected).toStrictEqual({
      totalFloatMinutes: 481,
      totalFloatWorkdays: 481 / 480,
    });
    expect(Number.isInteger(projected.totalFloatMinutes)).toBe(true);
    expect(projected.totalFloatWorkdays).not.toBe(projected.totalFloatMinutes);
  });

  it("does not mutate input facts while deriving projected workday values", () => {
    const input: FutureProjectionContractInput = {
      totalFloatMinutes: 481,
      freeFloatMinutes: 961,
      minutesPerDay: MINUTES_PER_DAY,
    };

    const inputSnapshot = structuredClone(input);
    const projected = projectFutureContractShape(input);

    expect(input).toStrictEqual(inputSnapshot);
    expect(projected.totalFloatMinutes).toBe(481);
    expect(projected.totalFloatWorkdays).toBe(481 / 480);
    expect(projected.freeFloatMinutes).toBe(961);
    expect(projected.freeFloatWorkdays).toBe(961 / 480);
  });

  it("documents freeFloat pairing as a future contract expectation only", () => {
    const projected = projectFutureContractShape({
      totalFloatMinutes: 480,
      freeFloatMinutes: 479,
    });

    expect(projected).toMatchObject({
      totalFloatMinutes: 480,
      totalFloatWorkdays: 1,
      freeFloatMinutes: 479,
      freeFloatWorkdays: 479 / 480,
    });
  });

  it("documents that projected workdays are derived display values, not authoritative inputs", () => {
    const canonicalMinutes = 481;
    const projected = projectFutureContractShape({ totalFloatMinutes: canonicalMinutes });

    const simulatedAuthoritativeInput = projected.totalFloatMinutes;

    expect(simulatedAuthoritativeInput).toBe(canonicalMinutes);
    expect(projected.totalFloatWorkdays).toBe(481 / 480);
  });
});
