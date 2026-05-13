import { describe, expect, it } from "vitest";
import { createTimescaleModel } from "./components/gantt/timescaleModel";

function makeInput(profileId: Parameters<typeof createTimescaleModel>[0]["profileId"]) {
  return {
    projectStartDate: "2026-01-01",
    maxDay: 90,
    scrollLeft: 0,
    viewportWidth: 2000,
    totalTimelineWidth: 4000,
    pixelsPerDay: 20,
    profileId,
  };
}

describe("timescale profiles", () => {
  it("defaults to year-month when profileId is omitted", () => {
    const input = makeInput("year-month");
    const { profileId: _profileId, ...withoutProfile } = input;
    const model = createTimescaleModel(withoutProfile);

    expect(model.profile.id).toBe("year-month");
  });

  it("applies fixed density by profile", () => {
    const yearQuarter = createTimescaleModel(makeInput("year-quarter"));
    const yearMonth = createTimescaleModel(makeInput("year-month"));
    const weekDay = createTimescaleModel(makeInput("week-day"));

    expect(yearQuarter.unitWidth).toBeLessThan(yearMonth.unitWidth);
    expect(yearMonth.unitWidth).toBeLessThan(weekDay.unitWidth);
    expect(yearQuarter.totalWidth).toBeLessThan(yearMonth.totalWidth);
    expect(yearMonth.totalWidth).toBeLessThan(weekDay.totalWidth);
  });

  it("applies manual density override without changing profile", () => {
    const model = createTimescaleModel({
      ...makeInput("year-quarter"),
      manualPixelsPerDayOverride: 9,
    });

    expect(model.profile.id).toBe("year-quarter");
    expect(model.unitWidth).toBe(9);
  });

  it("supports fractional manual density overrides for compressed overview profiles", () => {
    const model = createTimescaleModel({
      ...makeInput("year-month"),
      manualPixelsPerDayOverride: 0.5,
    });

    expect(model.profile.id).toBe("year-month");
    expect(model.unitWidth).toBe(0.5);
  });

  it("uses profile density when override is null", () => {
    const model = createTimescaleModel({
      ...makeInput("year-month"),
      manualPixelsPerDayOverride: null,
    });

    expect(model.unitWidth).toBe(4);
  });

  it("keeps date mapping and spans internally consistent across densities", () => {
    const model = createTimescaleModel(makeInput("year-month"));
    const span = model.spanToX(3, 8);

    expect(span.x).toBe(model.dateToX(3));
    expect(span.width).toBe(model.spanWidth(3, 8));
    expect(model.xToDay(model.dateToX(9))).toBe(9);
  });

  it("disables non-working shading for overview profiles and keeps it for week-day", () => {
    const yearMonth = createTimescaleModel(makeInput("year-month"));
    const yearQuarter = createTimescaleModel(makeInput("year-quarter"));
    const weekDay = createTimescaleModel(makeInput("week-day"));

    expect(yearMonth.profile.showNonWorkingDayShading).toBe(false);
    expect(yearQuarter.profile.showNonWorkingDayShading).toBe(false);
    expect(weekDay.profile.showNonWorkingDayShading).toBe(true);
  });

  it("builds year-quarter tiers from selected profile", () => {
    const model = createTimescaleModel(makeInput("year-quarter"));
    const kinds = new Set(model.headerTiers.map((item) => item.tier));

    expect(model.profile.id).toBe("year-quarter");
    expect(kinds.has("year")).toBe(true);
    expect(kinds.has("quarter")).toBe(true);
    expect(kinds.has("month")).toBe(false);
  });

  it("drives gridlines from the profile grid unit", () => {
    const model = createTimescaleModel(makeInput("year-month"));

    expect(model.gridLines.length).toBeGreaterThan(0);
    expect(model.gridLines.every((line) => line.date.getUTCDate() === 1)).toBe(true);
  });

  it("assigns boundary levels for month gridlines (year and month)", () => {
    const model = createTimescaleModel({
      ...makeInput("year-month"),
      maxDay: 380,
      viewportWidth: 4000,
    });

    const levels = new Set(model.gridLines.map((line) => line.level));
    expect(levels.has("year")).toBe(true);
    expect(levels.has("month")).toBe(true);
  });

  it("assigns boundary levels for quarter gridlines (year and quarter)", () => {
    const model = createTimescaleModel({
      ...makeInput("year-quarter"),
      maxDay: 380,
      viewportWidth: 4000,
    });

    const levels = new Set(model.gridLines.map((line) => line.level));
    expect(levels.has("year")).toBe(true);
    expect(levels.has("quarter")).toBe(true);
  });

  it("supports month count from start labeling", () => {
    const model = createTimescaleModel(makeInput("month-count-from-start"));
    const monthLabels = model.headerTiers
      .filter((item) => item.tier === "month")
      .map((item) => item.label);

    expect(monthLabels[0]).toBe("M1");
  });

  it("supports month count to finish labeling in the model", () => {
    const model = createTimescaleModel(makeInput("month-count-to-finish"));
    const monthItems = model.headerTiers.filter((item) => item.tier === "month");
    const monthLabels = monthItems.map((item) => item.label);

    const finishDate = new Date(Date.UTC(2026, 0, 1 + 90));
    const finishMonthStart = new Date(Date.UTC(finishDate.getUTCFullYear(), finishDate.getUTCMonth(), 1));
    const finishMonthItem = monthItems.find((item) =>
      item.startDate.getUTCFullYear() === finishMonthStart.getUTCFullYear()
      && item.startDate.getUTCMonth() === finishMonthStart.getUTCMonth()
      && item.startDate.getUTCDate() === 1,
    );

    expect(monthLabels.includes("T-0")).toBe(true);
    expect(finishMonthItem?.label).toBe("T-0");
  });

  it("year-quarter profile: quarter tier labels omit year", () => {
    const model = createTimescaleModel(makeInput("year-quarter"));
    const quarterLabels = model.headerTiers
      .filter((item) => item.tier === "quarter")
      .map((item) => item.label);

    expect(quarterLabels.length).toBeGreaterThan(0);
    expect(quarterLabels.every((l) => /^Q[1-4]$/.test(l))).toBe(true);
  });

  it("keeps first visible quarter label when viewport starts mid-quarter", () => {
    const model = createTimescaleModel({
      ...makeInput("year-quarter"),
      scrollLeft: 95,
      viewportWidth: 260,
    });
    const quarterLabels = model.headerTiers
      .filter((item) => item.tier === "quarter")
      .map((item) => item.label);

    expect(quarterLabels.length).toBeGreaterThan(0);
    expect(quarterLabels[0]).toBe("Q1");
  });

  it("year-month profile: month tier labels omit year", () => {
    const model = createTimescaleModel(makeInput("year-month"));
    const monthLabels = model.headerTiers
      .filter((item) => item.tier === "month")
      .map((item) => item.label);

    expect(monthLabels.length).toBeGreaterThan(0);
    expect(monthLabels.every((l) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(l))).toBe(true);
  });

  it("quarter-month profile: month tier labels omit year", () => {
    const model = createTimescaleModel(makeInput("quarter-month"));
    const monthLabels = model.headerTiers
      .filter((item) => item.tier === "month")
      .map((item) => item.label);

    expect(monthLabels.length).toBeGreaterThan(0);
    expect(monthLabels.every((l) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(l))).toBe(true);
  });

  it("month-only profile: month tier labels include year", () => {
    const model = createTimescaleModel(makeInput("month-only"));
    const monthLabels = model.headerTiers
      .filter((item) => item.tier === "month")
      .map((item) => item.label);

    expect(monthLabels.length).toBeGreaterThan(0);
    expect(monthLabels.every((l) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/.test(l))).toBe(true);
  });
});
