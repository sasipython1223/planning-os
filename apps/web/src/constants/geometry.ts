import { DENSITY_CONFIG, HEADER_METRICS } from "../ui/config/themeConfig";

const DEFAULT_DENSITY = "cozy" as const;

export const GEOMETRY = {
  // Default fixed-height policy for the synchronized schedule view.
  // Runtime density-aware rendering uses useDensityMetrics/getDensityMetrics.
  ROW_HEIGHT: DENSITY_CONFIG[DEFAULT_DENSITY].rowHeight,
  BAR_HEIGHT: 20,
  HEADER_HEIGHT: HEADER_METRICS.totalHeight,
  DAY_WIDTH: 20,
} as const;
