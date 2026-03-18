export type DensityMode = 'compact' | 'comfortable' | 'cozy';
export type ThemeMode = 'light' | 'dark';

export interface DensityMetrics {
  rowHeight: number;
  timelineHeight: number;
}

/**
 * Canonical density geometry — TypeScript is the source of truth.
 * CSS must NOT define these values for layout math.
 */
export const DENSITY_CONFIG: Record<DensityMode, DensityMetrics> = {
  compact:     { rowHeight: 24, timelineHeight: 48 },
  comfortable: { rowHeight: 32, timelineHeight: 64 },
  cozy:        { rowHeight: 40, timelineHeight: 80 },
} as const;

/** Shared header geometry — single source of truth for table + gantt headers. */
export const HEADER_METRICS = {
  totalHeight: 48,
  tierHeight: 24,
  borderBottom: 1,
} as const;

export const getVirtualizerTopOffset = () =>
  HEADER_METRICS.totalHeight + HEADER_METRICS.borderBottom;
