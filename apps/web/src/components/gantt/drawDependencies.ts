import type { Dependency, ScheduleResultMap } from "protocol";
import { COLORS } from "./ganttConstants";
import type { TaskGeometry } from "./ganttGeometry";

/**
 * Draws a simple arrowhead at the end of a line.
 * Pure helper function.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: "left" | "right"
): void {
  const arrowSize = 6;
  const dx = direction === "right" ? -arrowSize : arrowSize;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y - arrowSize / 2);
  ctx.lineTo(x + dx, y + arrowSize / 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws dependency lines on the canvas.
 * Uses simple 3-segment orthogonal routing for FS dependencies.
 * Skips lines whose entire vertical span is outside [visibleTop, visibleBottom].
 * Pure function - takes data in, renders to canvas.
 */
export function drawDependencies(
  ctx: CanvasRenderingContext2D,
  dependencies: Dependency[],
  geometryMap: Map<string, TaskGeometry>,
  visibleTop: number,
  visibleBottom: number,
  scheduleResults?: ScheduleResultMap,
): void {
  ctx.lineWidth = 2;

  dependencies.forEach((dep) => {
    // Only render FS dependencies (finish-to-start)
    if (dep.type !== "FS") return;

    const predGeom = geometryMap.get(dep.predId);
    const succGeom = geometryMap.get(dep.succId);

    // Skip if either task is not scheduled/rendered
    if (!predGeom || !succGeom) return;

    // Vertical intersection clip — skip only if the line is fully outside
    const minY = Math.min(predGeom.centerY, succGeom.centerY);
    const maxY = Math.max(predGeom.centerY, succGeom.centerY);
    if (maxY < visibleTop || minY > visibleBottom) return;

    // Start point: right edge of predecessor, vertically centered
    const x1 = predGeom.rightEdge;
    const y1 = predGeom.centerY;

    // End point: left edge of successor, vertically centered
    const x2 = succGeom.leftEdge;
    const y2 = succGeom.centerY;

    // Horizontal offset for the middle segment
    const midX = (x1 + x2) / 2;

    // Color critical dependency lines (both endpoints critical) in critical color
    const isCritLine = scheduleResults
      ? scheduleResults[dep.predId]?.isCritical && scheduleResults[dep.succId]?.isCritical
      : false;
    const lineColor = isCritLine ? COLORS.critical : COLORS.dependency;
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;

    // Draw 3-segment orthogonal line: horizontal → vertical → horizontal
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX, y1); // Horizontal from predecessor
    ctx.lineTo(midX, y2); // Vertical connector
    ctx.lineTo(x2, y2);   // Horizontal to successor
    ctx.stroke();

    // Draw arrowhead at successor
    drawArrowhead(ctx, x2, y2, "left");
  });
}
