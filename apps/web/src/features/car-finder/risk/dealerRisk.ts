import { BUYER_CONSTRAINTS } from "../constants";
import type { CarListing, RiskFlag } from "../types";

export function dealerRisk(listing: CarListing): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const text = `${listing.description ?? ""} ${listing.warrantyText ?? ""}`.toLowerCase();

  if (listing.isOpc) {
    flags.push({
      code: "OPC",
      severity: "medium",
      note: "OPC plate detected; does not fit normal-plate preference unless special-case accepted.",
    });
  }

  if (listing.isCoeCar) {
    flags.push({
      code: "COE_RENEWED",
      severity: "medium",
      note: "Renewed COE listing; review only if intentionally considering short-term ownership.",
    });
  }

  if ((listing.coeRemainingMonths ?? Number.POSITIVE_INFINITY) < BUYER_CONSTRAINTS.shortCoeMonths) {
    flags.push({
      code: "SHORT_COE",
      severity: "high",
      note: "Short remaining COE materially increases renewal/timeline risk.",
    });
  }

  if (!text.includes("inspection") && !text.includes("sta") && !text.includes("vicom")) {
    flags.push({
      code: "LOW_TRANSPARENCY",
      severity: "medium",
      note: "Dealer inspection readiness is unclear; require pre-purchase inspection approval.",
    });
  }

  return flags;
}
