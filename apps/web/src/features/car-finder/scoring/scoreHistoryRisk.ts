import type { CarListing } from "../types";
import type { ScoringConfig } from "./scoringConfig";

export function scoreHistoryRisk(listing: CarListing, config: ScoringConfig): number {
  const c = config.historyRisk;
  const text = `${listing.description ?? ""} ${listing.warrantyText ?? ""} ${listing.serviceRecordText ?? ""}`.toLowerCase();

  const ownerRatio = listing.ownerCount == null
    ? 0.4
    : listing.ownerCount <= 1
      ? 1
      : listing.ownerCount <= 2
        ? 0.75
        : listing.ownerCount <= 3
          ? 0.4
          : 0.15;

  const phvRatio = listing.listedClaims?.nonPhv === true
    ? 1
    : (text.includes("phv") || text.includes("rental") || text.includes("company use"))
      ? 0.2
      : 0.5;

  const serviceRatio = listing.serviceRecordText && listing.serviceRecordText.length > 4 ? 1 : 0.3;

  const transparencyRatio = text.includes("inspection") || text.includes("sta") || text.includes("vicom")
    ? 1
    : listing.dealerName
      ? 0.6
      : 0.2;

  return (
    ownerRatio * c.ownerCount
    + phvRatio * c.phvRentalCompanyRisk
    + serviceRatio * c.serviceRecords
    + transparencyRatio * c.dealerTransparency
  );
}
