import { describe, expect, it } from "vitest";
import { normalizeListing } from "../normalization/normalizeListing";

describe("normalizeListing", () => {
  it("normalizes mixed currency/duration fields and derives defaults", () => {
    const result = normalizeListing({
      make: "Toyota",
      model: "Corolla Altis",
      price: "S$89,800",
      depreciation: "10,900",
      coeRemaining: "6y 3m",
      isOpc: "false",
      unknownCol: "keep",
    });

    expect(result.listing.title).toBe("Toyota Corolla Altis");
    expect(result.listing.price).toBe(89800);
    expect(result.listing.annualDepreciation).toBe(10900);
    expect(result.listing.coeRemainingMonths).toBe(75);
    expect(result.warnings.some((w) => w.includes("unknownCol"))).toBe(true);
    expect(result.dataQuality.derived).toContain("title");
  });

  it("marks critical missing fields in warnings", () => {
    const result = normalizeListing({ title: "Minimal row" });
    expect(result.warnings.join(" ")).toContain("Critical fields missing");
    expect(result.dataQuality.missing).toContain("price");
  });
});
