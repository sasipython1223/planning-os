import type { Resource } from "protocol";

export interface DrawHistogramOptions {
  ctx: CanvasRenderingContext2D;
  histogram: Record<number, number> | undefined;
  selectedResource: Resource;
  scrollLeft: number;
  viewportWidth: number;
  dayWidth: number;
  height: number;
}

/**
 * Draw resource loading histogram bars on a canvas.
 * Blue for normal load, red for overallocation.
 */
export function drawHistogram({
  ctx,
  histogram,
  selectedResource,
  scrollLeft,
  viewportWidth,
  dayWidth,
  height,
}: DrawHistogramOptions): void {
  ctx.clearRect(0, 0, viewportWidth, height);

  if (!histogram) return;

  const visibleStart = Math.floor(scrollLeft / dayWidth);
  const visibleEnd = visibleStart + Math.ceil(viewportWidth / dayWidth) + 1;
  const maxUnits = selectedResource.maxUnitsPerDay;

  // Draw capacity line
  const capacityY = height - (maxUnits > 0 ? height : 0);
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, capacityY);
  ctx.lineTo(viewportWidth, capacityY);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let day = visibleStart; day <= visibleEnd; day++) {
    const units = histogram[day] || 0;
    if (units === 0) continue;

    const x = day * dayWidth - scrollLeft;
    const ratio = maxUnits > 0 ? Math.min(units / maxUnits, 1.5) : 0;
    const barHeight = ratio * height / 1.5;

    ctx.fillStyle = units > maxUnits ? "#d32f2f" : "#1976d2";
    ctx.fillRect(x, height - barHeight, dayWidth - 1, barHeight);
  }
}
