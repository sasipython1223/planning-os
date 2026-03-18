/**
 * Constants for Gantt chart rendering.
 * Derived from the single spatial authority: GEOMETRY.
 *
 * Static exports (ROW_HEIGHT, TIMESCALE_HEIGHT, etc.) reflect the default
 * "cozy" density and are used in tests. Runtime rendering should call
 * getDensityConstants() to get density-aware values.
 */

import { GEOMETRY } from "../../constants/geometry";
import { getDensityMetrics } from "../../ui/store/uiStore";

export const ROW_HEIGHT = GEOMETRY.ROW_HEIGHT;
export const DAY_WIDTH = GEOMETRY.DAY_WIDTH;
export const TIMESCALE_HEIGHT = GEOMETRY.HEADER_HEIGHT;
export const BAR_HEIGHT = GEOMETRY.BAR_HEIGHT;
export const BAR_VERTICAL_PADDING = (ROW_HEIGHT - BAR_HEIGHT) / 2;

/** Density-aware runtime constants. Call this in rendering paths. */
export function getDensityConstants() {
  const { rowHeight, timelineHeight } = getDensityMetrics();
  const barVerticalPadding = (rowHeight - BAR_HEIGHT) / 2;
  return { rowHeight, timelineHeight, barHeight: BAR_HEIGHT, barVerticalPadding, dayWidth: DAY_WIDTH };
}

export const COLORS = {
  critical: "#d32f2f",
  nonCritical: "#1976d2",
  background: "#ffffff",
  grid: "#e0e0e0",
  text: "#333333",
  timescaleBackground: "#f5f5f5",
  dependency: "#666666",
};
