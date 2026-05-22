import type { CarListing, RiskFlag } from "../types";

export function hybridRisk(listing: CarListing): RiskFlag[] {
  if (listing.fuelType !== "hybrid") return [];

  const text = `${listing.serviceRecordText ?? ""} ${listing.warrantyText ?? ""} ${listing.description ?? ""}`.toLowerCase();
  const hasBatteryProof = text.includes("battery") && (text.includes("health") || text.includes("warranty") || text.includes("replace"));

  if (hasBatteryProof) return [];

  return [{
    code: "HYBRID_BATTERY_UNVERIFIED",
    severity: "high",
    note: "Hybrid listing lacks battery health/warranty evidence; require hybrid diagnostic report before inspect recommendation.",
  }];
}
