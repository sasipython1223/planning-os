import type { CarListing, RiskFlag } from "../types";

export function hybridRisk(listing: CarListing): RiskFlag[] {
  if (listing.fuelType !== "hybrid") return [];

  const text = `${listing.serviceRecordText ?? ""} ${listing.warrantyText ?? ""} ${listing.description ?? ""}`.toLowerCase();
  const hasBatteryProof = text.includes("battery") && (text.includes("health") || text.includes("warranty") || text.includes("replace"));
  const hasWarranty = Boolean(listing.warrantyText || listing.listedClaims?.warrantyProvided);
  const flags: RiskFlag[] = [];

  if (!hasBatteryProof) {
    flags.push({
      code: "HYBRID_BATTERY_UNVERIFIED",
      severity: "high",
      note: "Hybrid listing lacks battery health/warranty evidence; require hybrid diagnostic report before inspect recommendation.",
    });
  }

  if (!hasWarranty) {
    flags.push({
      code: "NO_WARRANTY_HYBRID",
      severity: "high",
      note: "Hybrid listing has no clear warranty support; include battery and hybrid-system coverage checks.",
    });
  }

  return flags;
}
