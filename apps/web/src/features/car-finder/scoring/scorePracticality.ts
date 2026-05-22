import { PREFERRED_MODEL_HINTS, SAFETY_FEATURE_HINTS } from "../constants";
import type { CarListing } from "../types";
import type { ScoringConfig } from "./scoringConfig";

export function scorePracticality(listing: CarListing, config: ScoringConfig): number {
  const c = config.practicality;
  const text = `${listing.make ?? ""} ${listing.model ?? ""} ${listing.variant ?? ""} ${listing.featureText ?? ""}`.toLowerCase();

  const officialUseRatio = listing.isOpc ? 0.1 : 0.85;

  const familyRatio = text.includes("sienta") || text.includes("freed") || text.includes("mpv")
    ? 1
    : text.includes("mazda 3")
      ? 0.6
      : 0.75;

  const safetyRatio = SAFETY_FEATURE_HINTS.some((k) => text.includes(k)) ? 1 : 0.45;

  const fuelEconomyRatio = listing.fuelType === "hybrid"
    ? 1
    : listing.fuelType === "petrol"
      ? 0.7
      : 0.5;

  const liquidityRatio = PREFERRED_MODEL_HINTS.some((k) => text.includes(k)) ? 1 : 0.6;

  return (
    officialUseRatio * c.officialUse
    + familyRatio * c.familyComfort
    + safetyRatio * c.safetyFeatures
    + fuelEconomyRatio * c.fuelEconomy
    + liquidityRatio * c.resaleLiquidity
  );
}
