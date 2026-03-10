import type { Dependency, DependencyType, ScheduleResultMap } from "protocol";
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
 * Returns [sourceX, targetX, arrowDirection] based on dependency type.
 * Anchor rules:
 *   FS: right → left
 *   SS: left  → left
 *   FF: right → right
 *   SF: left  → right
 */
function getAnchors(
  depType: DependencyType,
  predGeom: TaskGeometry,
  succGeom: TaskGeometry,
): { x1: number; x2: number; arrowDir: "left" | "right" } {
  switch (depType) {
    case "SS":
      return { x1: predGeom.leftEdge, x2: succGeom.leftEdge, arrowDir: "right" };
    case "FF":
      return { x1: predGeom.rightEdge, x2: succGeom.rightEdge, arrowDir: "left" };
    case "SF":
      return { x1: predGeom.leftEdge, x2: succGeom.rightEdge, arrowDir: "left" };
    case "FS":
    default:
      return { x1: predGeom.rightEdge, x2: succGeom.leftEdge, arrowDir: "right" };
  }
}

/**
 * Draws dependency lines on the canvas.
 * Uses simple 3-segment orthogonal routing.
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
    const predGeom = geometryMap.get(dep.predId);
    const succGeom = geometryMap.get(dep.succId);

    if (!predGeom || !succGeom) return;

    const minY = Math.min(predGeom.centerY, succGeom.centerY);
    const maxY = Math.max(predGeom.centerY, succGeom.centerY);
    if (maxY < visibleTop || minY > visibleBottom) return;

    const { x1, x2, arrowDir } = getAnchors(dep.type, predGeom, succGeom);
    const y1 = predGeom.centerY;
    const y2 = succGeom.centerY;

    const isCritLine = scheduleResults
      ? scheduleResults[dep.predId]?.isCritical && scheduleResults[dep.succId]?.isCritical
      : false;
    const lineColor = isCritLine ? COLORS.critical : COLORS.dependency;
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;

    const OUTWARD_PAD = 12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (dep.type === "SS") {
      const outX = Math.min(x1, x2) - OUTWARD_PAD;
      ctx.lineTo(outX, y1);
      ctx.lineTo(outX, y2);
      ctx.lineTo(x2, y2);
    } else if (dep.type === "FF") {
      const outX = Math.max(x1, x2) + OUTWARD_PAD;
      ctx.lineTo(outX, y1);
      ctx.lineTo(outX, y2);
      ctx.lineTo(x2, y2);
    } else {
      const midX = (x1 + x2) / 2;
      ctx.lineTo(midX, y1);
      ctx.lineTo(midX, y2);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    drawArrowhead(ctx, x2, y2, arrowDir === "right" ? "right" : "left");
  });
}
