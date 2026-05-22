import type { CarListing, RiskFlag } from "../types";
import { criticalFieldRisk } from "./criticalFieldRisk";
import { dealerRisk } from "./dealerRisk";
import { financialFitRisk } from "./financialFitRisk";
import { hybridRisk } from "./hybridRisk";
import { ownershipRisk } from "./ownershipRisk";
import { phvRisk } from "./phvRisk";

export function classifyRisks(listing: CarListing): RiskFlag[] {
  const merged = [
    ...criticalFieldRisk(listing),
    ...financialFitRisk(listing),
    ...phvRisk(listing),
    ...hybridRisk(listing),
    ...ownershipRisk(listing),
    ...dealerRisk(listing),
  ];
  const seen = new Set<string>();
  return merged.filter((risk) => {
    const key = `${risk.code}:${risk.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
