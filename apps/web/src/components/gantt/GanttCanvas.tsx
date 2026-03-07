import type { Dependency, ScheduleResultMap, Task } from "protocol";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { DurationOverrides } from "./drawGantt";
import type { PositionOverrides } from "./drawGantt";
import { drawGantt } from "./drawGantt";
import { emptyDrag, previewDuration, previewEarlyStart } from "./dragPreview";
import type { DragState } from "./dragPreview";
import { cursorForZone, hitTestBar, hitTestDependency } from "./hitTest";
import { BAR_HEIGHT, BAR_VERTICAL_PADDING, DAY_WIDTH, ROW_HEIGHT } from "./ganttConstants";
import { computeTaskGeometry } from "./ganttGeometry";
import { emptyLinkDrag } from "./linkDrag";
import type { LinkDragState } from "./linkDrag";
import { emptyPan } from "./panDrag";
import type { Viewport } from "./viewportTypes";
import type { Selection } from "../../App";

interface GanttCanvasProps {
  tasks: Task[];
  scheduleResults: ScheduleResultMap;
  dependencies: Dependency[];
  viewport: Viewport;
  onUpdateDuration: (taskId: string, newDuration: number) => void;
  onUpdateTask: (taskId: string, updates: { minEarlyStart?: number }) => void;
  onAddDependency: (predId: string, succId: string) => void;
  hScrollRef: RefObject<HTMLDivElement | null>;
  vScrollRef: RefObject<HTMLDivElement | null>;
  projectStartDate: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
}

/**
 * Viewport-sized canvas for Gantt bars and dependency lines.
 * Uses rAF to coalesce redraws triggered by scroll or data changes.
 * Handles hit detection + right-resize drag preview (no React state churn).
 */
export function GanttCanvas({
  tasks,
  scheduleResults,
  dependencies,
  viewport,
  onUpdateDuration,
  onUpdateTask,
  onAddDependency,
  hScrollRef,
  vScrollRef,
  projectStartDate,
  selection,
  onSelect,
}: GanttCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<DragState>(emptyDrag());
  const linkDragRef = useRef<LinkDragState>(emptyLinkDrag());
  const panRef = useRef(emptyPan());
  const mouseDownWorldRef = useRef<{ x: number; y: number } | null>(null);

  // --- imperative redraw helper (shared by effect + drag handlers) ---
  const redraw = useCallback(
    (overrides?: DurationOverrides, posOverrides?: PositionOverrides) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { viewportWidth, viewportHeight } = viewport;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = viewportWidth * dpr;
      canvas.height = viewportHeight * dpr;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const activeLinkDrag = linkDragRef.current.active ? linkDragRef.current : undefined;
      drawGantt(ctx, tasks, scheduleResults, dependencies, viewport, overrides, posOverrides, activeLinkDrag, projectStartDate, selection);
    },
    [tasks, scheduleResults, dependencies, viewport, projectStartDate],
  );

  // Normal data-driven redraw
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => redraw());
    return () => cancelAnimationFrame(rafRef.current);
  }, [redraw]);

  // --- coordinate helpers ---
  const toWorld = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        worldX: e.clientX - rect.left + viewport.scrollLeft,
        worldY: e.clientY - rect.top + viewport.scrollTop,
      };
    },
    [viewport.scrollLeft, viewport.scrollTop],
  );

  // --- build overrides map from active drag ---
  const buildOverrides = useCallback((): DurationOverrides | undefined => {
    const d = dragRef.current;
    if (!d.active || d.mode !== "right-resize") return undefined;
    return new Map([[d.taskId, previewDuration(d)]]);
  }, []);

  const buildPositionOverrides = useCallback((): PositionOverrides | undefined => {
    const d = dragRef.current;
    if (!d.active || d.mode !== "move") return undefined;
    return new Map([[d.taskId, previewEarlyStart(d)]]);
  }, []);

  // --- mouse handlers ---

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { worldX, worldY } = toWorld(e);
      mouseDownWorldRef.current = { x: worldX, y: worldY };
      const hit = hitTestBar(worldX, worldY, tasks, scheduleResults);

      if (hit.zone === "link-node" && hit.taskId) {
        const task = tasks[hit.rowIndex];
        const schedule = scheduleResults[task.id];
        if (!schedule) return;
        const barRight = schedule.earlyStart * DAY_WIDTH + task.duration * DAY_WIDTH;
        const barCenterY = hit.rowIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING + BAR_HEIGHT / 2;
        linkDragRef.current = {
          active: true,
          sourceTaskId: hit.taskId,
          sourceX: barRight,
          sourceY: barCenterY,
          currentWorldX: worldX,
          currentWorldY: worldY,
          targetTaskId: null,
        };
        return;
      }

      if (hit.zone === "right-resize" && hit.taskId) {
        const task = tasks[hit.rowIndex];
        if (!task) return;

        dragRef.current = {
          active: true,
          taskId: hit.taskId,
          mode: "right-resize",
          initialWorldX: worldX,
          currentWorldX: worldX,
          initialDuration: task.duration,
          initialEarlyStart: 0,
        };
        return;
      }

      if (hit.zone === "bar" && hit.taskId) {
        const task = tasks[hit.rowIndex];
        const schedule = scheduleResults[task.id];
        if (!task || !schedule) return;

        dragRef.current = {
          active: true,
          taskId: hit.taskId,
          mode: "move",
          initialWorldX: worldX,
          currentWorldX: worldX,
          initialDuration: task.duration,
          initialEarlyStart: schedule.earlyStart,
        };
        return;
      }

      if (hit.zone === "background") {
        const hEl = hScrollRef.current;
        const vEl = vScrollRef.current;
        panRef.current = {
          active: true,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startScrollLeft: hEl?.scrollLeft ?? 0,
          startScrollTop: vEl?.scrollTop ?? 0,
        };
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = "grabbing";
      }
    },
    [toWorld, tasks, scheduleResults, hScrollRef, vScrollRef],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { worldX, worldY } = toWorld(e);

      // Link drag takes priority
      const linkDrag = linkDragRef.current;
      if (linkDrag.active) {
        linkDrag.currentWorldX = worldX;
        linkDrag.currentWorldY = worldY;

        // Target detection: reuse O(1) hit test
        const hit = hitTestBar(worldX, worldY, tasks, scheduleResults);
        linkDrag.targetTaskId =
          hit.taskId && hit.taskId !== linkDrag.sourceTaskId && hit.zone !== "background"
            ? hit.taskId
            : null;

        canvas.style.cursor = "crosshair";
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => redraw());
        return;
      }

      // Resize or move drag
      const drag = dragRef.current;
      if (drag.active) {
        drag.currentWorldX = worldX;
        canvas.style.cursor = drag.mode === "right-resize" ? "ew-resize" : "move";
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => redraw(buildOverrides(), buildPositionOverrides()));
        return;
      }

      // Pan drag — drive native scroll containers, no custom redraw needed
      const pan = panRef.current;
      if (pan.active) {
        const dx = e.clientX - pan.startClientX;
        const dy = e.clientY - pan.startClientY;
        const hEl = hScrollRef.current;
        const vEl = vScrollRef.current;
        if (hEl) hEl.scrollLeft = pan.startScrollLeft - dx;
        if (vEl) vEl.scrollTop = pan.startScrollTop - dy;
        canvas.style.cursor = "grabbing";
        return;
      }

      // Normal hover hit-test
      const hit = hitTestBar(worldX, worldY, tasks, scheduleResults);
      canvas.style.cursor = cursorForZone(hit.zone);
    },
    [toWorld, tasks, scheduleResults, redraw, buildOverrides, buildPositionOverrides, hScrollRef, vScrollRef],
  );

  const finishDrag = useCallback((e?: React.MouseEvent<HTMLCanvasElement>) => {
    // Finish pan — check if it was a stationary click (no actual movement)
    const pan = panRef.current;
    if (pan.active) {
      const wasDrag = e
        ? Math.abs(e.clientX - pan.startClientX) > 3 || Math.abs(e.clientY - pan.startClientY) > 3
        : true;
      panRef.current = emptyPan();
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "grab";

      // Stationary background click → select summary task or clear selection
      if (!wasDrag && e) {
        const { worldX, worldY } = toWorld(e);
        const hit = hitTestBar(worldX, worldY, tasks, scheduleResults);
        if (hit.taskId) {
          onSelect({ type: "task", id: hit.taskId });
        } else {
          onSelect(null);
        }
      }
      return;
    }

    // Finish link drag
    const linkDrag = linkDragRef.current;
    if (linkDrag.active) {
      const predId = linkDrag.sourceTaskId;
      const succId = linkDrag.targetTaskId;

      linkDragRef.current = emptyLinkDrag();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => redraw());

      if (succId) {
        onAddDependency(predId, succId);
      }
      return;
    }

    // Finish resize or move drag
    const drag = dragRef.current;
    if (drag.active) {
      const taskId = drag.taskId;

      if (drag.mode === "right-resize") {
        const newDuration = previewDuration(drag);
        const changed = newDuration !== drag.initialDuration;
        dragRef.current = emptyDrag();
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => redraw());
        if (changed) {
          onUpdateDuration(taskId, newDuration);
        }
      } else {
        // mode === "move"
        const newEarlyStart = previewEarlyStart(drag);
        const changed = newEarlyStart !== drag.initialEarlyStart;
        dragRef.current = emptyDrag();
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => redraw());
        if (changed) {
          onUpdateTask(taskId, { minEarlyStart: newEarlyStart });
        }
      }
      return;
    }

    // No drag was active → click-to-select
    const md = mouseDownWorldRef.current;
    if (!md || !e) return;
    const { worldX, worldY } = toWorld(e);

    // Check bar hit (includes summary tasks which return background with taskId)
    const hit = hitTestBar(worldX, worldY, tasks, scheduleResults);
    if (hit.taskId) {
      onSelect({ type: "task", id: hit.taskId });
      return;
    }

    // Check dependency hit
    const geometryMap = computeTaskGeometry(tasks, scheduleResults);
    const depId = hitTestDependency(worldX, worldY, dependencies, geometryMap);
    if (depId) {
      onSelect({ type: "dependency", id: depId });
      return;
    }

    // Background — clear
    onSelect(null);
  }, [redraw, onUpdateDuration, onUpdateTask, onAddDependency, onSelect, toWorld, tasks, scheduleResults, dependencies]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => finishDrag(e), [finishDrag]);
  const handleMouseLeave = useCallback(() => {
    mouseDownWorldRef.current = null;
    finishDrag();
  }, [finishDrag]);

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ display: "block" }}
    />
  );
}
