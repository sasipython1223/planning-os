import { projectDate } from "../../utils/dateProjection";

export type TimescaleTierKind = "year" | "quarter" | "month" | "week" | "day";
export type TickKind = "major" | "minor";
export type GridLineKind = "major" | "minor";
export type GridLineLevel = "year" | "quarter" | "month" | "week" | "day";
export type TimescaleGridUnit = "year" | "quarter" | "month" | "week" | "day";
export type TimescaleLabelMode = "calendar" | "month-count-from-start" | "month-count-to-finish";

export interface TimescaleTierConfig {
  tier: TimescaleTierKind;
}

export type TimescaleProfileId =
  | "year-quarter"
  | "year-month"
  | "quarter-month"
  | "month-only"
  | "month-count-from-start"
  | "month-count-to-finish"
  | "week-day";

export interface TimescaleProfile {
  id: TimescaleProfileId;
  label: string;
  tiers: TimescaleTierConfig[];
  gridUnit: TimescaleGridUnit;
  pixelsPerDay: number;
  showNonWorkingDayShading: boolean;
  labelMode?: TimescaleLabelMode;
}

export const TIMESCALE_PROFILES: Record<TimescaleProfileId, TimescaleProfile> = {
  "year-quarter": {
    id: "year-quarter",
    label: "Year / Quarter",
    tiers: [{ tier: "year" }, { tier: "quarter" }],
    gridUnit: "quarter",
    pixelsPerDay: 2,
    showNonWorkingDayShading: false,
    labelMode: "calendar",
  },
  "year-month": {
    id: "year-month",
    label: "Year / Month",
    tiers: [{ tier: "year" }, { tier: "month" }],
    gridUnit: "month",
    pixelsPerDay: 4,
    showNonWorkingDayShading: false,
    labelMode: "calendar",
  },
  "quarter-month": {
    id: "quarter-month",
    label: "Quarter / Month",
    tiers: [{ tier: "quarter" }, { tier: "month" }],
    gridUnit: "month",
    pixelsPerDay: 6,
    showNonWorkingDayShading: false,
    labelMode: "calendar",
  },
  "month-only": {
    id: "month-only",
    label: "Month Only",
    tiers: [{ tier: "month" }],
    gridUnit: "month",
    pixelsPerDay: 8,
    showNonWorkingDayShading: false,
    labelMode: "calendar",
  },
  "month-count-from-start": {
    id: "month-count-from-start",
    label: "Month Count (Start)",
    tiers: [{ tier: "month" }],
    gridUnit: "month",
    pixelsPerDay: 8,
    showNonWorkingDayShading: false,
    labelMode: "month-count-from-start",
  },
  "month-count-to-finish": {
    id: "month-count-to-finish",
    label: "Month Count (Finish)",
    tiers: [{ tier: "month" }],
    gridUnit: "month",
    pixelsPerDay: 8,
    showNonWorkingDayShading: false,
    labelMode: "month-count-to-finish",
  },
  "week-day": {
    id: "week-day",
    label: "Week / Day",
    tiers: [{ tier: "week" }, { tier: "day" }],
    gridUnit: "day",
    pixelsPerDay: 20,
    showNonWorkingDayShading: true,
    labelMode: "calendar",
  },
};

export const TIMESCALE_PROFILE_ORDER: TimescaleProfileId[] = [
  "year-quarter",
  "year-month",
  "quarter-month",
  "month-only",
  "month-count-from-start",
  "month-count-to-finish",
  "week-day",
];

export type ZoomPresetId = "day";

export interface ZoomPreset {
  id: ZoomPresetId;
  pixelsPerDay: number;
  majorTickEveryDays: number;
}

export const ZOOM_PRESETS: Record<ZoomPresetId, ZoomPreset> = {
  day: {
    id: "day",
    pixelsPerDay: 20,
    majorTickEveryDays: 5,
  },
};

export interface TimescaleInput {
  projectStartDate: string;
  maxDay: number;
  scrollLeft: number;
  viewportWidth: number;
  totalTimelineWidth: number;
  pixelsPerDay: number;
  manualPixelsPerDayOverride?: number | null;
  zoomPresetId?: ZoomPresetId;
  profileId?: TimescaleProfileId;
}

export interface HeaderTierItem {
  tier: TimescaleTierKind;
  label: string;
  startDay: number;
  endDay: number;
  startDate: Date;
  endDate: Date;
  x: number;
  width: number;
}

export interface TimescaleTickItem {
  day: number;
  date: Date;
  x: number;
  kind: TickKind;
  label: string;
}

export interface GridLineItem {
  day: number;
  date: Date;
  x: number;
  kind: GridLineKind;
  level: GridLineLevel;
}

export interface SpanPosition {
  x: number;
  width: number;
}

export interface TimescaleModel {
  profile: TimescaleProfile;
  projectStartDate: string;
  zoomPreset: ZoomPreset;
  unitWidth: number;
  totalWidth: number;
  scrollLeft: number;
  viewportWidth: number;
  maxDay: number;
  visibleStartDay: number;
  visibleEndDay: number;
  visibleStart: Date;
  visibleEnd: Date;
  headerTiers: HeaderTierItem[];
  ticks: TimescaleTickItem[];
  gridLines: GridLineItem[];
  dateToX: (day: number) => number;
  xToDay: (x: number) => number;
  spanWidth: (startDay: number, finishDay: number) => number;
  spanToX: (startDay: number, finishDay: number) => SpanPosition;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(date: Date): string {
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function shortMonthLabel(date: Date): string {
  return MONTH_LABELS[date.getUTCMonth()];
}

function yearLabel(date: Date): string {
  return `${date.getUTCFullYear()}`;
}

function quarterLabel(date: Date): string {
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

function shortQuarterLabel(date: Date): string {
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function dayLabel(date: Date): string {
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function weekLabel(day: number): string {
  return `W${Math.floor(day / 7) + 1}`;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthDiff(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function monthTierLabel(
  startDate: Date,
  projectStartDate: string,
  labelMode: TimescaleLabelMode,
  maxDay: number,
  topTier?: string,
): string {
  if (labelMode === "month-count-from-start") {
    const start = monthStart(projectDate(projectStartDate, 0));
    return `M${monthDiff(start, monthStart(startDate)) + 1}`;
  }

  if (labelMode === "month-count-to-finish") {
    const finish = monthStart(projectDate(projectStartDate, maxDay));
    const remaining = monthDiff(monthStart(startDate), finish);
    return `T-${remaining}`;
  }

  if (topTier === "year" || topTier === "quarter") {
    return shortMonthLabel(startDate);
  }

  return monthLabel(startDate);
}

function buildMonthTier(
  startDay: number,
  endDay: number,
  dateToX: (day: number) => number,
  spanWidth: (startDay: number, finishDay: number) => number,
  projectStartDate: string,
  labelMode: TimescaleLabelMode,
  maxDay: number,
  topTier?: string,
): HeaderTierItem[] {
  const items: HeaderTierItem[] = [];
  let cursor = startDay;

  while (cursor <= endDay) {
    const startDate = projectDate(projectStartDate, cursor);
    const startMonth = startDate.getUTCMonth();
    const startYear = startDate.getUTCFullYear();

    let monthEnd = cursor;
    while (monthEnd + 1 <= endDay) {
      const nextDate = projectDate(projectStartDate, monthEnd + 1);
      if (nextDate.getUTCMonth() !== startMonth || nextDate.getUTCFullYear() !== startYear) break;
      monthEnd++;
    }

    const endDate = projectDate(projectStartDate, monthEnd + 1);
    items.push({
      tier: "month",
      label: monthTierLabel(startDate, projectStartDate, labelMode, maxDay, topTier),
      startDay: cursor,
      endDay: monthEnd + 1,
      startDate,
      endDate,
      x: dateToX(cursor),
      width: spanWidth(cursor, monthEnd + 1),
    });

    cursor = monthEnd + 1;
  }

  return items;
}

function buildQuarterTier(
  startDay: number,
  endDay: number,
  dateToX: (day: number) => number,
  spanWidth: (startDay: number, finishDay: number) => number,
  projectStartDate: string,
  topTier?: string,
): HeaderTierItem[] {
  const items: HeaderTierItem[] = [];
  let cursor = startDay;

  while (cursor <= endDay) {
    const startDate = projectDate(projectStartDate, cursor);
    const startYear = startDate.getUTCFullYear();
    const startQuarter = Math.floor(startDate.getUTCMonth() / 3);

    let quarterEnd = cursor;
    while (quarterEnd + 1 <= endDay) {
      const nextDate = projectDate(projectStartDate, quarterEnd + 1);
      if (nextDate.getUTCFullYear() !== startYear || Math.floor(nextDate.getUTCMonth() / 3) !== startQuarter) break;
      quarterEnd++;
    }

    const endDate = projectDate(projectStartDate, quarterEnd + 1);
    items.push({
      tier: "quarter",
      label: topTier === "year" ? shortQuarterLabel(startDate) : quarterLabel(startDate),
      startDay: cursor,
      endDay: quarterEnd + 1,
      startDate,
      endDate,
      x: dateToX(cursor),
      width: spanWidth(cursor, quarterEnd + 1),
    });

    cursor = quarterEnd + 1;
  }

  return items;
}

function buildYearTier(
  startDay: number,
  endDay: number,
  dateToX: (day: number) => number,
  spanWidth: (startDay: number, finishDay: number) => number,
  projectStartDate: string,
): HeaderTierItem[] {
  const items: HeaderTierItem[] = [];
  let cursor = startDay;

  while (cursor <= endDay) {
    const startDate = projectDate(projectStartDate, cursor);
    const startYear = startDate.getUTCFullYear();

    let yearEnd = cursor;
    while (yearEnd + 1 <= endDay) {
      const nextDate = projectDate(projectStartDate, yearEnd + 1);
      if (nextDate.getUTCFullYear() !== startYear) break;
      yearEnd++;
    }

    const endDate = projectDate(projectStartDate, yearEnd + 1);
    items.push({
      tier: "year",
      label: yearLabel(startDate),
      startDay: cursor,
      endDay: yearEnd + 1,
      startDate,
      endDate,
      x: dateToX(cursor),
      width: spanWidth(cursor, yearEnd + 1),
    });

    cursor = yearEnd + 1;
  }

  return items;
}

function buildWeekTier(
  startDay: number,
  endDay: number,
  dateToX: (day: number) => number,
  spanWidth: (startDay: number, finishDay: number) => number,
  projectStartDate: string,
): HeaderTierItem[] {
  const items: HeaderTierItem[] = [];
  let cursor = startDay;

  while (cursor <= endDay) {
    const startDate = projectDate(projectStartDate, cursor);
    const weekStart = cursor;
    const weekEndExclusive = Math.min(endDay + 1, weekStart + 7);
    const endDate = projectDate(projectStartDate, weekEndExclusive);

    items.push({
      tier: "week",
      label: weekLabel(weekStart),
      startDay: weekStart,
      endDay: weekEndExclusive,
      startDate,
      endDate,
      x: dateToX(weekStart),
      width: spanWidth(weekStart, weekEndExclusive),
    });

    cursor = weekEndExclusive;
  }

  return items;
}

function buildDayTier(
  startDay: number,
  endDay: number,
  dateToX: (day: number) => number,
  spanWidth: (startDay: number, finishDay: number) => number,
  projectStartDate: string,
): HeaderTierItem[] {
  const items: HeaderTierItem[] = [];

  for (let day = startDay; day <= endDay; day++) {
    const startDate = projectDate(projectStartDate, day);
    const endDate = projectDate(projectStartDate, day + 1);
    items.push({
      tier: "day",
      label: dayLabel(startDate),
      startDay: day,
      endDay: day + 1,
      startDate,
      endDate,
      x: dateToX(day),
      width: spanWidth(day, day + 1),
    });
  }

  return items;
}

export function createTimescaleModel(input: TimescaleInput): TimescaleModel {
  const profile = TIMESCALE_PROFILES[input.profileId ?? "year-month"];
  const zoomPreset = ZOOM_PRESETS[input.zoomPresetId ?? "day"];
  const baseUnitWidth = input.pixelsPerDay > 0 ? input.pixelsPerDay : zoomPreset.pixelsPerDay;
  const unitWidth = input.manualPixelsPerDayOverride && input.manualPixelsPerDayOverride > 0
    ? input.manualPixelsPerDayOverride
    : profile.pixelsPerDay;
  const widthScale = baseUnitWidth > 0 ? unitWidth / baseUnitWidth : 1;
  const totalWidth = Math.max(unitWidth, Math.ceil(input.totalTimelineWidth * widthScale));

  const visibleStartDay = Math.max(0, Math.floor(input.scrollLeft / unitWidth) - 1);
  const visibleEndDay = Math.min(input.maxDay, Math.ceil((input.scrollLeft + input.viewportWidth) / unitWidth) + 1);

  const dateToX = (day: number): number => day * unitWidth;
  const xToDay = (x: number): number => x / unitWidth;
  const spanWidth = (startDay: number, finishDay: number): number => (finishDay - startDay) * unitWidth;
  const spanToX = (startDay: number, finishDay: number): SpanPosition => ({
    x: dateToX(startDay),
    width: spanWidth(startDay, finishDay),
  });

  const ticks: TimescaleTickItem[] = [];
  const gridLines: GridLineItem[] = [];
  for (let day = visibleStartDay; day <= visibleEndDay; day++) {
    const date = projectDate(input.projectStartDate, day);
    const isYearBoundary = date.getUTCDate() === 1 && date.getUTCMonth() === 0;
    const isQuarterBoundary = date.getUTCDate() === 1 && date.getUTCMonth() % 3 === 0;
    const isMonthBoundary = date.getUTCDate() === 1;
    const isWeekBoundary = day % 7 === 0;
    const isGridBoundary =
      profile.gridUnit === "day"
        ? true
        : profile.gridUnit === "week"
          ? isWeekBoundary
          : profile.gridUnit === "month"
            ? isMonthBoundary
            : profile.gridUnit === "quarter"
              ? isQuarterBoundary
              : isYearBoundary;

    if (!isGridBoundary) continue;

    const kind: TickKind = profile.gridUnit === "day"
      ? (day === 0 || day % zoomPreset.majorTickEveryDays === 0 ? "major" : "minor")
      : "major";

    const label = profile.gridUnit === "day"
      ? dayLabel(date)
      : profile.gridUnit === "week"
        ? weekLabel(day)
        : profile.gridUnit === "month"
          ? MONTH_LABELS[date.getUTCMonth()]
          : profile.gridUnit === "quarter"
            ? `Q${Math.floor(date.getUTCMonth() / 3) + 1}`
            : yearLabel(date);

    const x = dateToX(day);
    const level: GridLineLevel = isYearBoundary
      ? "year"
      : isQuarterBoundary
        ? "quarter"
        : isMonthBoundary
          ? "month"
          : isWeekBoundary
            ? "week"
            : "day";
    ticks.push({ day, date, x, kind, label });
    gridLines.push({ day, date, x, kind, level });
  }

  const labelMode: TimescaleLabelMode = profile.labelMode ?? "calendar";
  const topTier = profile.tiers[0]?.tier;
  const headerTiers: HeaderTierItem[] = profile.tiers.flatMap((tierConfig) => {
    switch (tierConfig.tier) {
      case "year":
        return buildYearTier(visibleStartDay, visibleEndDay, dateToX, spanWidth, input.projectStartDate);
      case "quarter":
        return buildQuarterTier(visibleStartDay, visibleEndDay, dateToX, spanWidth, input.projectStartDate, topTier);
      case "month":
        return buildMonthTier(visibleStartDay, visibleEndDay, dateToX, spanWidth, input.projectStartDate, labelMode, input.maxDay, topTier);
      case "week":
        return buildWeekTier(visibleStartDay, visibleEndDay, dateToX, spanWidth, input.projectStartDate);
      case "day":
      default:
        return buildDayTier(visibleStartDay, visibleEndDay, dateToX, spanWidth, input.projectStartDate);
    }
  });

  return {
    profile,
    projectStartDate: input.projectStartDate,
    zoomPreset,
    unitWidth,
    totalWidth,
    scrollLeft: input.scrollLeft,
    viewportWidth: input.viewportWidth,
    maxDay: input.maxDay,
    visibleStartDay,
    visibleEndDay,
    visibleStart: projectDate(input.projectStartDate, visibleStartDay),
    visibleEnd: projectDate(input.projectStartDate, visibleEndDay),
    headerTiers,
    ticks,
    gridLines,
    dateToX,
    xToDay,
    spanWidth,
    spanToX,
  };
}
