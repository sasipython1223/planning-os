import type { Resource, ResourceHistogram } from "protocol";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HEADER_METRICS } from "../ui/config/themeConfig";
import { projectDateShort } from "../utils/dateProjection";
import {
  computeYScale,
  drawHistogram,
  HIST_COLOR_NORMAL,
  HIST_COLOR_OVER,
} from "../utils/drawHistogram";
import type { TimelineGeometry } from "../utils/timelineGeometry";
import { TimescaleCanvas } from "./gantt/TimescaleCanvas";

const HISTOGRAM_HEIGHT = 120;
const SPLITTER_WIDTH = 4;
const SCROLL_TRACK_WIDTH = 17;

interface HistogramPaneProps {
  resourceHistogram: ResourceHistogram;
  selectedResource: Resource | null;
  ganttScrollElRef: React.RefObject<HTMLDivElement | null>;
  timeline: TimelineGeometry;
  tableWidth: number;
  nonWorkingDays: ReadonlySet<number>;
  axisPaneRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Synchronized resource histogram aligned with the Gantt timeline.
 * Left axis pane aligns with table+splitter. Chart viewport scrolls
 * in sync with the Gantt via imperative ref-based scroll synchronization.
 * Shares timeline geometry with Gantt — no independent timeline math.
 */
export function HistogramPane({
  resourceHistogram,
  selectedResource,
  ganttScrollElRef,
  timeline,
  tableWidth,
  nonWorkingDays,
  axisPaneRef,
}: HistogramPaneProps) {
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [chartWidth, setChartWidth] = useState(0);

  const axisPaneWidth = tableWidth + SPLITTER_WIDTH;

  // Gantt → Histogram scroll sync (unidirectional; histogram has no visible scrollbar)
  useEffect(() => {
    const ganttEl = ganttScrollElRef.current;
    const histEl = chartScrollRef.current;
    if (!ganttEl || !histEl) return;

    const syncFromGantt = () => {
      histEl.scrollLeft = ganttEl.scrollLeft;
    };

    ganttEl.addEventListener('scroll', syncFromGantt);
    // Initial sync
    histEl.scrollLeft = ganttEl.scrollLeft;

    return () => {
      ganttEl.removeEventListener('scroll', syncFromGantt);
    };
  }, [ganttScrollElRef]);

  // Proxy horizontal wheel/trackpad gestures over histogram to Gantt scroll owner
  const handleHistogramWheel = useCallback((e: React.WheelEvent) => {
    const ganttEl = ganttScrollElRef.current;
    if (!ganttEl) return;
    if (e.deltaX) {
      ganttEl.scrollLeft += e.deltaX;
    }
  }, [ganttScrollElRef]);

  // Track local scroll for canvas redraw
  const handleScroll = useCallback(() => {
    const el = chartScrollRef.current;
    if (el) setScrollLeft(el.scrollLeft);
  }, []);

  // Measure chart viewport width
  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    const measure = () => setChartWidth(el.clientWidth);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Tooltip state ──────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: number; units: number } | null>(null);

  // Y-scale ticks (memoized to avoid recompute every render)
  const histogram = selectedResource ? resourceHistogram[selectedResource.id] : undefined;
  const yScale = useMemo(
    () => computeYScale(selectedResource?.maxUnitsPerDay ?? 0, histogram, HISTOGRAM_HEIGHT),
    [selectedResource, histogram],
  );

  // Draw histogram canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = chartWidth || 300;
    const h = HISTOGRAM_HEIGHT;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    if (!selectedResource) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#999";
      ctx.font = "12px Arial";
      ctx.fillText("No resource selected", 8, h / 2);
      return;
    }

    drawHistogram({
      ctx,
      histogram,
      selectedResource,
      scrollLeft,
      viewportWidth: w,
      pixelsPerDay: timeline.pixelsPerDay,
      height: h,
    });
  }, [resourceHistogram, selectedResource, scrollLeft, chartWidth, histogram]);

  // ── Tooltip handlers ──────────────────────────────────────────
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!selectedResource || !histogram) { setTooltip(null); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const day = Math.floor((mouseX + scrollLeft) / timeline.pixelsPerDay);
      const units = histogram[day] || 0;
      if (units === 0) { setTooltip(null); return; }
      setTooltip({ x: e.clientX, y: e.clientY, day, units });
    },
    [selectedResource, histogram, scrollLeft, timeline.pixelsPerDay],
  );
  const handleCanvasMouseLeave = useCallback(() => setTooltip(null), []);

  const capacity = selectedResource?.maxUnitsPerDay ?? 0;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Axis pane — aligned with table + splitter; border-box so borderRight is included in width */}
      <div
        ref={axisPaneRef}
        style={{
          width: axisPaneWidth,
          boxSizing: "border-box",
          flexShrink: 0,
          borderRight: "1px solid #ccc",
          background: "#fafafa",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Spacer matching the timescale header height */}
        <div style={{ flexShrink: 0, height: HEADER_METRICS.totalHeight }} />

        {/* Y-axis ticks + legend occupy the chart-height region */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {/* Tick labels — right-aligned, positioned absolutely matching chart Y */}
          {selectedResource && yScale.ticks.map((t) => (
            <span
              key={t.value}
              style={{
                position: "absolute",
                right: 4,
                top: t.y - 6,
                fontSize: 10,
                lineHeight: "12px",
                color: t.value === capacity ? HIST_COLOR_OVER : "#999",
                fontWeight: t.value === capacity ? 600 : 400,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {t.label}
            </span>
          ))}

          {/* Compact legend at bottom of axis pane */}
          <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: 9, lineHeight: "14px", color: "#666" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 8, height: 8, background: HIST_COLOR_NORMAL, display: "inline-block", borderRadius: 1 }} />
              <span>Allocated</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 8, height: 8, background: HIST_COLOR_OVER, display: "inline-block", borderRadius: 1 }} />
              <span>Over</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right column: shared timescale header + chart viewport */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", marginRight: SCROLL_TRACK_WIDTH }} onWheel={handleHistogramWheel}>
        {/* Shared timescale header — identical to Gantt, height from TS metrics */}
        <div style={{ flexShrink: 0, height: HEADER_METRICS.totalHeight }}>
          <TimescaleCanvas
            viewportWidth={chartWidth}
            scrollLeft={scrollLeft}
            maxDay={timeline.maxDay}
            projectStartDate={timeline.projectStartDate}
            nonWorkingDays={nonWorkingDays}
            pixelsPerDay={timeline.pixelsPerDay}
          />
        </div>

        {/* Chart viewport — scrollbar visually hidden via CSS class,
            follows Gantt imperatively. overflowX:auto so programmatic
            scrollLeft works with the phantom sizer. */}
        <div
          ref={chartScrollRef}
          onScroll={handleScroll}
          className="histogram-chart-viewport"
          style={{
            flex: 1,
            overflowX: "auto",
            overflowY: "hidden",
            position: "relative",
            background: "#fafafa",
            minWidth: 0,
          }}
        >
          {/* Phantom sizer for horizontal scroll range */}
          <div
            style={{
              width: timeline.totalTimelineWidth,
              height: 1,
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          />

          {/* Sticky canvas — viewport-sized, positioned at scroll origin */}
          <div
            style={{
              position: "sticky",
              left: 0,
              width: chartWidth || "100%",
              height: HISTOGRAM_HEIGHT,
              overflow: "hidden",
            }}
          >
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={handleCanvasMouseLeave}
            />
          </div>
        </div>
      </div>

      {/* Tooltip — fixed position, outside layout flow */}
      {tooltip && selectedResource && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            background: "rgba(33,33,33,0.92)",
            color: "#fff",
            padding: "5px 8px",
            borderRadius: 4,
            fontSize: 11,
            lineHeight: "16px",
            pointerEvents: "none",
            zIndex: 1000,
            whiteSpace: "nowrap",
          }}
        >
          <div>{projectDateShort(timeline.projectStartDate, tooltip.day)}</div>
          <div>Total: {tooltip.units}h</div>
          <div>Capacity: {capacity}h</div>
          {tooltip.units > capacity && (
            <div style={{ color: "#ff8a80" }}>Over: +{tooltip.units - capacity}h</div>
          )}
        </div>
      )}
    </div>
  );
}
