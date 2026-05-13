/**
 * Pure UTC-safe date projection utilities.
 * Maps integer day offsets from a project start date to real calendar dates.
 * 1 integer day = 1 calendar day (no working-day calendar logic).
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse an ISO date string (YYYY-MM-DD) to a UTC midnight Date. */
function parseUTC(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Add integer days to a UTC Date, returning a new Date. */
function addDaysUTC(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * Project an integer day offset to a real UTC Date.
 * dayOffset is the CPM kernel unit: 1 unit = 1 calendar day.
 * @param projectStartDate ISO date string (YYYY-MM-DD)
 * @param dayOffset integer day offset from CPM kernel (earlyStartMinutes field)
 */
export function projectDate(projectStartDate: string, dayOffset: number): Date {
  return addDaysUTC(parseUTC(projectStartDate), dayOffset);
}

/**
 * Project a calendar-minute offset (from parseOffsetMinutes mapper) to a real UTC Date.
 * Source actual dates are stored as calendar minutes from project start.
 * @param projectStartDate ISO date string (YYYY-MM-DD)
 * @param minuteOffset calendar minutes from project start (actualStartMinutes etc.)
 */
export function projectDateFromMinutes(projectStartDate: string, minuteOffset: number): Date {
  return new Date(parseUTC(projectStartDate).getTime() + minuteOffset * MS_PER_MINUTE);
}

/**
 * Format a UTC Date as a short human-readable string: "Mar 7".
 */
export function formatDateShort(date: Date): string {
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Format a UTC Date as ISO-style: "2026-03-07".
 */
export function formatDateISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Display format ────────────────────────────────────────────────────────

/**
 * User-selectable date display formats.
 * The first four options are the P6 / XER-style formats.
 */
export type DateDisplayFormat =
  | "DD-MMM-YY"
  | "DD-MMM-YYYY"
  | "YYYY-MM-DD"
  | "DD-MMM-YY HH:mm"
  | "YYYY-MM-DD HH:mm";

export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = "DD-MMM-YY";

export const DATE_DISPLAY_FORMAT_OPTIONS: ReadonlyArray<{ value: DateDisplayFormat; label: string; example: string }> = [
  { value: "DD-MMM-YY",      label: "DD-MMM-YY",        example: "08-May-26" },
  { value: "DD-MMM-YYYY",    label: "DD-MMM-YYYY",      example: "08-May-2026" },
  { value: "YYYY-MM-DD",     label: "YYYY-MM-DD",       example: "2026-05-08" },
  { value: "DD-MMM-YY HH:mm",   label: "DD-MMM-YY HH:mm",   example: "08-May-26 08:00" },
  { value: "YYYY-MM-DD HH:mm",  label: "YYYY-MM-DD HH:mm",  example: "2026-05-08 08:00" },
];

/**
 * Format a UTC Date according to the chosen display format.
 */
export function formatWithDisplayFormat(date: Date, format: DateDisplayFormat): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[date.getUTCMonth()];
  const y4 = String(date.getUTCFullYear());
  const y2 = y4.slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  switch (format) {
    case "DD-MMM-YY":         return `${dd}-${mon}-${y2}`;
    case "DD-MMM-YYYY":       return `${dd}-${mon}-${y4}`;
    case "YYYY-MM-DD":        return `${y4}-${mm}-${dd}`;
    case "DD-MMM-YY HH:mm":  return `${dd}-${mon}-${y2} ${hh}:${mi}`;
    case "YYYY-MM-DD HH:mm": return `${y4}-${mm}-${dd} ${hh}:${mi}`;
  }
}

/**
 * Project a CPM day-offset and format with the chosen display format.
 * Use for schedule result dates (earlyStartMinutes, earlyFinishMinutes etc.).
 */
export function projectDateFormatted(
  projectStartDate: string,
  dayOffset: number,
  format: DateDisplayFormat,
): string {
  return formatWithDisplayFormat(projectDate(projectStartDate, dayOffset), format);
}

/**
 * Project a calendar-minute offset and format with the chosen display format.
 * Use for source actual dates (actualStartMinutes, actualFinishMinutes etc.).
 */
export function projectDateFromMinutesFormatted(
  projectStartDate: string,
  minuteOffset: number,
  format: DateDisplayFormat,
): string {
  return formatWithDisplayFormat(projectDateFromMinutes(projectStartDate, minuteOffset), format);
}

/**
 * Parse a source date string (date-only or date-time) and format it for display.
 * If the source string has no explicit time component, HH:mm formats degrade to date-only.
 */
export function formatSourceDateString(sourceDate: string, format: DateDisplayFormat): string | undefined {
  if (!sourceDate) return undefined;

  const m = sourceDate.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (!m) return undefined;

  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  const hasTime = m[4] != null && m[5] != null;
  const hh = hasTime ? Number(m[4]) : 0;
  const mi = hasTime ? Number(m[5]) : 0;
  const date = new Date(Date.UTC(y, mon - 1, d, hh, mi, 0));

  if (!hasTime && (format === "DD-MMM-YY HH:mm" || format === "YYYY-MM-DD HH:mm")) {
    return formatWithDisplayFormat(date, format === "DD-MMM-YY HH:mm" ? "DD-MMM-YY" : "YYYY-MM-DD");
  }

  return formatWithDisplayFormat(date, format);
}

/**
 * Convenience: project + format short in one call.
 * @deprecated Prefer projectDateFormatted with an explicit DateDisplayFormat.
 */
export function projectDateShort(projectStartDate: string, dayOffset: number): string {
  return formatDateShort(projectDate(projectStartDate, dayOffset));
}
