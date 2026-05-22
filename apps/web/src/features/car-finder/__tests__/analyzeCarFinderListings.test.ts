import { describe, expect, it } from "vitest";
import { analyzeCarFinderListings } from "../index";

describe("analyzeCarFinderListings", () => {
  it("builds ranked output, markdown, and csv exports", () => {
    const analysis = analyzeCarFinderListings([
      {
        title: "Toyota Corolla Altis",
        make: "Toyota",
        model: "Corolla Altis",
        price: "89800",
        annualDepreciation: "10300",
        coeRemaining: "6y 2m",
        registrationDate: "2020-03",
        serviceRecordText: "agent maintained inspection welcome",
        warrantyText: "6 months warranty",
        listedClaims: { nonPhv: true },
        fuelType: "petrol",
      },
      {
        title: "Older Rental Unit",
        make: "Honda",
        model: "Shuttle",
        price: 70000,
        annualDepreciation: 9200,
        coeRemainingMonths: 18,
        registrationDate: "2015-01",
        description: "ex rental phv",
        ownerCount: 5,
        isCoeCar: true,
        fuelType: "hybrid",
      },
    ]);

    expect(analysis.ranked).toHaveLength(2);
    expect(analysis.top5Overall).toHaveLength(2);
    expect(analysis.csvRows[0]).toEqual(expect.arrayContaining(["rank", "title", "scoreTotal", "recommendation"]));
    expect(analysis.markdownReport).toContain("## Ranked Shortlist");
    expect(analysis.markdownReport).toContain("Top 5 under SGD 90k");
    expect(analysis.waMessageTemplate.toLowerCase()).toContain("service invoices");
    expect(analysis.avoid.length).toBeGreaterThanOrEqual(1);
  });
});
