import { useEffect, useRef } from "react";
import { HEADER_METRICS } from "../../ui/config/themeConfig";
import { drawTimescale } from "./drawTimescale";
import type { TimescaleModel } from "./timescaleModel";

interface TimescaleCanvasProps {
  model: TimescaleModel;
  nonWorkingDays: ReadonlySet<number>;
}

/**
 * Fixed timescale header canvas.
 * Responds to scrollLeft and viewportWidth changes.
 * Uses rAF to coalesce redraws.
 */
export function TimescaleCanvas({ model, nonWorkingDays }: TimescaleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || model.viewportWidth === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const TIMESCALE_HEIGHT = HEADER_METRICS.totalHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = model.viewportWidth * dpr;
      canvas.height = TIMESCALE_HEIGHT * dpr;
      canvas.style.width = `${model.viewportWidth}px`;
      canvas.style.height = `${TIMESCALE_HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawTimescale(ctx, model, nonWorkingDays);
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [model, nonWorkingDays]);

  return <canvas ref={canvasRef} style={{ display: "block", flexShrink: 0 }} />;
}
