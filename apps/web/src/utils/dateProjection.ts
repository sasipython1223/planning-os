/**
 * Pure UTC-safe date projection utilities.
 * Maps integer day offsets from a project start date to real calendar dates.
 * 1 integer day = 1 calendar day (no working-day calendar logic).
 */

const MS_PER_DAY = 86_400_000;

/**
 * Parse an ISO date string to a UTC midnight Date.
 *
 * Accepts the strict canonical form `YYYY-MM-DD` and the common XER /
 * Primavera form `YYYY-MM-DD HH:MM[:SS]` (the date portion before the first
 * space is used). Falls back to today's UTC midnight if the input is missing
 * or unparseable so downstream date math never propagates `NaN` into the UI
 * (which previously surfaced as "undefined NaN" in the Gantt timescale).
 */
function parseUTC(isoDate: string): Date {
  const datePart = (isoDate ?? "").split(/[ T]/, 1)[0];
  const parts = datePart.split("-");
  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const ms = Date.UTC(y, m - 1, d);
      if (!Number.isNaN(ms)) return new Date(ms);
    }
  }
  // Fallback: today at UTC midnight (keeps the timescale rendering valid).
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Add integer days to a UTC Date, returning a new Date. */
function addDaysUTC(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * Project an integer day offset to a real UTC Date.
 * @param projectStartDate ISO date string (YYYY-MM-DD)
 * @param dayOffset integer day offset from CPM kernel
 */
export function projectDate(projectStartDate: string, dayOffset: number): Date {
  return addDaysUTC(parseUTC(projectStartDate), dayOffset);
}

/**
 * Format a UTC Date as a short human-readable string: "Mar 7".
 */
export function formatDateShort(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
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

/**
 * Convenience: project + format short in one call.
 */
export function projectDateShort(projectStartDate: string, dayOffset: number): string {
  return formatDateShort(projectDate(projectStartDate, dayOffset));
}
