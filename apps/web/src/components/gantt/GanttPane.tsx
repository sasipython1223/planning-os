import type { BaselineMap, Dependency, ScheduleResultMap, Task } from "protocol";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Selection } from "../../App";
import { GanttCanvas } from "./GanttCanvas";
import { TimescaleCanvas } from "./TimescaleCanvas";
import { DAY_WIDTH } from "./ganttConstants";
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
  projectStartDate: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  nonWorkingDays: ReadonlySet<number>;
  baselines: BaselineMap;
  onScrollLeftChange?: (scrollLeft: number, paneWidth: number) => void;
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
  projectStartDate,
  selection,
  onSelect,
  nonWorkingDays,
  baselines,
  onScrollLeftChange,
}: GanttPaneProps) {
  const hScrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);

  // Total content dimensions (world coordinates)
  const maxDay = useMemo(() => {
    let max = 20;
    Object.values(scheduleResults).forEach((s) => {
      if (s.earlyFinish > max) max = s.earlyFinish;
    });
    return Math.ceil(max * 1.2);
  }, [scheduleResults]);

  const totalWidth = maxDay * DAY_WIDTH + 100;

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
      <div className="gantt-header">
        <TimescaleCanvas
          viewportWidth={paneWidth}
          scrollLeft={scrollLeft}
          maxDay={maxDay}
          projectStartDate={projectStartDate}
          nonWorkingDays={nonWorkingDays}
        />
      </div>

      {/* Horizontal-only scroll container */}
      <div
        ref={hScrollRef}
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
            width: totalWidth,
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
