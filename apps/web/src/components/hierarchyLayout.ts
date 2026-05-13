/** Single source of truth for hierarchy x-grid step (text lanes + WBS bands). */
export const HIERARCHY_X_STEP = 8;

export const TREE_LANE_STEP = HIERARCHY_X_STEP;

/** Total width of the dedicated structural WBS band column (far left of table). */
export const WBS_BAND_FIELD_WIDTH = 60;
/** Horizontal step between nested band pillars within the WBS band field. */
export const WBS_BAND_STEP = HIERARCHY_X_STEP;
/** Width of each individual band pillar. Keep <= step so nested bands stay distinct. */
export const WBS_BAND_WIDTH = 8;