type TotalFloatWithMinutes = {
  totalFloat: number;
  totalFloatMinutes?: number;
};

export const getTotalFloatMinutesForComparison = (value: TotalFloatWithMinutes): number =>
  typeof value.totalFloatMinutes === "number"
    ? value.totalFloatMinutes
    : value.totalFloat;

export const maxAbsTotalFloatVarianceMinutes = (
  pairs: ReadonlyArray<{
    left: TotalFloatWithMinutes;
    right: TotalFloatWithMinutes;
  }>,
): number =>
  pairs.reduce((max, pair) => {
    const variance = Math.abs(
      getTotalFloatMinutesForComparison(pair.left) - getTotalFloatMinutesForComparison(pair.right),
    );
    return variance > max ? variance : max;
  }, 0);
