import type { Resource } from "protocol";

// ── Palette ─────────────────────────────────────────────────────
export const HIST_COLOR_NORMAL = "#1976d2";
export const HIST_COLOR_OVER = "#d32f2f";

// ── Y-axis tick computation (shared by axis pane + chart) ───────

/** Nice tick step for roughly 3-6 ticks across [0, max]. */
function niceStep(max: number): number {
  if (max <= 0) return 1;
  const rough = max / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

export interface YTick { value: number; y: number; label: string }

/**
 * Compute Y-axis ticks and a value→Y mapping.
 * `scaleMax` is the top of the drawn range (1.25× capacity, or
 * 1.25× highest bar — whichever is larger).
 */
export function computeYScale(
  capacity: number,
  histogram: Record<number, number> | undefined,
  chartHeight: number,
): { ticks: YTick[]; scaleMax: number; valueToY: (v: number) => number } {
  let dataMax = capacity;
  if (histogram) {
    for (const v of Object.values(histogram)) {
      if (v > dataMax) dataMax = v;
    }
  }
  const scaleMax = Math.max(dataMax * 1.25, capacity * 1.25, 1);

  const valueToY = (v: number) => chartHeight - (v / scaleMax) * chartHeight;

  const step = niceStep(scaleMax);
  const ticks: YTick[] = [];
  for (let v = 0; v <= scaleMax; v += step) {
    ticks.push({ value: v, y: valueToY(v), label: v === 0 ? "0" : `${v}h` });
  }
  // Ensure capacity tick is present
  if (!ticks.some((t) => t.value === capacity) && capacity > 0) {
    ticks.push({ value: capacity, y: valueToY(capacity), label: `${capacity}h` });
    ticks.sort((a, b) => a.value - b.value);
  }
  return { ticks, scaleMax, valueToY };
}

// ── Draw options ────────────────────────────────────────────────

export interface DrawHistogramOptions {
  ctx: CanvasRenderingContext2D;
  histogram: Record<number, number> | undefined;
  selectedResource: Resource;
  scrollLeft: number;
  viewportWidth: number;
  pixelsPerDay: number;
  height: number;
}

/**
 * Draw resource loading histogram on a canvas.
 * Draws gridlines → threshold line → split-stack bars.
 */
export function drawHistogram({
  ctx,
  histogram,
  selectedResource,
  scrollLeft,
  viewportWidth,
  pixelsPerDay,
  height,
}: DrawHistogramOptions): void {
  ctx.clearRect(0, 0, viewportWidth, height);
  if (!histogram) return;

  const capacity = selectedResource.maxUnitsPerDay;
  const { ticks, valueToY } = computeYScale(capacity, histogram, height);

  // ── 1. Horizontal gridlines ─────────────────────────────────
  ctx.save();
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;
  for (const t of ticks) {
    if (t.value === capacity) continue; // drawn separately as threshold
    const gy = Math.round(t.y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(viewportWidth, gy);
    ctx.stroke();
  }
  ctx.restore();

  // ── 2. Threshold (capacity) line ────────────────────────────
  if (capacity > 0) {
    const ty = Math.round(valueToY(capacity)) + 0.5;
    ctx.save();
    ctx.strokeStyle = HIST_COLOR_OVER;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, ty);
    ctx.lineTo(viewportWidth, ty);
    ctx.stroke();
    ctx.restore();
  }

  // ── 3. Split-stack bars (world-coordinate translate) ────────
  ctx.save();
  ctx.translate(-scrollLeft, 0);

  const barPad = Math.max(1, Math.round(pixelsPerDay * 0.1));
  const barWidth = pixelsPerDay - barPad;
  const visibleStart = Math.max(0, Math.floor(scrollLeft / pixelsPerDay) - 1);
  const visibleEnd = Math.ceil((scrollLeft + viewportWidth) / pixelsPerDay) + 1;

  for (let day = visibleStart; day <= visibleEnd; day++) {
    const units = histogram[day] || 0;
    if (units === 0) continue;

    const x = day * pixelsPerDay + barPad / 2;

    if (units <= capacity || capacity <= 0) {
      // Single blue segment
      const barH = height - valueToY(units);
      ctx.fillStyle = HIST_COLOR_NORMAL;
      ctx.fillRect(x, height - barH, barWidth, barH);
    } else {
      // Bottom blue segment: 0 → capacity
      const blueH = height - valueToY(capacity);
      ctx.fillStyle = HIST_COLOR_NORMAL;
      ctx.fillRect(x, height - blueH, barWidth, blueH);

      // Top red segment: capacity → total
      const totalH = height - valueToY(units);
      const redH = totalH - blueH;
      ctx.fillStyle = HIST_COLOR_OVER;
      ctx.fillRect(x, height - totalH, barWidth, redH);
    }
  }

  ctx.restore();
}
