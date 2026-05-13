/**
 * Constants for Gantt chart rendering.
 * Derived from the single spatial authority: GEOMETRY.
 *
 * Static exports (ROW_HEIGHT, TIMESCALE_HEIGHT, etc.) reflect the default
 * "cozy" density and are used in tests. Runtime rendering should call
 * getDensityConstants() to get density-aware values.
 */

import { GEOMETRY } from "../../constants/geometry";
import { DENSITY_CONFIG } from "../../ui/config/themeConfig";
import { getDensityMetrics } from "../../ui/store/uiStore";

export const ROW_HEIGHT = DENSITY_CONFIG.cozy.rowHeight;
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
  dependency: "#8f9baa",
};

// ── Phase 6: Gantt visual tokens ───────────────────────────────────────
export const GANTT_VISUAL = {
  /** Rounded corner radius for standard task bars */
  BAR_RADIUS: 3,

  /** Height of baseline bars (thinner than live bars) */
  BASELINE_BAR_HEIGHT: 4,
  /** Vertical gap between bottom of live bar and top of baseline */
  BASELINE_OFFSET_Y: 2,
  /** Fill color for baseline bars */
  BASELINE_FILL: "#9ca3af",

  /** Half-diagonal of the milestone diamond (px) */
  MILESTONE_SIZE: 10,
  /** Fill for normal milestones */
  MILESTONE_FILL: "#1976d2",
  /** Fill for critical milestones */
  MILESTONE_CRITICAL_FILL: "#d32f2f",

  /** Height of the summary bracket thin bar */
  SUMMARY_BAR_HEIGHT: 6,
  /** Height of downward ticks on summary bracket */
  SUMMARY_TICK_HEIGHT: 8,
  /** Width of each tick */
  SUMMARY_TICK_WIDTH: 3,
  /** Fill for non-critical summary bracket */
  SUMMARY_FILL: "#202124",

  /** Standard task bar fill (alias for COLORS.nonCritical) */
  TASK_BAR_FILL: "#1976d2",
  /** Critical task bar fill (alias for COLORS.critical) */
  TASK_BAR_CRITICAL_FILL: "#d32f2f",
} as const;
