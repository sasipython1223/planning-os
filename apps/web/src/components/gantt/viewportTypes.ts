/**
 * Viewport model for the Gantt canvas.
 * Carries scroll offsets and visible area dimensions.
 */
export interface Viewport {
  scrollTop: number;
  scrollLeft: number;
  viewportWidth: number;
  viewportHeight: number;
}
