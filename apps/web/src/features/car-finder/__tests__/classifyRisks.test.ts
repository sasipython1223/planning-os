import { describe, expect, it } from "vitest";
import { classifyRisks } from "../risk/classifyRisks";

describe("classifyRisks", () => {
  it("flags hybrid battery, PHV-friendly model, and service-history gaps", () => {
    const risks = classifyRisks({
      title: "Toyota Corolla Altis Hybrid Elegance",
      fuelType: "hybrid",
      mileageKm: 35000,
      description: "well kept",
    });

    expect(risks.some((r) => r.code === "HYBRID_BATTERY_UNVERIFIED")).toBe(true);
    expect(risks.some((r) => r.code === "PHV_FRIENDLY_MODEL")).toBe(true);
    expect(risks.some((r) => r.code === "NO_SERVICE_HISTORY")).toBe(true);
  });

  it("flags PHV indicated hints and OPC/COE constraints", () => {
    const risks = classifyRisks({
      title: "Hyundai Avante",
      description: "previous PHV rental unit",
      isOpc: true,
      isCoeCar: true,
      coeRemainingMonths: 20,
      fuelType: "petrol",
    });

    expect(risks.some((r) => r.code === "PHV_HISTORY_INDICATED" && r.severity === "high")).toBe(true);
    expect(risks.some((r) => r.code === "OPC")).toBe(true);
    expect(risks.some((r) => r.code === "SHORT_COE")).toBe(true);
  });

  it("keeps non-PHV claims as proof-required instead of clearing risk", () => {
    const risks = classifyRisks({
      title: "Toyota Corolla Altis",
      listedClaims: { nonPhv: true },
      fuelType: "petrol",
    });

    expect(risks.some((r) => r.code === "PHV_CLAIM_REQUIRES_PROOF")).toBe(true);
  });
});
