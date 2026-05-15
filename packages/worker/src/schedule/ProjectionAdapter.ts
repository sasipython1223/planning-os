const DEFAULT_MINUTES_PER_DAY = 480;

type TotalFloatProjectionInput = {
  totalFloat: number;
};

export type ProjectedTotalFloat<TInput extends TotalFloatProjectionInput> = TInput & {
  totalFloatMinutes: number;
  totalFloatWorkdays: number;
};

export const projectScheduleResult = <TInput extends TotalFloatProjectionInput>(
  input: TInput,
  minutesPerDay = DEFAULT_MINUTES_PER_DAY,
): ProjectedTotalFloat<TInput> => {
  return {
    ...input,
    totalFloatMinutes: input.totalFloat,
    totalFloatWorkdays: input.totalFloat / minutesPerDay,
  };
};
