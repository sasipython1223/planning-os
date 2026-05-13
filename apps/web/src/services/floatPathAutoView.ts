import type { FloatPathMvpResponse } from "@planner/protocol";
import type { FloatPathViewFilter } from "./floatPathProjection";

/**
 * Picks the default post-result filter for right-click float path context actions.
 * Rules:
 * - Prefer Path 1 when present.
 * - If no Path 1 exists but returned paths exist, use allReturned.
 * - If no paths were returned, do not auto-apply a filter.
 */
export function deriveDefaultFloatPathAutoViewFilter(result: FloatPathMvpResponse): FloatPathViewFilter | null {
  const path1 = result.paths.find((path) => path.floatPathNumber === 1);
  if (path1) {
    return { mode: "path", pathId: path1.pathId };
  }

  if (result.paths.length > 0) {
    return { mode: "allReturned" };
  }

  return null;
}
