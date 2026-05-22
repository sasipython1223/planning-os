import { describe, expect, it } from "vitest";
import { scoreFinancial } from "../scoring/scoreFinancial";
import { SCORING_CONFIG } from "../scoring/scoringConfig";

describe("scoreFinancial calibration", () => {
  it("treats 14.9k depreciation as strong, 16.5k as acceptable, and >18.5k as penalized", () => {
    const strong = scoreFinancial({ title: "A", price: 88000, annualDepreciation: 14910 }, SCORING_CONFIG);
    const acceptable = scoreFinancial({ title: "B", price: 88000, annualDepreciation: 16500 }, SCORING_CONFIG);
    const poor = scoreFinancial({ title: "C", price: 88000, annualDepreciation: 19000 }, SCORING_CONFIG);

    expect(strong).toBeGreaterThan(acceptable);
    expect(acceptable).toBeGreaterThan(poor);
  });
});
