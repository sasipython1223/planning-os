import { DAY_WIDTH } from "./ganttConstants";
import type { TimescaleModel } from "./timescaleModel";

/** Mutable drag state held in a ref — never stored in React state. */
export interface DragState {
  active: boolean;
  taskId: string;
  mode: "right-resize" | "move";
  initialWorldX: number;
  currentWorldX: number;
  initialDuration: number;
  /** Original earlyStart of the task (for move preview). */
  initialEarlyStart: number;
}

type DragPreviewScale = Pick<TimescaleModel, "xToDay"> | number;

export function emptyDrag(): DragState {
  return {
    active: false,
    taskId: "",
    mode: "right-resize",
    initialWorldX: 0,
    currentWorldX: 0,
    initialDuration: 0,
    initialEarlyStart: 0,
  };
}

function snapDeltaDays(drag: DragState, scale: DragPreviewScale = DAY_WIDTH): number {
  if (typeof scale === "number") {
    // Compatibility fallback for width-only callers.
    return Math.round((drag.currentWorldX - drag.initialWorldX) / scale);
  }

  return Math.round(scale.xToDay(drag.currentWorldX) - scale.xToDay(drag.initialWorldX));
}

/**
 * Pure preview duration from drag delta.
 * Snaps to integer days, minimum 1.
 */
export function previewDuration(drag: DragState, scale: DragPreviewScale = DAY_WIDTH): number {
  const deltaDays = snapDeltaDays(drag, scale);
  return Math.max(1, drag.initialDuration + deltaDays);
}

/**
 * Pure preview earlyStart from move-drag delta.
 * Snaps to integer days, minimum 0.
 */
export function previewEarlyStart(drag: DragState, scale: DragPreviewScale = DAY_WIDTH): number {
  const deltaDays = snapDeltaDays(drag, scale);
  return Math.max(0, drag.initialEarlyStart + deltaDays);
}
