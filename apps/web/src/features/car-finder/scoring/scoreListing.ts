import { classifyRisks } from "../risk/classifyRisks";
import type { DataQuality, Recommendation, ScoredListing } from "../types";
import type { CarListing } from "../types";
import { scoreFinancial } from "./scoreFinancial";
import { scoreHistoryRisk } from "./scoreHistoryRisk";
import { scorePracticality } from "./scorePracticality";
import { scoreReliability } from "./scoreReliability";
import { SCORING_CONFIG, type ScoringConfig } from "./scoringConfig";

function recommendationReason(listing: CarListing, recommendation: Recommendation): string {
  const dep = listing.annualDepreciation != null ? `Dep ${Math.round(listing.annualDepreciation)}/yr` : "Dep unknown";
  const price = listing.price != null ? `Price ${Math.round(listing.price)}` : "Price unknown";

  if (recommendation === "Inspect") {
    return `${dep}, ${price}, and risk profile is acceptable pending records and inspection.`;
  }
  if (recommendation === "Watch") {
    return `${dep}, ${price}, but key verification items remain before inspection.`;
  }
  return `${dep}, ${price}, and risk/fit concerns currently outweigh paper value.`;
}

function recommend(total: number, highRiskCount: number, missingCritical: number, config: ScoringConfig): Recommendation {
  if (missingCritical >= 2 || highRiskCount >= 3) return "Skip";
  if (total >= config.thresholds.inspect && highRiskCount === 0) return "Inspect";
  if (total >= config.thresholds.watch) return "Watch";
  return "Skip";
}

export function scoreListing(
  listing: CarListing,
  dataQuality: DataQuality,
  warnings: string[] = [],
  config: ScoringConfig = SCORING_CONFIG,
): ScoredListing {
  const financial = scoreFinancial(listing, config);
  const reliability = scoreReliability(listing, config);
  const historyRisk = scoreHistoryRisk(listing, config);
  const practicality = scorePracticality(listing, config);
  const total = financial + reliability + historyRisk + practicality;

  const riskFlags = classifyRisks(listing);
  const highRiskCount = riskFlags.filter((r) => r.severity === "high").length;

  const recommendation = recommend(total, highRiskCount, dataQuality.missing.length, config);

  return {
    listing,
    score: { financial, reliability, historyRisk, practicality, total },
    recommendation,
    recommendationReason: recommendationReason(listing, recommendation),
    riskFlags,
    dataQuality,
    warnings,
  };
}
