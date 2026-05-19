/**
 * Shared timeline geometry — single source of truth for X-coordinate math.
 * Consumed by both Gantt and Histogram to ensure identical alignment.
 * No new Date(), Date.parse(), local timezone, or getTimezoneOffset() here.
 */

import { GEOMETRY } from "../constants/geometry";

const MS_PER_DAY = 86_400_000;

/** Shared geometry contract — derived once, consumed by all timeline components. */
export interface TimelineGeometry {
  /** UTC epoch ms — timeline origin (project start midnight UTC) */
  timelineStart: number;
  /** UTC epoch ms — timeline end (maxDay days from start) */
  timelineEnd: number;
  /** Zoom multiplier (reserved for future zoom, currently 1) */
  zoomLevel: number;
  /** Pixels per calendar day */
  pixelsPerDay: number;
  /** Column width in pixels (= pixelsPerDay at zoom 1) */
  columnWidth: number;
  /** Total scrollable width in pixels — used by both Gantt and Histogram phantom sizers */
  totalTimelineWidth: number;
  /** Max day offset for visibility clipping */
  maxDay: number;
  /** Project start date as YYYY-MM-DD */
  projectStartDate: string;
}

/**
 * Parse an ISO-style date string to a UTC epoch ms.
 *
 * Accepts the strict canonical form `YYYY-MM-DD` and the common XER /
 * Primavera form `YYYY-MM-DD HH:MM[:SS]` (the date portion before the first
 * space is used). Falls back to today's UTC midnight if the input is missing
 * or unparseable so the timeline geometry never propagates `NaN` widths or
 * pixel offsets (which would break Gantt/Histogram rendering downstream).
 * Pure integer math, no Date objects beyond the fallback path.
 */
function parseUTCMs(isoDate: string): number {
  const datePart = (isoDate ?? "").split(/[ T]/, 1)[0];
  const parts = datePart.split("-");
  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const ms = Date.UTC(y, m - 1, d);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Derive shared timeline geometry from schedule results.
 * Called once in App, consumed by all timeline-aware components.
 */
export function computeTimelineGeometry(
  scheduleResults: Record<string, { earlyFinish: number }>,
  projectStartDate: string,
): TimelineGeometry {
  let maxFinish = 20;
  for (const s of Object.values(scheduleResults)) {
    if (s.earlyFinish > maxFinish) maxFinish = s.earlyFinish;
  }
  const maxDay = Math.ceil(maxFinish * 1.2);

  const pixelsPerDay = GEOMETRY.DAY_WIDTH;
  const timelineStart = parseUTCMs(projectStartDate);

  return {
    timelineStart,
    timelineEnd: timelineStart + maxDay * MS_PER_DAY,
    zoomLevel: 1,
    pixelsPerDay,
    columnWidth: pixelsPerDay,
    totalTimelineWidth: maxDay * pixelsPerDay + 100,
    maxDay,
    projectStartDate,
  };
}

/**
 * Convert UTC epoch ms to pixel X offset from timeline start.
 * Pure integer math — no Date objects, no timezone conversions.
 */
export function getPixelOffsetFromDate(
  dateMs: number,
  timelineStart: number,
  pixelsPerDay: number,
): number {
  return ((dateMs - timelineStart) / MS_PER_DAY) * pixelsPerDay;
}
