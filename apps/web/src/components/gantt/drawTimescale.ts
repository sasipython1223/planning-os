import { formatDateShort, projectDate } from "../../utils/dateProjection";
import { COLORS, DAY_WIDTH, TIMESCALE_HEIGHT } from "./ganttConstants";

/**
 * Draws the timescale (date ruler) on a viewport-sized canvas.
 * Translates by scrollLeft to show the correct time range.
 * Pure function - no side effects beyond canvas rendering.
 */
export function drawTimescale(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  maxDay: number,
  scrollLeft: number,
  projectStartDate: string,
  nonWorkingDays: ReadonlySet<number>,
): void {
  const height = TIMESCALE_HEIGHT;

  // Clear background (viewport-sized)
  ctx.fillStyle = COLORS.timescaleBackground;
  ctx.fillRect(0, 0, viewportWidth, height);

  // Translate to world coordinates
  ctx.save();
  ctx.translate(-scrollLeft, 0);

  // Compute visible day range for efficient rendering
  const firstVisibleDay = Math.max(0, Math.floor(scrollLeft / DAY_WIDTH) - 1);
  const lastVisibleDay = Math.min(maxDay, Math.ceil((scrollLeft + viewportWidth) / DAY_WIDTH) + 1);

  // Shade non-working day columns
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  for (let day = firstVisibleDay; day <= lastVisibleDay; day++) {
    if (nonWorkingDays.has(day)) {
      ctx.fillRect(day * DAY_WIDTH, 0, DAY_WIDTH, height);
    }
  }

  // Draw ticks and labels
  ctx.fillStyle = COLORS.text;
  ctx.font = "11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let day = firstVisibleDay; day <= lastVisibleDay; day++) {
    const x = day * DAY_WIDTH;

    // Draw tick mark
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(x, height - 10);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Draw date label every 5 days or at start
    if (day % 5 === 0 || day === 0) {
      const date = projectDate(projectStartDate, day);
      const label = formatDateShort(date);
      ctx.fillText(label, x, height / 2);
    }
  }

  // Bottom border
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  ctx.moveTo(scrollLeft, height);
  ctx.lineTo(scrollLeft + viewportWidth, height);
  ctx.stroke();

  ctx.restore();
}
