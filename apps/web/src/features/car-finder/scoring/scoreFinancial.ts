import type { CarListing } from "../types";
import type { ScoringConfig } from "./scoringConfig";

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

export function scoreFinancial(listing: CarListing, config: ScoringConfig): number {
  const c = config.financial;
  const budget = config.buyer.preferredBudget;
  const comparisonBudget = config.buyer.comparisonBudget;

  const depreciationRatio = listing.annualDepreciation != null
    ? clamp((15000 - listing.annualDepreciation) / 7000)
    : 0.4;

  const priceRatio = listing.price == null
    ? 0.3
    : listing.price <= budget
      ? 1
      : listing.price <= comparisonBudget
        ? 0.5
        : 0;

  const monthlyEstimate = listing.advertisedMonthlyInstallment
    ?? (listing.price != null ? (Math.max(0, listing.price - config.buyer.downpaymentComfort) / 60) : undefined);
  const monthlyRatio = monthlyEstimate == null
    ? 0.4
    : clamp((config.buyer.monthlyComfort * 1.5 - monthlyEstimate) / (config.buyer.monthlyComfort * 1.2));

  const paperValue = (listing.deregValue ?? 0) + (listing.estimatedParf ?? 0);
  const paperRatio = listing.price && listing.price > 0
    ? clamp(paperValue / listing.price)
    : 0.3;

  return (
    depreciationRatio * c.depreciation
    + priceRatio * c.priceBudget
    + monthlyRatio * c.paymentFit
    + paperRatio * c.paperValue
  );
}
