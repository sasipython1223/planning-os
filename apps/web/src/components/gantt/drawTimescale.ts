import { HEADER_METRICS } from "../../ui/config/themeConfig";
import { COLORS } from "./ganttConstants";
import type { GridLineLevel, TimescaleModel } from "./timescaleModel";

function gridlineStyle(level: GridLineLevel): { color: string; width: number } {
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
 * Draws the timescale (date ruler) on a viewport-sized canvas.
 * Translates by scrollLeft to show the correct time range.
 * Pure function - no side effects beyond canvas rendering.
 */
export function drawTimescale(
  ctx: CanvasRenderingContext2D,
  model: TimescaleModel,
  nonWorkingDays: ReadonlySet<number>,
): void {
  const height = HEADER_METRICS.totalHeight;
  const tickBandHeight = 10;
  const tierConfigs = model.profile.tiers;
  const tierAreaHeight = Math.max(0, height - tickBandHeight);
  const tierRowHeight = tierConfigs.length > 0 ? tierAreaHeight / tierConfigs.length : tierAreaHeight;

  // Clear background (viewport-sized)
  ctx.fillStyle = COLORS.timescaleBackground;
  ctx.fillRect(0, 0, model.viewportWidth, height);

  // Translate to world coordinates
  ctx.save();
  ctx.translate(-model.scrollLeft, 0);

  // Shade non-working day columns
  if (model.profile.showNonWorkingDayShading && nonWorkingDays.size > 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    for (let day = model.visibleStartDay; day <= model.visibleEndDay; day++) {
      if (nonWorkingDays.has(day)) {
        ctx.fillRect(model.dateToX(day), 0, model.spanWidth(day, day + 1), height);
      }
    }
  }

  // Paint subtle row bands so parent/child tiers read as distinct merged-cell rows.
  for (let rowIndex = 0; rowIndex < tierConfigs.length; rowIndex++) {
    const rowTop = rowIndex * tierRowHeight;
    ctx.fillStyle = rowIndex === 0 ? "rgba(255, 255, 255, 0.62)" : "rgba(255, 255, 255, 0.42)";
    ctx.fillRect(model.scrollLeft, rowTop, model.viewportWidth, tierRowHeight);
  }

  // Draw vertical boundary hierarchy in the bottom tick band using model-provided lines.
  // This preserves x alignment with body gridlines without cluttering tier labels.
  const tickTop = height - tickBandHeight;
  const levelOrder: GridLineLevel[] = ["day", "week", "month", "quarter", "year"];
  for (const level of levelOrder) {
    const lines = model.gridLines.filter((line) => line.level === level);
    if (lines.length === 0) continue;

    const style = gridlineStyle(level);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    for (const line of lines) {
      const gx = Math.round(line.x) + 0.5;
      ctx.moveTo(gx, tickTop);
      ctx.lineTo(gx, height);
    }
    ctx.stroke();
  }

  // Render tier rows generically from profile-provided tier config.
  ctx.fillStyle = COLORS.text;
  ctx.font = "11px Arial";
  ctx.textBaseline = "middle";

  // Padding inside each cell before/after the label (px).
  const LABEL_PAD = 4;

  for (let rowIndex = 0; rowIndex < tierConfigs.length; rowIndex++) {
    const tierKind = tierConfigs[rowIndex].tier;
    const rowTop = rowIndex * tierRowHeight;
    const rowMid = rowTop + tierRowHeight / 2;
    const items = model.headerTiers.filter((tier) => tier.tier === tierKind);

    // Draw row-local cell fills and borders from model-provided segment bounds.
    const cellFill = rowIndex === 0 ? "rgba(255, 255, 255, 0.72)" : "rgba(255, 255, 255, 0.54)";
    const cellBorder = rowIndex === 0 ? "rgba(0, 0, 0, 0.12)" : "rgba(0, 0, 0, 0.09)";
    for (const seg of items) {
      if (seg.width <= 0) continue;
      ctx.fillStyle = cellFill;
      ctx.fillRect(seg.x, rowTop, seg.width, tierRowHeight);
    }

    ctx.strokeStyle = cellBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of items) {
      if (seg.width <= 0) continue;
      const rightX = Math.round(seg.x + seg.width) + 0.5;
      const bottomY = Math.round(rowTop + tierRowHeight) + 0.5;
      const leftX = Math.round(seg.x) + 0.5;
      ctx.moveTo(rightX, rowTop);
      ctx.lineTo(rightX, rowTop + tierRowHeight);
      ctx.moveTo(leftX, bottomY);
      ctx.lineTo(rightX, bottomY);
    }
    ctx.stroke();

    ctx.textAlign = tierKind === "day" ? "center" : "left";

    for (const seg of items) {
      const minWidth = tierKind === "day" ? 14 : 18;
      if (seg.width <= minWidth) continue;

      const clipX = seg.x + 1;
      const clipY = rowTop + 1;
      const clipW = Math.max(0, seg.width - 2);
      const clipH = Math.max(0, tierRowHeight - 2);
      if (clipW <= 0 || clipH <= 0) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();

      // Stabilize label paint state after cell fills/borders so text remains legible.
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#2f3b45";
      ctx.textBaseline = "middle";
      ctx.textAlign = tierKind === "day" ? "center" : "left";

      if (tierKind === "day") {
        // Width-adaptive day labels: "Jan 3" → "3" → hidden.
        const centerX = seg.x + seg.width / 2;
        const availableDay = clipW - 2;
        if (ctx.measureText(seg.label).width <= availableDay) {
          ctx.fillText(seg.label, centerX, rowMid);
        } else {
          const dayNum = String(seg.startDate.getUTCDate());
          if (ctx.measureText(dayNum).width <= availableDay) {
            ctx.fillText(dayNum, centerX, rowMid);
          }
          // else: cell too narrow — skip label entirely
        }
        ctx.restore();
        continue;
      }

      // For non-day tiers, clamp label start to viewport left edge so partially
      // scrolled-off cells still show their label rather than an accidental clip.
      const cellRight = seg.x + seg.width;
      const tierPad = tierKind === "quarter" ? 2 : LABEL_PAD;
      const labelX = Math.max(seg.x + tierPad, model.scrollLeft + tierPad);

      // Available width between the clamped label start and the right cell edge.
      const available = cellRight - labelX - tierPad;
      if (available <= 0) {
        ctx.restore();
        continue;
      }

      if (tierKind === "month") {
        // Candidate labels in preference order: 3-letter abbrev → single initial.
        // seg.label is already the short form ("Jan") from the model.
        const initial = seg.label[0];
        const candidates = [seg.label, initial];
        let chosen: string | null = null;
        for (const candidate of candidates) {
          if (ctx.measureText(candidate).width <= available) {
            chosen = candidate;
            break;
          }
        }
        if (chosen !== null) {
          ctx.fillText(chosen, labelX, rowMid);
        }
      } else {
        // Year, quarter, week — single label, draw if it fits.
        const fitTolerance = tierKind === "quarter" ? 1.5 : 0;
        if (ctx.measureText(seg.label).width <= available + fitTolerance) {
          ctx.fillText(seg.label, labelX, rowMid);
        }
      }

      ctx.restore();
    }

    if (rowIndex < tierConfigs.length - 1) {
      const y = rowTop + tierRowHeight + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(model.scrollLeft, y);
      ctx.lineTo(model.scrollLeft + model.viewportWidth, y);
      ctx.stroke();
    }
  }

  // Bottom border
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  ctx.moveTo(model.scrollLeft, height);
  ctx.lineTo(model.scrollLeft + model.viewportWidth, height);
  ctx.stroke();

  ctx.restore();
}
