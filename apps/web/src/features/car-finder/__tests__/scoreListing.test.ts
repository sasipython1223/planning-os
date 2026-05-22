import { describe, expect, it } from "vitest";
import { normalizeListing } from "../normalization/normalizeListing";
import { scoreListing } from "../scoring/scoreListing";
import { getPaperValueAssessment } from "../scoring/financialAssessment";

const baseDataQuality = {
  reported: ["title"],
  derived: [],
  missing: [],
  requiresDealerConfirmation: [],
  requiresInspection: [],
};

describe("scoreListing", () => {
  it("does not use mileage as a primary score dimension", () => {
    const lowMileage = scoreListing({
      title: "Toyota Corolla Altis",
      make: "Toyota",
      model: "Corolla Altis",
      price: 85000,
      annualDepreciation: 9800,
      mileageKm: 40000,
      fuelType: "petrol",
      serviceRecordText: "full agent service",
      warrantyText: "6 months warranty",
      coeRemainingMonths: 72,
      registrationDate: "2021-01",
      listedClaims: { nonPhv: true },
    }, baseDataQuality);

    const highMileage = scoreListing({
      title: "Toyota Corolla Altis",
      make: "Toyota",
      model: "Corolla Altis",
      price: 85000,
      annualDepreciation: 9800,
      mileageKm: 160000,
      fuelType: "petrol",
      serviceRecordText: "full agent service",
      warrantyText: "6 months warranty",
      coeRemainingMonths: 72,
      registrationDate: "2021-01",
      listedClaims: { nonPhv: true },
    }, baseDataQuality);

    expect(lowMileage.score.total).toBe(highMileage.score.total);
  });

  it("keeps Altis Hybrid 14,910 depreciation competitive and not skip by default", () => {
    const normalized = normalizeListing({
      title: "Toyota Corolla Altis Hybrid Elegance",
      price: 87800,
      annualDepreciation: 14910,
      coeRemainingMonths: 64,
      ownerCount: 2,
      registrationDate: "2020-08",
    });

    const scored = scoreListing(normalized.listing, normalized.dataQuality, normalized.warnings);
    expect(scored.listing.fuelType).toBe("hybrid");
    expect(scored.score.financial).toBeGreaterThan(18);
    expect(scored.riskFlags.some((r) => r.code === "HYBRID_BATTERY_UNVERIFIED")).toBe(true);
    expect(scored.riskFlags.some((r) => r.code === "PHV_FRIENDLY_MODEL")).toBe(true);
    expect(["Inspect", "Watch"]).toContain(scored.recommendation);
  });

  it("uses dereg value as primary paper value without double-counting PARF", () => {
    const listing = {
      title: "Paper value check",
      price: 90000,
      annualDepreciation: 15000,
      deregValue: 30000,
      estimatedParf: 25000,
      coeValue: 20000,
    };

    const paper = getPaperValueAssessment(listing);
    expect(paper.source).toBe("dereg");
    expect(paper.value).toBe(30000);
  });

  it("adds explicit missing-field risk flags and downgrades confidence", () => {
    const normalized = normalizeListing({ title: "Sparse listing" });
    const scored = scoreListing(normalized.listing, normalized.dataQuality, normalized.warnings);

    expect(scored.riskFlags.some((r) => r.code === "MISSING_PRICE")).toBe(true);
    expect(scored.riskFlags.some((r) => r.code === "MISSING_DEPRECIATION")).toBe(true);
    expect(scored.riskFlags.some((r) => r.code === "MISSING_REG_DATE")).toBe(true);
    expect(scored.recommendation).toBe("Skip");
  });

  it("downgrades recommendation for high-risk listing", () => {
    const safe = scoreListing({
      title: "Kia Cerato EX",
      make: "Kia",
      model: "Cerato",
      price: 82000,
      annualDepreciation: 9400,
      fuelType: "petrol",
      registrationDate: "2020-05",
      coeRemainingMonths: 65,
      ownerCount: 1,
      serviceRecordText: "agent maintained and inspection welcome",
      warrantyText: "12 months warranty",
      listedClaims: { nonPhv: true },
    }, baseDataQuality);

    const risky = scoreListing({
      title: "Old COE Hybrid",
      make: "Honda",
      model: "Shuttle",
      price: 70000,
      annualDepreciation: 9000,
      fuelType: "hybrid",
      registrationDate: "2014-03",
      coeRemainingMonths: 18,
      ownerCount: 5,
      isCoeCar: true,
      isOpc: true,
      description: "rental use",
    }, {
      ...baseDataQuality,
      missing: ["serviceRecordText", "deregValue"],
    });

    expect(safe.recommendation).toBe("Inspect");
    expect(risky.recommendation).toBe("Skip");
  });
});
