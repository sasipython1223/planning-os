import { BUYER_CONSTRAINTS } from "../constants";
import { getMonthlyAssessment } from "../scoring/financialAssessment";
import type { CarListing, RiskFlag } from "../types";

export function financialFitRisk(listing: CarListing): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if ((listing.price ?? Number.POSITIVE_INFINITY) > BUYER_CONSTRAINTS.preferredBudget) {
    flags.push({
      code: "PRICE_ABOVE_TARGET",
      severity: listing.price != null && listing.price <= BUYER_CONSTRAINTS.comparisonBudget ? "low" : "medium",
      note: `Price exceeds preferred SGD ${BUYER_CONSTRAINTS.preferredBudget.toLocaleString()} budget target.`,
    });
  }

  const monthlyAssessment = getMonthlyAssessment(listing);
  if ((monthlyAssessment.monthlyInstallment ?? 0) > BUYER_CONSTRAINTS.monthlyComfort) {
    const estimateLabel = monthlyAssessment.source === "estimated" ? " (rough estimate, indicative only)" : "";
    flags.push({
      code: "MONTHLY_ABOVE_TARGET",
      severity: "medium",
      note: `Monthly installment exceeds comfort target of SGD ${BUYER_CONSTRAINTS.monthlyComfort.toLocaleString()}${estimateLabel}.`,
    });
  }

  return flags;
}
