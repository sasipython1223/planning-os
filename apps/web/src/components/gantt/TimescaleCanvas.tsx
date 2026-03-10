import { useEffect, useRef } from "react";
import { drawTimescale } from "./drawTimescale";
import { TIMESCALE_HEIGHT } from "./ganttConstants";

interface TimescaleCanvasProps {
  viewportWidth: number;
  scrollLeft: number;
  maxDay: number;
  projectStartDate: string;
  nonWorkingDays: ReadonlySet<number>;
}

/**
 * Fixed timescale header canvas.
 * Responds to scrollLeft and viewportWidth changes.
 * Uses rAF to coalesce redraws.
 */
export function TimescaleCanvas({ viewportWidth, scrollLeft, maxDay, projectStartDate, nonWorkingDays }: TimescaleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || viewportWidth === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewportWidth * dpr;
      canvas.height = TIMESCALE_HEIGHT * dpr;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${TIMESCALE_HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawTimescale(ctx, viewportWidth, maxDay, scrollLeft, projectStartDate, nonWorkingDays);
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [viewportWidth, scrollLeft, maxDay, projectStartDate, nonWorkingDays]);

  return <canvas ref={canvasRef} style={{ display: "block", flexShrink: 0 }} />;
}
