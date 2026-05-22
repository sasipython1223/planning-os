import type { CarListing } from "../types";
import type { ScoringConfig } from "./scoringConfig";

const RELIABLE_BRANDS = ["toyota", "honda", "hyundai", "kia", "mazda"];
const HIGHER_RISK_BRANDS = ["peugeot", "citroen", "opel", "bmw"];

export function scoreReliability(listing: CarListing, config: ScoringConfig): number {
  const c = config.reliability;
  const text = `${listing.make ?? ""} ${listing.model ?? ""}`.toLowerCase();

  let modelReliabilityRatio = 0.5;
  if (RELIABLE_BRANDS.some((b) => text.includes(b))) modelReliabilityRatio = 1;
  if (HIGHER_RISK_BRANDS.some((b) => text.includes(b))) modelReliabilityRatio = 0.25;

  const drivetrainRatio = listing.fuelType === "petrol"
    ? 1
    : listing.fuelType === "hybrid"
      ? 0.75
      : listing.fuelType === "electric"
        ? 0.55
        : 0.6;

  const maintenanceRatio = HIGHER_RISK_BRANDS.some((b) => text.includes(b)) ? 0.3 : 0.8;

  const warrantyText = `${listing.warrantyText ?? ""} ${listing.serviceRecordText ?? ""}`.toLowerCase();
  const warrantyRatio = warrantyText.includes("warranty") || warrantyText.includes("agent") || listing.listedClaims?.warrantyProvided
    ? 1
    : 0.35;

  return (
    modelReliabilityRatio * c.modelReliability
    + drivetrainRatio * c.drivetrainSimplicity
    + maintenanceRatio * c.maintenanceCost
    + warrantyRatio * c.warrantyService
  );
}
