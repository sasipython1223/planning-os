import { describe, expect, it } from "vitest";
import { classifyRisks } from "../risk/classifyRisks";

describe("classifyRisks", () => {
  it("flags hybrid battery and service-history gaps", () => {
    const risks = classifyRisks({
      title: "Honda Vezel Hybrid",
      fuelType: "hybrid",
      mileageKm: 35000,
      description: "well kept",
    });

    expect(risks.some((r) => r.code === "HYBRID_BATTERY_UNVERIFIED")).toBe(true);
    expect(risks.some((r) => r.code === "NO_SERVICE_HISTORY")).toBe(true);
  });

  it("flags PHV hints and OPC/COE constraints", () => {
    const risks = classifyRisks({
      title: "Hyundai Avante",
      description: "previous PHV rental unit",
      isOpc: true,
      isCoeCar: true,
      coeRemainingMonths: 20,
      fuelType: "petrol",
    });

    expect(risks.some((r) => r.code === "PHV_RISK" && r.severity === "high")).toBe(true);
    expect(risks.some((r) => r.code === "OPC")).toBe(true);
    expect(risks.some((r) => r.code === "SHORT_COE")).toBe(true);
  });
});
