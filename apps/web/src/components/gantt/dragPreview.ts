import { DAY_WIDTH } from "./ganttConstants";

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

/**
 * Pure preview duration from drag delta.
 * Snaps to integer days, minimum 1.
 */
export function previewDuration(drag: DragState): number {
  const deltaX = drag.currentWorldX - drag.initialWorldX;
  const deltaDays = Math.round(deltaX / DAY_WIDTH);
  return Math.max(1, drag.initialDuration + deltaDays);
}

/**
 * Pure preview earlyStart from move-drag delta.
 * Snaps to integer days, minimum 0.
 */
export function previewEarlyStart(drag: DragState): number {
  const deltaX = drag.currentWorldX - drag.initialWorldX;
  const deltaDays = Math.round(deltaX / DAY_WIDTH);
  return Math.max(0, drag.initialEarlyStart + deltaDays);
}
