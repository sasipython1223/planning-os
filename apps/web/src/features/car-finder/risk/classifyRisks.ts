import type { CarListing, RiskFlag } from "../types";
import { dealerRisk } from "./dealerRisk";
import { hybridRisk } from "./hybridRisk";
import { ownershipRisk } from "./ownershipRisk";
import { phvRisk } from "./phvRisk";

export function classifyRisks(listing: CarListing): RiskFlag[] {
  const merged = [...phvRisk(listing), ...hybridRisk(listing), ...ownershipRisk(listing), ...dealerRisk(listing)];
  const seen = new Set<string>();
  return merged.filter((risk) => {
    const key = `${risk.code}:${risk.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
