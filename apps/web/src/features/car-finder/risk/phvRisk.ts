import type { CarListing, RiskFlag } from "../types";

export function phvRisk(listing: CarListing): RiskFlag[] {
  const text = `${listing.description ?? ""} ${listing.serviceRecordText ?? ""}`.toLowerCase();
  const flags: RiskFlag[] = [];

  if (listing.listedClaims?.nonPhv === true) return flags;

  if (text.includes("phv") || text.includes("grab") || text.includes("gojek") || text.includes("rental")) {
    flags.push({
      code: "PHV_RISK",
      severity: "high",
      note: "Listing text suggests PHV/rental use; require documentary proof to clear.",
    });
  } else {
    flags.push({
      code: "PHV_RISK",
      severity: "medium",
      note: "PHV/rental history unverified from listing; ask for ownership-history proof.",
    });
  }

  if (text.includes("company") || text.includes("fleet")) {
    flags.push({
      code: "COMPANY_USE_RISK",
      severity: "medium",
      note: "Possible company/fleet usage indicated; verify usage type and maintenance records.",
    });
  }

  return flags;
}
