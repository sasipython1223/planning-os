import { BUYER_CONSTRAINTS } from "../constants";
import type { CarListing, RiskFlag } from "../types";

export function ownershipRisk(listing: CarListing): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (listing.ownerCount != null && listing.ownerCount >= 4) {
    flags.push({
      code: "HIGH_OWNER_COUNT",
      severity: "high",
      note: "High owner count can increase hidden-history risk.",
    });
  }

  if (!listing.serviceRecordText) {
    flags.push({
      code: "NO_SERVICE_HISTORY",
      severity: "medium",
      note: "No service-record claim in listing; mileage and wear claims are unverified.",
    });
  }

  if (listing.fuelType !== "hybrid" && !listing.warrantyText && !listing.listedClaims?.warrantyProvided) {
    flags.push({
      code: "NO_WARRANTY",
      severity: "medium",
      note: "No warranty coverage stated by dealer.",
    });
  }

  if (
    listing.mileageKm != null
    && !listing.serviceRecordText
    && (listing.mileageKm < BUYER_CONSTRAINTS.veryLowMileageKm || listing.mileageKm > BUYER_CONSTRAINTS.veryHighMileageKm)
  ) {
    flags.push({
      code: "MILEAGE_UNVERIFIED",
      severity: "medium",
      note: "Mileage is treated as secondary only; verify against service records and inspection.",
    });
  }

  return flags;
}
