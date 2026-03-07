/** Mutable pan state held in a ref — never stored in React state. */
export interface PanState {
  active: boolean;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

export function emptyPan(): PanState {
  return {
    active: false,
    startClientX: 0,
    startClientY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  };
}
