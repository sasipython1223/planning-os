/** Mutable link-drag state held in a ref — never stored in React state. */
export interface LinkDragState {
  active: boolean;
  sourceTaskId: string;
  sourceX: number;
  sourceY: number;
  currentWorldX: number;
  currentWorldY: number;
  targetTaskId: string | null;
}

export function emptyLinkDrag(): LinkDragState {
  return {
    active: false,
    sourceTaskId: "",
    sourceX: 0,
    sourceY: 0,
    currentWorldX: 0,
    currentWorldY: 0,
    targetTaskId: null,
  };
}
