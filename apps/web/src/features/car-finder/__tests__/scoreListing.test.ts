import { describe, expect, it } from "vitest";
import { scoreListing } from "../scoring/scoreListing";

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
