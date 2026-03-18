import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConstraintFilter } from '../../utils/filterByConstraint';
import { DENSITY_CONFIG, type DensityMetrics, type DensityMode, type ThemeMode } from '../config/themeConfig';

export type BottomTab = 'task-details' | 'logs' | 'histogram';

interface UIState {
  theme: ThemeMode;
  density: DensityMode;
  setTheme: (theme: ThemeMode) => void;
  setDensity: (density: DensityMode) => void;

  // Bottom drawer
  isBottomOpen: boolean;
  bottomHeight: number;
  activeBottomTab: BottomTab;
  toggleBottomDrawer: (forceOpen?: boolean) => void;
  setBottomHeight: (height: number) => void;
  setActiveBottomTab: (tab: BottomTab) => void;

  // Status text (display-only, not persisted)
  statusText: string;
  setStatusText: (text: string) => void;

  // Constraint filter (view-only, not persisted)
  constraintFilter: ConstraintFilter;
  setConstraintFilter: (filter: ConstraintFilter) => void;

  // Splitter
  tableWidth: number;
  setTableWidth: (width: number) => void;
}

const MIN_DRAWER = 120;
const maxDrawer = () => Math.floor(window.innerHeight * 0.35);

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'light',
      density: 'cozy',
      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),

      isBottomOpen: false,
      bottomHeight: 250,
      activeBottomTab: 'task-details',
      toggleBottomDrawer: (forceOpen) =>
        set((s) => ({ isBottomOpen: forceOpen ?? !s.isBottomOpen })),
      setBottomHeight: (height) =>
        set({ bottomHeight: Math.max(MIN_DRAWER, Math.min(height, maxDrawer())) }),
      setActiveBottomTab: (tab) =>
        set({ activeBottomTab: tab, isBottomOpen: true }),

      statusText: '',
      setStatusText: (text) => set({ statusText: text }),

      constraintFilter: 'all',
      setConstraintFilter: (filter) => set({ constraintFilter: filter }),

      tableWidth: 400,
      setTableWidth: (width) => set({ tableWidth: width }),
    }),
    {
      name: 'planner-ui',
      partialize: (state) => ({
        theme: state.theme,
        density: state.density,
        bottomHeight: state.bottomHeight,
        activeBottomTab: state.activeBottomTab,
        tableWidth: state.tableWidth,
      }),
    },
  ),
);

/** Hook returning the current density metrics from DENSITY_CONFIG. */
export function useDensityMetrics(): DensityMetrics {
  const density = useUIStore((s) => s.density);
  return DENSITY_CONFIG[density];
}

/**
 * Non-React accessor for density metrics.
 * Use in pure functions (canvas draw, hit-test) that cannot call hooks.
 */
export function getDensityMetrics(): DensityMetrics {
  return DENSITY_CONFIG[useUIStore.getState().density];
}
