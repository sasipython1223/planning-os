import type { BaselineMap, Dependency, ScheduleResultMap, Task } from "protocol";
import type { Selection } from "../../App";
import { computeVirtualWindow } from "../../hooks/useVirtualWindow";
import { projectDateShort } from "../../utils/dateProjection";
import { drawDependencies } from "./drawDependencies";
import {
    BAR_HEIGHT,
    BAR_VERTICAL_PADDING,
    COLORS,
    DAY_WIDTH,
    ROW_HEIGHT,
} from "./ganttConstants";
import { computeTaskGeometry } from "./ganttGeometry";
import { LINK_NODE_RADIUS } from "./hitTest";
import type { LinkDragState } from "./linkDrag";
import type { Viewport } from "./viewportTypes";

/**
 * Optional per-task duration overrides for drag previews.
 * Key = taskId, value = preview duration in days.
 */
export type DurationOverrides = ReadonlyMap<string, number>;

/**
 * Optional per-task earlyStart override for move previews.
 * Key = taskId, value = preview earlyStart in days.
 */
export type PositionOverrides = ReadonlyMap<string, number>;

/**
 * Draws Gantt bars and dependencies on a viewport-sized canvas.
 * Only processes visible rows + overscan for bars and grid lines.
 * Dependencies are clipped by vertical intersection with the viewport.
 * Pure function - takes data in, renders to canvas.
 *
 * @param durationOverrides - optional preview durations (drag preview)
 * @param positionOverrides - optional preview earlyStart (move preview)
 * @param linkDrag - optional active link-drag state for preview rendering
 * @param projectStartDate - ISO date string for date tooltip during resize
 * @param selection - optional current selection for highlight rendering
 */
export function drawGantt(
  ctx: CanvasRenderingContext2D,
  tasks: Task[],
  scheduleResults: ScheduleResultMap,
  dependencies: Dependency[],
  viewport: Viewport,
  durationOverrides?: DurationOverrides,
  positionOverrides?: PositionOverrides,
  linkDrag?: LinkDragState,
  projectStartDate?: string,
  selection?: Selection,
  nonWorkingDays?: ReadonlySet<number>,
  baselines?: BaselineMap,
): void {
  const { scrollLeft, scrollTop, viewportWidth, viewportHeight } = viewport;

  // Clear canvas (viewport-sized)
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, viewportWidth, viewportHeight);

  // Visible row window (same math as TaskTable virtualization)
  const { startIndex, endIndex } = computeVirtualWindow(
    tasks.length,
    ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  );

  if (endIndex < startIndex) return;

  // Full geometry map — needed for dependency endpoint lookup
  const geometryMap = computeTaskGeometry(tasks, scheduleResults);

  // Visible vertical range in world pixels (for dependency clipping)
  const visibleTop = scrollTop;
  const visibleBottom = scrollTop + viewportHeight;

  // Translate to world coordinates (floor to prevent sub-pixel blur)
  ctx.save();
  ctx.translate(-scrollLeft, -Math.floor(scrollTop));

  // Shade non-working day columns (behind grid and bars)
  if (nonWorkingDays && nonWorkingDays.size > 0) {
    const firstDay = Math.max(0, Math.floor(scrollLeft / DAY_WIDTH) - 1);
    const lastDay = Math.ceil((scrollLeft + viewportWidth) / DAY_WIDTH) + 1;
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    for (let day = firstDay; day <= lastDay; day++) {
      if (nonWorkingDays.has(day)) {
        ctx.fillRect(day * DAY_WIDTH, scrollTop, DAY_WIDTH, viewportHeight);
      }
    }
  }

  // Draw grid lines — only for visible rows
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = startIndex; i <= endIndex + 1; i++) {
    const y = i * ROW_HEIGHT + 0.5;
    ctx.moveTo(scrollLeft, y);
    ctx.lineTo(scrollLeft + viewportWidth, y);
  }
  ctx.stroke();

  // Draw dependency lines (behind bars) — clipped by vertical intersection
  drawDependencies(ctx, dependencies, geometryMap, visibleTop, visibleBottom, scheduleResults);

  // Highlight selected dependency line
  if (selection?.type === "dependency") {
    const selDep = dependencies.find(d => d.id === selection.id);
    if (selDep) {
      const predGeom = geometryMap.get(selDep.predId);
      const succGeom = geometryMap.get(selDep.succId);
      if (predGeom && succGeom) {
        const isSS = selDep.type === "SS";
        const isFS = selDep.type === "FS" || !selDep.type;
        const x1 = (isSS || selDep.type === "SF") ? predGeom.leftEdge : predGeom.rightEdge;
        const x2 = (isFS || isSS) ? succGeom.leftEdge : succGeom.rightEdge;
        const y1 = predGeom.centerY;
        const y2 = succGeom.centerY;
        ctx.strokeStyle = "#1565c0";
        ctx.lineWidth = 3;
        const OUTWARD_PAD = 12;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (selDep.type === "SS") {
          const outX = Math.min(x1, x2) - OUTWARD_PAD;
          ctx.lineTo(outX, y1);
          ctx.lineTo(outX, y2);
          ctx.lineTo(x2, y2);
        } else if (selDep.type === "FF") {
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
      }
    }
  }

  // Draw bars — only for visible rows
  for (let i = startIndex; i <= endIndex; i++) {
    const task = tasks[i];
    const schedule = scheduleResults[task.id];
    if (!schedule) continue;

    // Draw baseline bar (behind live bar)
    const baseline = baselines?.[task.id];
    if (baseline) {
      const baselineX = baseline.start * DAY_WIDTH;
      const baselineWidth = (baseline.finish - baseline.start) * DAY_WIDTH;
      const baselineY = i * ROW_HEIGHT + BAR_VERTICAL_PADDING + BAR_HEIGHT + 2;
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(baselineX, baselineY, baselineWidth, 6);
    }

    if (task.isSummary) {
      // Summary bracket: thin bar with downward ticks at edges
      const earlyStart = schedule.earlyStart;
      const earlyFinish = schedule.earlyFinish;
      const x = earlyStart * DAY_WIDTH;
      const y = i * ROW_HEIGHT + BAR_VERTICAL_PADDING;
      const barWidth = (earlyFinish - earlyStart) * DAY_WIDTH;
      const bracketHeight = 6;
      const tickHeight = 8;

      ctx.fillStyle = schedule.isCritical ? COLORS.critical : "#333333";
      // Thin bar
      ctx.fillRect(x, y, barWidth, bracketHeight);
      // Left tick
      ctx.fillRect(x, y, 3, tickHeight);
      // Right tick
      ctx.fillRect(x + barWidth - 3, y, 3, tickHeight);

      // Summary task name
      ctx.fillStyle = schedule.isCritical ? COLORS.critical : "#333333";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      if (barWidth > 20) {
        ctx.fillText(task.name, x + 6, y - 2);
      }

      // Highlight selected summary
      if (selection?.type === "task" && selection.id === task.id) {
        ctx.strokeStyle = "#1565c0";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, barWidth + 2, tickHeight + 2);
      }
      continue;
    }

    const duration = durationOverrides?.get(task.id) ?? task.duration;
    const earlyStart = positionOverrides?.get(task.id) ?? schedule.earlyStart;
    const x = earlyStart * DAY_WIDTH;
    const y = i * ROW_HEIGHT + BAR_VERTICAL_PADDING;
    // Use overridden duration for drag preview, otherwise elapsed span for calendar-aware width
    const barWidth = (durationOverrides?.has(task.id) || positionOverrides?.has(task.id))
      ? duration * DAY_WIDTH
      : (schedule.earlyFinish - schedule.earlyStart) * DAY_WIDTH;

    ctx.fillStyle = schedule.isCritical ? COLORS.critical : COLORS.nonCritical;
    ctx.fillRect(x, y, barWidth, BAR_HEIGHT);

    // Draw task name on bar
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    if (barWidth > 20) {
      ctx.fillText(task.name, x + 4, y + BAR_HEIGHT / 2);
    }

    // Link-node circle at right-middle edge of bar
    const nodeX = x + barWidth;
    const nodeY = y + BAR_HEIGHT / 2;
    ctx.beginPath();
    ctx.arc(nodeX, nodeY, LINK_NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#888888";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Highlight selected task bar
    if (selection?.type === "task" && selection.id === task.id) {
      ctx.strokeStyle = "#1565c0";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x - 1, y - 1, barWidth + 2, BAR_HEIGHT + 2);
    }
  }

  // Link-drag preview: highlight target bar + dashed line
  if (linkDrag?.active) {
    // Highlight target bar
    if (linkDrag.targetTaskId) {
      const targetGeom = geometryMap.get(linkDrag.targetTaskId);
      if (targetGeom) {
        ctx.strokeStyle = "#4caf50";
        ctx.lineWidth = 2;
        ctx.strokeRect(targetGeom.x - 1, targetGeom.y - 1, targetGeom.width + 2, targetGeom.height + 2);
      }
    }

    // Dashed line from source to cursor
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(linkDrag.sourceX, linkDrag.sourceY);
    ctx.lineTo(linkDrag.currentWorldX, linkDrag.currentWorldY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Resize date tooltip: show projected finish date above the bar being resized
  if (durationOverrides && projectStartDate) {
    for (const [taskId, previewDuration] of durationOverrides) {
      const schedule = scheduleResults[taskId];
      if (!schedule) continue;
      const finishDay = schedule.earlyStart + previewDuration;
      const label = projectDateShort(projectStartDate, finishDay);
      const tipX = schedule.earlyStart * DAY_WIDTH + previewDuration * DAY_WIDTH;
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex < 0) continue;
      const tipY = taskIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING - 4;

      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const tw = ctx.measureText(label).width;
      const pad = 4;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.roundRect(tipX - tw / 2 - pad, tipY - 16, tw + pad * 2, 16, 3);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, tipX, tipY - 2);
    }
  }

  // Move date tooltip: show projected start date above the bar being moved
  if (positionOverrides && projectStartDate) {
    for (const [taskId, previewStart] of positionOverrides) {
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex < 0) continue;
      const label = projectDateShort(projectStartDate, previewStart);
      const tipX = previewStart * DAY_WIDTH;
      const tipY = taskIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING - 4;

      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const tw = ctx.measureText(label).width;
      const pad = 4;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.roundRect(tipX - tw / 2 - pad, tipY - 16, tw + pad * 2, 16, 3);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, tipX, tipY - 2);
    }
  }

  ctx.restore();
}
