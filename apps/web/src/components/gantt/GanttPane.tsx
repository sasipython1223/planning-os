import type { BaselineMap, Dependency, ScheduleResultMap, Task } from "protocol";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Selection } from "../../App";
import { HEADER_METRICS } from "../../ui/config/themeConfig";
import type { TimelineGeometry } from "../../utils/timelineGeometry";
import { GanttCanvas } from "./GanttCanvas";
import { TimescaleCanvas } from "./TimescaleCanvas";
import type { Viewport } from "./viewportTypes";

interface GanttPaneProps {
  tasks: Task[];
  scheduleResults: ScheduleResultMap;
  dependencies: Dependency[];
  scrollTop: number;
  viewportHeight: number;
  onUpdateDuration: (taskId: string, newDuration: number) => void;
  onUpdateTask: (taskId: string, updates: { minEarlyStart?: number }) => void;
  onAddDependency: (predId: string, succId: string) => void;
  vScrollRef: RefObject<HTMLDivElement | null>;
  timeline: TimelineGeometry;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  nonWorkingDays: ReadonlySet<number>;
  baselines: BaselineMap;
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
  onScrollLeftChange,
  onHScrollMount,
  bodyRef: externalBodyRef,
}: GanttPaneProps) {
  const hScrollRef = useRef<HTMLDivElement>(null);

  // Merge internal hScrollRef with external bodyRef so App can imperatively set scrollTop
  const mergedBodyRef = useCallback((el: HTMLDivElement | null) => {
    (hScrollRef as MutableRefObject<HTMLDivElement | null>).current = el;
    if (externalBodyRef) {
      (externalBodyRef as MutableRefObject<HTMLDivElement | null>).current = el;
    }
  }, [externalBodyRef]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);

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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Fixed timescale header */}
      <div className="gantt-header" style={{ flexShrink: 0, height: HEADER_METRICS.totalHeight }}>
        <TimescaleCanvas
          viewportWidth={paneWidth}
          scrollLeft={scrollLeft}
          maxDay={maxDay}
          projectStartDate={projectStartDate}
          nonWorkingDays={nonWorkingDays}
          pixelsPerDay={pixelsPerDay}
        />
      </div>

      {/* Horizontal-only scroll container */}
      <div
        ref={mergedBodyRef}
        className="gantt-body"
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
            width: totalTimelineWidth,
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
          />
        </div>
      </div>
    </div>
  );
}
