import type { BaselineMap, Dependency, ScheduleResultMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Selection } from "../../App";
import { useVirtualWindow } from "../../hooks/useVirtualWindow";
import { HEADER_METRICS } from "../../ui/config/themeConfig";
import { useDensityMetrics } from "../../ui/store/uiStore";
import type { TimelineGeometry } from "../../utils/timelineGeometry";
import { GanttCanvas } from "./GanttCanvas";
import { TimescaleCanvas } from "./TimescaleCanvas";
import { createTimescaleModel, type TimescaleProfileId } from "./timescaleModel";
import type { Viewport } from "./viewportTypes";

interface GanttPaneProps {
  tasks: VisibleRow[];
  scheduleResults: ScheduleResultMap;
  dependencies: Dependency[];
  scrollTop: number;
  viewportHeight: number;
  onUpdateDuration: (taskId: string, newDuration: number) => void;
  onUpdateTask: (taskId: string, updates: { minEarlyStartMinutes?: WorkMinutes }) => void;
  onAddDependency: (predId: string, succId: string) => void;
  vScrollRef: RefObject<HTMLDivElement | null>;
  timeline: TimelineGeometry;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  nonWorkingDays: ReadonlySet<number>;
  baselines: BaselineMap;
  timescaleProfileId: TimescaleProfileId;
  manualPixelsPerDayOverride: number | null;
  onManualPixelsPerDayOverrideChange: (value: number | null) => void;
  showDependencies: boolean;
  onScrollLeftChange?: (scrollLeft: number, paneWidth: number) => void;
  onHScrollMount?: (el: HTMLDivElement | null) => void;
  bodyRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Gantt pane with horizontal-only scrolling.
 * Vertical scrolling is owned by a shared scroll track in App.
 * Timescale is fixed at top and responds to scrollLeft only.
 */
export function GanttPane({
  tasks,
  scheduleResults,
  dependencies,
  scrollTop,
  viewportHeight,
  onUpdateDuration,
  onUpdateTask,
  onAddDependency,
  vScrollRef,
  timeline,
  selection,
  onSelect,
  nonWorkingDays,
  baselines,
  timescaleProfileId,
  manualPixelsPerDayOverride,
  onManualPixelsPerDayOverrideChange,
  showDependencies,
  onScrollLeftChange,
  onHScrollMount,
  bodyRef: externalBodyRef,
}: GanttPaneProps) {
  const MIN_MANUAL_PIXELS_PER_DAY = 0.25;
  const MAX_MANUAL_PIXELS_PER_DAY = 48;
  const { rowHeight } = useDensityMetrics();
  const hScrollRef = useRef<HTMLDivElement>(null);
  const dragDensityRef = useRef<{ startClientX: number; startPixelsPerDay: number } | null>(null);
  const pendingAnchorDayRef = useRef<number | null>(null);

  // Merge internal hScrollRef with external bodyRef so App can imperatively set scrollTop
  const mergedBodyRef = useCallback((el: HTMLDivElement | null) => {
    (hScrollRef as MutableRefObject<HTMLDivElement | null>).current = el;
    if (externalBodyRef) {
      (externalBodyRef as MutableRefObject<HTMLDivElement | null>).current = el;
    }
  }, [externalBodyRef]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);
  const virtualWindow = useVirtualWindow(tasks.length, rowHeight, scrollTop, viewportHeight);

  // Timeline geometry — single owner is App via computeTimelineGeometry
  const { maxDay, totalTimelineWidth, pixelsPerDay, projectStartDate } = timeline;

  // Handle horizontal scroll
  const handleScroll = useCallback(() => {
    const el = hScrollRef.current;
    if (!el) return;
    const sl = el.scrollLeft;
    setScrollLeft(sl);
    onScrollLeftChange?.(sl, paneWidth);
  }, [onScrollLeftChange, paneWidth]);

  // Measure pane width
  useEffect(() => {
    const el = hScrollRef.current;
    if (!el) return;

    onHScrollMount?.(el);

    const measure = () => {
      const w = el.clientWidth;
      console.log("[GanttPane] paneWidth =", w);
      setPaneWidth(w);
      onScrollLeftChange?.(scrollLeft, w);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const viewport: Viewport = {
    scrollTop,
    scrollLeft,
    viewportWidth: paneWidth,
    viewportHeight,
  };

  const timescaleModel = useMemo(
    () => createTimescaleModel({
      projectStartDate,
      maxDay,
      scrollLeft,
      viewportWidth: paneWidth,
      totalTimelineWidth,
      pixelsPerDay,
      manualPixelsPerDayOverride,
      profileId: timescaleProfileId,
    }),
    [projectStartDate, maxDay, scrollLeft, paneWidth, totalTimelineWidth, pixelsPerDay, manualPixelsPerDayOverride, timescaleProfileId],
  );

  useEffect(() => {
    if (pendingAnchorDayRef.current === null) return;
    const hEl = hScrollRef.current;
    if (!hEl || paneWidth <= 0) return;

    const anchorDay = pendingAnchorDayRef.current;
    const targetScrollLeft = Math.max(
      0,
      Math.min(
        timescaleModel.totalWidth - paneWidth,
        timescaleModel.dateToX(anchorDay) - paneWidth / 2,
      ),
    );

    hEl.scrollLeft = targetScrollLeft;
    setScrollLeft(targetScrollLeft);
    onScrollLeftChange?.(targetScrollLeft, paneWidth);
    pendingAnchorDayRef.current = null;
  }, [timescaleModel, paneWidth, onScrollLeftChange]);

  const handleTimescaleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || paneWidth <= 0) return;

    const startingPixelsPerDay = timescaleModel.unitWidth;
    dragDensityRef.current = {
      startClientX: e.clientX,
      startPixelsPerDay: startingPixelsPerDay,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      const drag = dragDensityRef.current;
      if (!drag) return;

      const deltaX = moveEvent.clientX - drag.startClientX;
      const nextPixelsPerDay = Number((drag.startPixelsPerDay + deltaX / 12).toFixed(2));
      const next = Math.max(
        MIN_MANUAL_PIXELS_PER_DAY,
        Math.min(MAX_MANUAL_PIXELS_PER_DAY, nextPixelsPerDay),
      );

      if (next === timescaleModel.unitWidth) return;
      pendingAnchorDayRef.current = timescaleModel.xToDay(scrollLeft + paneWidth / 2);
      onManualPixelsPerDayOverrideChange(next);
    };

    const onMouseUp = () => {
      dragDensityRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [paneWidth, timescaleModel, scrollLeft, onManualPixelsPerDayOverrideChange]);

  return (
    <div className="planner-gantt-pane" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Fixed timescale header */}
      <div
        className="gantt-header planner-gantt-header"
        onMouseDown={handleTimescaleMouseDown}
        style={{
          flexShrink: 0,
          height: HEADER_METRICS.totalHeight,
          borderBottom: "1px solid var(--border-default, #ccc)",
          boxSizing: "border-box",
          cursor: "ew-resize",
        }}
      >
        <TimescaleCanvas model={timescaleModel} nonWorkingDays={nonWorkingDays} />
      </div>

      {/* Horizontal-only scroll container */}
      <div
        ref={mergedBodyRef}
        className="gantt-body planner-gantt-body"
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          position: "relative",
          minHeight: 0,
        }}
      >
        {/* Horizontal phantom for scrollbar sizing */}
        <div
          style={{
            width: timescaleModel.totalWidth,
            height: 1,
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
        />

        {/* Viewport-sized canvas pinned to scroll position */}
        <div
          style={{
            position: "sticky",
            left: 0,
            width: paneWidth || "100%",
            height: viewportHeight || "100%",
            overflow: "hidden",
          }}
        >
          <GanttCanvas
            tasks={tasks}
            scheduleResults={scheduleResults}
            dependencies={dependencies}
            viewport={viewport}
            virtualWindow={virtualWindow}
            onUpdateDuration={onUpdateDuration}
            onUpdateTask={onUpdateTask}
            onAddDependency={onAddDependency}
            hScrollRef={hScrollRef}
            vScrollRef={vScrollRef}
            projectStartDate={projectStartDate}
            selection={selection}
            onSelect={onSelect}
            nonWorkingDays={nonWorkingDays}
            baselines={baselines}
            showDependencies={showDependencies}
            timescaleModel={timescaleModel}
          />
        </div>
      </div>
    </div>
  );
}
