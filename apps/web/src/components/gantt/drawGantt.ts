import type { BaselineMap, Dependency, ScheduleResultMap, VisibleRow } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import type { Selection } from "../../App";
import type { VirtualWindow } from "../../hooks/useVirtualWindow";
import { canonicalScrollTop } from "../../hooks/useVirtualWindow";
import { projectDateShort } from "../../utils/dateProjection";
import { drawDependencies } from "./drawDependencies";
import {
    COLORS,
    GANTT_VISUAL,
    getDensityConstants,
} from "./ganttConstants";
import { computeTaskGeometry } from "./ganttGeometry";
import { LINK_NODE_RADIUS } from "./hitTest";
import type { LinkDragState } from "./linkDrag";
import type { TimescaleModel } from "./timescaleModel";
import type { Viewport } from "./viewportTypes";

function gridlineStyle(level: NonNullable<TimescaleModel["gridLines"][number]["level"]>): { color: string; width: number } {
  switch (level) {
    case "year":
      return { color: "rgba(0, 0, 0, 0.28)", width: 1.25 };
    case "quarter":
      return { color: "rgba(0, 0, 0, 0.20)", width: 1 };
    case "month":
      return { color: "rgba(0, 0, 0, 0.12)", width: 1 };
    case "week":
      return { color: "rgba(0, 0, 0, 0.09)", width: 1 };
    case "day":
    default:
      return { color: "rgba(0, 0, 0, 0.06)", width: 1 };
  }
}

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
  tasks: VisibleRow[],
  scheduleResults: ScheduleResultMap,
  dependencies: Dependency[],
  viewport: Viewport,
  timescaleModel: TimescaleModel,
  durationOverrides?: DurationOverrides,
  positionOverrides?: PositionOverrides,
  linkDrag?: LinkDragState,
  projectStartDate?: string,
  selection?: Selection,
  nonWorkingDays?: ReadonlySet<number>,
  baselines?: BaselineMap,
  showDependencies = true,
  sharedVirtualWindow?: VirtualWindow,
): void {
  const { scrollLeft, scrollTop, viewportWidth, viewportHeight } = viewport;
  const { rowHeight: ROW_HEIGHT, barHeight: BAR_HEIGHT, barVerticalPadding: BAR_VERTICAL_PADDING } = getDensityConstants();

  // Clear canvas (viewport-sized)
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, viewportWidth, viewportHeight);

  if (!sharedVirtualWindow) {
    // Caller MUST provide the shared virtual window from App.
    // This guard keeps the parameter optional for test compatibility.
    console.error('[drawGantt] sharedVirtualWindow not provided — skipping frame');
    return;
  }
  const { startIndex, endIndex: rawEndIndex } = sharedVirtualWindow;
  // Clamp endIndex to the task array bounds to prevent undefined access
  // when virtualWindow is computed before tasks array updates propagate.
  const endIndex = Math.min(rawEndIndex, tasks.length - 1);

  if (endIndex < startIndex) return;

  // Full geometry map — needed for dependency endpoint lookup
  const geometryMap = computeTaskGeometry(tasks, scheduleResults, timescaleModel);

  // Visible vertical range in world pixels (for dependency clipping)
  const visibleTop = scrollTop;
  const visibleBottom = scrollTop + viewportHeight;

  // ── DEBUG: gantt frame invariant assert ──
  const cst = canonicalScrollTop(scrollTop);
  if (sharedVirtualWindow.startIndex !== Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3)) {
    console.warn('[GANTT INVARIANT] startIndex mismatch!', {
      received: sharedVirtualWindow.startIndex,
      expectedFromST: Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3),
      scrollTop,
    });
  }
  console.log('[GANTT FRAME]', {
    scrollTop,
    canonicalScrollTop: cst,
    startIndex,
    endIndex,
    rowHeight: ROW_HEIGHT,
  });

  // Translate to world coordinates (floor to prevent sub-pixel blur and match table positioning)
  ctx.save();
  ctx.translate(-scrollLeft, -cst);

  // ── Layer 1: Row background banding ──────────────────────────────────
  const WBS_BG = ["#E5E9F0", "#F4F5F7", "#FAFBFC", "#FFFFFF", "#FFFFFF"];
  for (let i = startIndex; i <= endIndex; i++) {
    const depth = tasks[i]?.depth ?? 0;
    const bg = WBS_BG[Math.min(depth, WBS_BG.length - 1)];
    if (bg !== COLORS.background) {
      ctx.fillStyle = bg;
      ctx.fillRect(scrollLeft, i * ROW_HEIGHT, viewportWidth, ROW_HEIGHT);
    }
  }

  // ── Layer 2: Non-working day shading ─────────────────────────────────
  if (timescaleModel.profile.showNonWorkingDayShading && nonWorkingDays && nonWorkingDays.size > 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    for (let day = timescaleModel.visibleStartDay; day <= timescaleModel.visibleEndDay; day++) {
      if (nonWorkingDays.has(day)) {
        ctx.fillRect(timescaleModel.dateToX(day), scrollTop, timescaleModel.spanWidth(day, day + 1), viewportHeight);
      }
    }
  }

  // ── Layer 3: Grid lines ──────────────────────────────────────────────
  const levelOrder: Array<NonNullable<TimescaleModel["gridLines"][number]["level"]>> = ["day", "week", "month", "quarter", "year"];
  for (const level of levelOrder) {
    const lines = timescaleModel.gridLines.filter((line) => line.level === level);
    if (lines.length === 0) continue;

    const style = gridlineStyle(level);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    for (const line of lines) {
      const gx = Math.round(line.x) + 0.5;
      ctx.moveTo(gx, scrollTop);
      ctx.lineTo(gx, scrollTop + viewportHeight);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = startIndex; i <= endIndex + 1; i++) {
    const y = i * ROW_HEIGHT + 0.5;
    ctx.moveTo(scrollLeft, y);
    ctx.lineTo(scrollLeft + viewportWidth, y);
  }
  ctx.stroke();

  // ── Layer 4: Baselines (behind live bars) ────────────────────────────
  for (let i = startIndex; i <= endIndex; i++) {
    const task = tasks[i];
    const schedule = scheduleResults[task.id];
    if (!schedule) continue;
    const baseline = baselines?.[task.id];
    if (!baseline) continue;

    const isMilestone = !task.isSummary && task.durationWorkMinutes === 0;
    if (isMilestone) {
      // Baseline milestone: small outlined diamond
      const bx = timescaleModel.dateToX(baseline.startMinutes);
      const by = i * ROW_HEIGHT + ROW_HEIGHT / 2 + GANTT_VISUAL.BASELINE_OFFSET_Y + GANTT_VISUAL.MILESTONE_SIZE / 2;
      const s = GANTT_VISUAL.MILESTONE_SIZE * 0.55;
      ctx.beginPath();
      ctx.moveTo(bx, by - s);
      ctx.lineTo(bx + s, by);
      ctx.lineTo(bx, by + s);
      ctx.lineTo(bx - s, by);
      ctx.closePath();
      ctx.fillStyle = GANTT_VISUAL.BASELINE_FILL;
      ctx.fill();
    } else {
      const baselineX = timescaleModel.dateToX(baseline.startMinutes);
      const baselineWidth = timescaleModel.spanWidth(baseline.startMinutes, baseline.finishMinutes);
      const baselineY = i * ROW_HEIGHT + BAR_VERTICAL_PADDING + BAR_HEIGHT + GANTT_VISUAL.BASELINE_OFFSET_Y;
      ctx.fillStyle = GANTT_VISUAL.BASELINE_FILL;
      if (baselineWidth > 0) {
        ctx.beginPath();
        ctx.roundRect(baselineX, baselineY, baselineWidth, GANTT_VISUAL.BASELINE_BAR_HEIGHT, 2);
        ctx.fill();
      }
    }
  }

  // ── Layer 5: Standard bars / milestones / summary brackets ───────────
  for (let i = startIndex; i <= endIndex; i++) {
    const task = tasks[i];
    const schedule = scheduleResults[task.id];
    if (!schedule) continue;
    const isCritical = !!schedule.isCritical;

    // ── Summary bracket ──
    if (task.isSummary) {
      const earlyStart = schedule.earlyStartMinutes;
      const earlyFinish = schedule.earlyFinishMinutes;
      const x = timescaleModel.dateToX(earlyStart);
      const y = i * ROW_HEIGHT + BAR_VERTICAL_PADDING;
      const barWidth = timescaleModel.spanWidth(earlyStart, earlyFinish);
      const { SUMMARY_BAR_HEIGHT: bh, SUMMARY_TICK_HEIGHT: th, SUMMARY_TICK_WIDTH: tw } = GANTT_VISUAL;

      ctx.fillStyle = isCritical ? COLORS.critical : GANTT_VISUAL.SUMMARY_FILL;
      // Thin horizontal bar
      ctx.fillRect(x, y, barWidth, bh);
      // Left downward tick
      ctx.fillRect(x, y, tw, th);
      // Right downward tick
      ctx.fillRect(x + barWidth - tw, y, tw, th);

      // Summary name above bracket (restrained — only if wide enough)
      if (barWidth > 30) {
        ctx.fillStyle = isCritical ? COLORS.critical : GANTT_VISUAL.SUMMARY_FILL;
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(task.name, x + 6, y - 2);
      }

      // Selected highlight
      if (selection?.type === "task" && selection.id === task.id) {
        ctx.strokeStyle = "#1565c0";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, barWidth + 2, th + 2);
      }
      continue;
    }

    // ── Milestone (zero-duration, non-summary) ──
    const isMilestone = task.durationWorkMinutes === 0;
    if (isMilestone) {
      const mx = timescaleModel.dateToX(schedule.earlyStartMinutes);
      const my = i * ROW_HEIGHT + ROW_HEIGHT / 2;
      const s = GANTT_VISUAL.MILESTONE_SIZE;

      ctx.beginPath();
      ctx.moveTo(mx, my - s);      // top
      ctx.lineTo(mx + s, my);      // right
      ctx.lineTo(mx, my + s);      // bottom
      ctx.lineTo(mx - s, my);      // left
      ctx.closePath();

      ctx.fillStyle = isCritical ? GANTT_VISUAL.MILESTONE_CRITICAL_FILL : GANTT_VISUAL.MILESTONE_FILL;
      ctx.fill();

      // Selected highlight for milestone
      if (selection?.type === "task" && selection.id === task.id) {
        ctx.strokeStyle = "#1565c0";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      continue;
    }

    // ── Standard task bar ──
    const duration = durationOverrides?.get(task.id) ?? (task.durationWorkMinutes / MINUTES_PER_DAY);
    const earlyStart = positionOverrides?.get(task.id) ?? schedule.earlyStartMinutes;
    const x = timescaleModel.dateToX(earlyStart);
    const y = i * ROW_HEIGHT + BAR_VERTICAL_PADDING;
    const barWidth = (durationOverrides?.has(task.id) || positionOverrides?.has(task.id))
      ? timescaleModel.spanWidth(0, duration)
      : timescaleModel.spanWidth(schedule.earlyStartMinutes, schedule.earlyFinishMinutes);

    ctx.fillStyle = isCritical ? GANTT_VISUAL.TASK_BAR_CRITICAL_FILL : GANTT_VISUAL.TASK_BAR_FILL;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, BAR_HEIGHT, GANTT_VISUAL.BAR_RADIUS);
    ctx.fill();

    // Bar text label — white, clipped to bar width, only if readable
    if (barWidth > 30) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, barWidth - 4, BAR_HEIGHT);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(task.name, x + 6, y + BAR_HEIGHT / 2);
      ctx.restore();
    }

    // Link-node circle at right-middle edge
    const nodeX = x + barWidth;
    const nodeY = y + BAR_HEIGHT / 2;
    ctx.beginPath();
    ctx.arc(nodeX, nodeY, LINK_NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#888888";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Selected task highlight
    if (selection?.type === "task" && selection.id === task.id) {
      ctx.strokeStyle = "#1565c0";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(x - 1, y - 1, barWidth + 2, BAR_HEIGHT + 2, GANTT_VISUAL.BAR_RADIUS + 1);
      ctx.stroke();
    }
  }

  // ── Layer 6: Dependency lines (above bars) ───────────────────────────
  if (showDependencies) {
    drawDependencies(ctx, dependencies, geometryMap, visibleTop, visibleBottom, scheduleResults);
  }

  // Highlight selected dependency line
  if (showDependencies && selection?.type === "dependency") {
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

  // ── Layer 7: Interactions / drag visuals / tooltips ──────────────────
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
      const finishDay = schedule.earlyStartMinutes + previewDuration;
      const label = projectDateShort(projectStartDate, finishDay);
      const tipX = timescaleModel.dateToX(schedule.earlyStartMinutes) + timescaleModel.spanWidth(0, previewDuration);
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
      const tipX = timescaleModel.dateToX(previewStart);
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
