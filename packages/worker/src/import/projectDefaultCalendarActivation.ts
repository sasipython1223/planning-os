import type {
    BaseCalendarDefinition,
    CalendarConfig,
    CalendarId,
    SourceImportRecord,
    WorkMinutes,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { compileCalendar } from "../calendarRegistry.js";

export type ProjectDefaultCalendarActivation = {
  readonly calendarId: CalendarId;
  readonly calendarConfig: CalendarConfig;
  readonly activated: boolean;
  readonly reason?: string;
};

const asMinutesPerDay = (minutes: number): WorkMinutes => Math.round(minutes) as WorkMinutes;

const buildCalendarConfigFromDefinition = (
  def: BaseCalendarDefinition,
): CalendarConfig | null => {
  const compiled = compileCalendar(def);
  if (compiled.weeklyMinutes <= 0) return null;

  const sourceMinutes =
    typeof def.sourceHoursPerDay === "number" && Number.isFinite(def.sourceHoursPerDay) && def.sourceHoursPerDay > 0
      ? def.sourceHoursPerDay * 60
      : undefined;

  const workingDayMinutes = compiled.dailyMinutes.filter((m) => m > 0);
  const averageMinutes =
    workingDayMinutes.length > 0
      ? workingDayMinutes.reduce((sum, m) => sum + m, 0) / workingDayMinutes.length
      : MINUTES_PER_DAY;

  const minutesPerDay = asMinutesPerDay(sourceMinutes ?? averageMinutes ?? MINUTES_PER_DAY);

  const isMonToFriPattern =
    compiled.dailyMinutes[0] === 0 &&
    compiled.dailyMinutes[6] === 0 &&
    compiled.dailyMinutes.slice(1, 6).every((m) => m > 0);

  const holidays = def.exceptions
    .filter((ex) => ex.workIntervals.length === 0)
    .map((ex) => ex.date)
    .filter((date, idx, all) => all.indexOf(date) === idx)
    .sort();

  return {
    id: def.id,
    name: def.name,
    minutesPerDay,
    // CalendarConfig has only MON_FRI / ALL_DAYS. For non-Mon-Fri patterns
    // (e.g. 6-day), use ALL_DAYS and let compiled-calendar indexing drive NWD.
    workingWeekPattern: isMonToFriPattern ? "MON_FRI" : "ALL_DAYS",
    holidays,
  };
};

export function resolveImportedProjectDefaultCalendarActivation(
  sourceRecord: SourceImportRecord,
  fallbackCalendarId: CalendarId,
  fallbackCalendarConfig: CalendarConfig,
  resolvedDefinitions: Readonly<Record<string, BaseCalendarDefinition>>,
  rawDefinitions: Readonly<Record<string, BaseCalendarDefinition>>,
): ProjectDefaultCalendarActivation {
  const defaultId = sourceRecord.sourceProjectSettings?.defaultCalendarId;
  if (!defaultId) {
    return {
      calendarId: fallbackCalendarId,
      calendarConfig: fallbackCalendarConfig,
      activated: false,
      reason: "Source project has no default calendar id",
    };
  }

  const sourceDefinitions =
    sourceRecord.resolvedCalendarDefinitions ?? sourceRecord.calendarDefinitions ?? {};

  const defaultKey = String(defaultId);

  const resolvedDefinition =
    sourceDefinitions[defaultKey as CalendarId] ??
    resolvedDefinitions[defaultKey] ??
    rawDefinitions[defaultKey];

  if (!resolvedDefinition) {
    return {
      calendarId: fallbackCalendarId,
      calendarConfig: fallbackCalendarConfig,
      activated: false,
      reason: `Imported default calendar ${defaultId} is not available in definitions`,
    };
  }

  const compiledConfig = buildCalendarConfigFromDefinition(resolvedDefinition);
  if (!compiledConfig) {
    return {
      calendarId: fallbackCalendarId,
      calendarConfig: fallbackCalendarConfig,
      activated: false,
      reason: `Imported default calendar ${defaultId} has no working time`,
    };
  }

  return {
    calendarId: resolvedDefinition.id,
    calendarConfig: compiledConfig,
    activated: true,
  };
}
