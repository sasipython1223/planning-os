import type { CarListing } from "../types";
import { getDepreciationRatio, getMonthlyAssessment, getMonthlyRatio, getPaperValueAssessment, getPriceRatio } from "./financialAssessment";
import type { ScoringConfig } from "./scoringConfig";

export function scoreFinancial(listing: CarListing, config: ScoringConfig): number {
  const c = config.financial;
  const depreciationRatio = getDepreciationRatio(listing.annualDepreciation);
  const priceRatio = getPriceRatio(listing.price);
  const monthlyAssessment = getMonthlyAssessment(listing);
  const monthlyRatio = getMonthlyRatio(monthlyAssessment.monthlyInstallment);
  const paperValue = getPaperValueAssessment(listing).value ?? 0;
  const paperRatio = listing.price && listing.price > 0
    ? Math.max(0, Math.min(1, paperValue / listing.price))
    : 0.3;

  return (
    depreciationRatio * c.depreciation
    + priceRatio * c.priceBudget
    + monthlyRatio * c.paymentFit
    + paperRatio * c.paperValue
  );
}
