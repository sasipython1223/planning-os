import type { Resource, ResourceHistogram } from "protocol";
import { useEffect, useRef } from "react";
import { drawHistogram } from "../utils/drawHistogram";
import { DAY_WIDTH } from "./gantt/ganttConstants";

const HISTOGRAM_HEIGHT = 120;

interface HistogramPaneProps {
  resourceHistogram: ResourceHistogram;
  selectedResource: Resource | null;
  scrollLeft: number;
  viewportWidth: number;
}

export function HistogramPane({
  resourceHistogram,
  selectedResource,
  scrollLeft,
  viewportWidth,
}: HistogramPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = viewportWidth || canvas.parentElement?.clientWidth || 300;
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

    const histogram = resourceHistogram[selectedResource.id];

    drawHistogram({
      ctx,
      histogram,
      selectedResource,
      scrollLeft,
      viewportWidth: w,
      dayWidth: DAY_WIDTH,
      height: h,
    });
  }, [resourceHistogram, selectedResource, scrollLeft, viewportWidth]);

  return (
    <div style={{
      height: HISTOGRAM_HEIGHT,
      borderTop: "1px solid #ccc",
      background: "#fafafa",
      flexShrink: 0,
      overflow: "hidden",
    }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
