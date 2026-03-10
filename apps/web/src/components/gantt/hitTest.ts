import type { Dependency, ScheduleResultMap, Task } from "protocol";
import { BAR_HEIGHT, BAR_VERTICAL_PADDING, DAY_WIDTH, ROW_HEIGHT } from "./ganttConstants";
import type { TaskGeometry } from "./ganttGeometry";

const EDGE_THRESHOLD = 5;
const LINK_NODE_RADIUS = 6;

export type HitZone = "bar" | "left-resize" | "right-resize" | "link-node" | "background";

export interface HitResult {
  zone: HitZone;
  /** Task ID, set when zone is not "background" */
  taskId: string | null;
  rowIndex: number;
}

const BACKGROUND_HIT: HitResult = { zone: "background", taskId: null, rowIndex: -1 };

/**
 * Pure O(1) hit-test for Gantt task bars.
 * Uses row index lookup — no search over all tasks.
 *
 * @param worldX - mouse X in world (content) coordinates
 * @param worldY - mouse Y in world (content) coordinates
 * @param tasks - ordered task array (index = row)
 * @param scheduleResults - schedule data from Worker
 */
export function hitTestBar(
  worldX: number,
  worldY: number,
  tasks: Task[],
  scheduleResults: ScheduleResultMap,
): HitResult {
  // O(1) row lookup
  const rowIndex = Math.floor(worldY / ROW_HEIGHT);
  if (rowIndex < 0 || rowIndex >= tasks.length) return BACKGROUND_HIT;

  const task = tasks[rowIndex];
  const schedule = scheduleResults[task.id];
  if (!schedule) return { zone: "background", taskId: null, rowIndex };

  // Summary tasks are non-interactive — return background
  if (task.isSummary) return { zone: "background", taskId: task.id, rowIndex };

  // Vertical bar band check
  const barTop = rowIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING;
  const barBottom = barTop + BAR_HEIGHT;
  if (worldY < barTop || worldY > barBottom) {
    return { zone: "background", taskId: null, rowIndex };
  }

  // Horizontal bar range check
  const barLeft = schedule.earlyStart * DAY_WIDTH;
  const barRight = barLeft + (schedule.earlyFinish - schedule.earlyStart) * DAY_WIDTH;
  if (worldX < barLeft || worldX > barRight) {
    return { zone: "background", taskId: null, rowIndex };
  }

  // Link-node circle: centred at (barRight, barCenterY), tested before edge zones
  const barCenterY = barTop + BAR_HEIGHT / 2;
  const dx = worldX - barRight;
  const dy = worldY - barCenterY;
  if (dx * dx + dy * dy <= LINK_NODE_RADIUS * LINK_NODE_RADIUS) {
    return { zone: "link-node", taskId: task.id, rowIndex };
  }

  // Edge detection
  if (worldX - barLeft <= EDGE_THRESHOLD) {
    return { zone: "left-resize", taskId: task.id, rowIndex };
  }
  if (barRight - worldX <= EDGE_THRESHOLD) {
    return { zone: "right-resize", taskId: task.id, rowIndex };
  }

  return { zone: "bar", taskId: task.id, rowIndex };
}

/** Map a hit zone to the appropriate CSS cursor value. */
export function cursorForZone(zone: HitZone): string {
  switch (zone) {
    case "bar": return "move";
    case "left-resize":
    case "right-resize": return "ew-resize";
    case "link-node": return "crosshair";
    default: return "grab";
  }
}

export { LINK_NODE_RADIUS };

const DEP_HIT_TOLERANCE = 5;

/** Distance from point to an axis-aligned segment. */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  // Horizontal segment
  if (ay === by) {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const clampedX = Math.max(minX, Math.min(maxX, px));
    return Math.hypot(px - clampedX, py - ay);
  }
  // Vertical segment
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  const clampedY = Math.max(minY, Math.min(maxY, py));
  return Math.hypot(px - ax, py - clampedY);
}

/**
 * Hit-test for dependency lines. Only call on click — not on mousemove.
 * Tests orthogonal 3-segment routing matching drawDependencies.
 * Returns the dependency id on hit, or null.
 */
export function hitTestDependency(
  worldX: number,
  worldY: number,
  dependencies: Dependency[],
  geometryMap: Map<string, TaskGeometry>,
): string | null {
  for (const dep of dependencies) {
    const predGeom = geometryMap.get(dep.predId);
    const succGeom = geometryMap.get(dep.succId);
    if (!predGeom || !succGeom) continue;

    // Anchor selection by type
    const x1 = (dep.type === "SS" || dep.type === "SF") ? predGeom.leftEdge : predGeom.rightEdge;
    const x2 = (dep.type === "FS" || dep.type === "SS") ? succGeom.leftEdge : succGeom.rightEdge;
    const y1 = predGeom.centerY;
    const y2 = succGeom.centerY;
    const midX = (x1 + x2) / 2;

    if (
      distToSegment(worldX, worldY, x1, y1, midX, y1) <= DEP_HIT_TOLERANCE ||
      distToSegment(worldX, worldY, midX, y1, midX, y2) <= DEP_HIT_TOLERANCE ||
      distToSegment(worldX, worldY, midX, y2, x2, y2) <= DEP_HIT_TOLERANCE
    ) {
      return dep.id;
    }
  }
  return null;
}
