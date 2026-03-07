import { useMemo } from "react";

export const OVERSCAN = 3;

export interface VirtualWindow {
  /** First task index to render (inclusive) */
  startIndex: number;
  /** Last task index to render (inclusive) */
  endIndex: number;
  /** translateY offset for the rendered slice (px) */
  offsetY: number;
  /** Total content height (px) — used for phantom spacer */
  totalHeight: number;
}

/**
 * Pure virtual-window math. Shared by TaskTable (via the hook) and
 * drawGantt (called directly). Does NOT own scrolling.
 */
export function computeVirtualWindow(
  itemCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
): VirtualWindow {
  const totalHeight = itemCount * rowHeight;

  if (itemCount === 0 || viewportHeight === 0) {
    return { startIndex: 0, endIndex: -1, offsetY: 0, totalHeight };
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );
  const offsetY = startIndex * rowHeight;

  return { startIndex, endIndex, offsetY, totalHeight };
}

/**
 * React hook wrapper — returns a memoized VirtualWindow.
 */
export function useVirtualWindow(
  itemCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
): VirtualWindow {
  return useMemo(
    () => computeVirtualWindow(itemCount, rowHeight, scrollTop, viewportHeight),
    [itemCount, rowHeight, scrollTop, viewportHeight],
  );
}
