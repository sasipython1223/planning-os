import type { CarListing, RiskFlag } from "../types";

export function criticalFieldRisk(listing: CarListing): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (listing.price == null) {
    flags.push({
      code: "MISSING_PRICE",
      severity: "high",
      note: "Price is missing; confidence is reduced until seller provides actual ask price.",
    });
  }

  if (listing.annualDepreciation == null) {
    flags.push({
      code: "MISSING_DEPRECIATION",
      severity: "high",
      note: "Annual depreciation is missing; cannot rank financial quality reliably.",
    });
  }

  if (!listing.registrationDate || listing.coeRemainingMonths == null) {
    flags.push({
      code: "MISSING_REG_DATE",
      severity: "high",
      note: "Registration date and/or COE remaining is missing; age/tenure checks are incomplete.",
    });
  }

  if (listing.deregValue == null && (listing.coeValue == null || listing.estimatedParf == null)) {
    flags.push({
      code: "MISSING_DEREG_VALUE",
      severity: "medium",
      note: "Dereg/paper-value data is incomplete; paper-value scoring has lower confidence.",
    });
  }

  return flags;
}
