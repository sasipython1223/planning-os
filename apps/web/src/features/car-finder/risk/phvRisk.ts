import { PHV_FRIENDLY_MODEL_HINTS } from "../constants";
import type { CarListing, RiskFlag } from "../types";

export function phvRisk(listing: CarListing): RiskFlag[] {
  const text = `${listing.title ?? ""} ${listing.make ?? ""} ${listing.model ?? ""} ${listing.variant ?? ""} ${listing.description ?? ""} ${listing.serviceRecordText ?? ""}`.toLowerCase();
  const flags: RiskFlag[] = [];

  if (text.includes("phv") || text.includes("grab") || text.includes("gojek") || text.includes("rental")) {
    flags.push({
      code: "PHV_HISTORY_INDICATED",
      severity: "high",
      note: "Listing text suggests PHV/rental use; require documentary proof to clear.",
    });
  } else if (listing.listedClaims?.nonPhv === true) {
    flags.push({
      code: "PHV_CLAIM_REQUIRES_PROOF",
      severity: "low",
      note: "Listing/dealer claims non-PHV; verify with LTA log card and service records.",
    });
  } else {
    flags.push({
      code: "PHV_HISTORY_UNKNOWN",
      severity: "medium",
      note: "PHV/rental history is unknown from listing data; request ownership proof.",
    });
  }

  if (text.includes("company") || text.includes("fleet")) {
    flags.push({
      code: "COMPANY_USE_RISK",
      severity: "medium",
      note: "Possible company/fleet usage indicated; verify usage type and maintenance records.",
    });
  }

  if (PHV_FRIENDLY_MODEL_HINTS.some((hint) => text.includes(hint))) {
    flags.push({
      code: "PHV_FRIENDLY_MODEL",
      severity: "medium",
      note: "Model is commonly used for PHV/rental fleets; verify service and ownership documentation.",
    });
  }

  return flags;
}
