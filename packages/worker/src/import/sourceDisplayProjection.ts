import type { ScheduleResultMap, SourceTaskDates, Task, WorkMinutes } from "@planner/protocol";

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY_ELAPSED = 1_440;

export function normalizeImportedProjectStartDate(projectStartDate: string): string {
  const trimmed = projectStartDate.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Date(parsed).toISOString().slice(0, 10);
}

function toSourceDayOffset(
  rawDate: string | undefined,
  storedOffsetMinutes: number | undefined,
  projectStartDate: string,
): WorkMinutes | undefined {
  // Prefer canonical source minute offsets when available so source HH:mm
  // remains stable in sourceImportedNotCalculated display projection.
  if (storedOffsetMinutes !== undefined) {
    return (storedOffsetMinutes / MINUTES_PER_DAY_ELAPSED) as WorkMinutes;
  }

  const normalizedProjectStartDate = normalizeImportedProjectStartDate(projectStartDate);
  const projectStartMs = Date.parse(normalizedProjectStartDate);

  if (rawDate && !Number.isNaN(projectStartMs)) {
    const sourceMs = Date.parse(rawDate);
    if (!Number.isNaN(sourceMs)) {
      return ((sourceMs - projectStartMs) / MS_PER_DAY) as WorkMinutes;
    }
  }

  return undefined;
}

export function buildSourceImportedLeafDisplayScheduleResults(
  tasks: readonly Task[],
  fallbackScheduleResults: ScheduleResultMap,
  sourceDatesByTaskId: Readonly<Record<string, SourceTaskDates>>,
  projectStartDate: string,
): ScheduleResultMap {
  const displayScheduleResults: ScheduleResultMap = {};

  for (const task of tasks) {
    const fallback = fallbackScheduleResults[task.id];
    const sourceDates = sourceDatesByTaskId[task.id];
    const sourceStart = toSourceDayOffset(sourceDates?.sourceRawStart, sourceDates?.sourceStartMinutes, projectStartDate);
    const sourceFinish = toSourceDayOffset(sourceDates?.sourceRawFinish, sourceDates?.sourceFinishMinutes, projectStartDate);

    const earlyStart = sourceStart ?? fallback?.earlyStartMinutes;
    const earlyFinish = sourceFinish ?? fallback?.earlyFinishMinutes;

    if (earlyStart === undefined || earlyFinish === undefined) continue;

    displayScheduleResults[task.id] = {
      earlyStartMinutes: earlyStart,
      earlyFinishMinutes: earlyFinish,
      lateStartMinutes: sourceStart ?? fallback?.lateStartMinutes ?? earlyStart,
      lateFinishMinutes: sourceFinish ?? fallback?.lateFinishMinutes ?? earlyFinish,
      totalFloatMinutes: fallback?.totalFloatMinutes ?? (0 as WorkMinutes),
      isCritical: fallback?.isCritical ?? false,
    };
  }

  return displayScheduleResults;
}