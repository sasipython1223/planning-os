import { BUYER_CONSTRAINTS } from "./constants";
import { normalizeListings } from "./normalization/normalizeListing";
import { buildCsvRows, buildCsvText } from "./output/buildCsvRows";
import { buildDealerQuestions } from "./output/buildDealerQuestions";
import { buildInspectionChecklist } from "./output/buildInspectionChecklist";
import { buildMarkdownReport } from "./output/buildMarkdownReport";
import { scoreListing } from "./scoring/scoreListing";
import type { CarFinderAnalysis, CarListing, ScoredListing } from "./types";

function pickBest(listings: ScoredListing[], selector: (item: ScoredListing) => number): ScoredListing | undefined {
  return listings.reduce<ScoredListing | undefined>((best, current) => {
    if (!best) return current;
    return selector(current) > selector(best) ? current : best;
  }, undefined);
}

function buildWaTemplate(shortlisted: ScoredListing[]): string {
  const names = shortlisted.slice(0, 3).map((s) => s.listing.title).join(", ") || "your listing";
  return `Hi, I’m shortlisting used cars (${names}). Could you share full service invoices, PHV/rental/company-use proof, accident/repair history, warranty terms, and confirm independent inspection is allowed before I arrange viewing?`;
}

export function analyzeCarFinderListings(rows: Array<CarListing | Record<string, unknown>>): CarFinderAnalysis {
  const normalized = normalizeListings(rows);
  const scored = normalized
    .map((item) => scoreListing(item.listing, item.dataQuality, item.warnings))
    .sort((a, b) => b.score.total - a.score.total);

  const top5Overall = scored.slice(0, 5);
  const top5Under90k = scored.filter((s) => (s.listing.price ?? Number.POSITIVE_INFINITY) <= 90000).slice(0, 5);
  const bestLowHeadache = pickBest(scored, (s) => s.score.reliability + s.score.historyRisk);
  const bestValue = pickBest(scored, (s) => s.score.financial);
  const bestFamilyJb = pickBest(
    scored,
    (s) => s.score.practicality + (s.listing.vehicleType?.toLowerCase().includes("mpv") ? BUYER_CONSTRAINTS.familyMpvBonus : 0),
  );
  const avoid = scored.filter((s) => s.recommendation === "Skip");

  const dealerQuestions = buildDealerQuestions();
  const inspectionChecklist = buildInspectionChecklist();
  const csvRows = buildCsvRows(scored);
  const csvText = buildCsvText(csvRows);

  const analysisWithoutMarkdown: Omit<CarFinderAnalysis, "markdownReport"> = {
    ranked: scored,
    top5Overall,
    top5Under90k,
    bestLowHeadache,
    bestValue,
    bestFamilyJb,
    avoid,
    csvRows,
    csvText,
    dealerQuestions,
    inspectionChecklist,
    waMessageTemplate: buildWaTemplate(top5Overall),
  };

  return {
    ...analysisWithoutMarkdown,
    markdownReport: buildMarkdownReport(analysisWithoutMarkdown),
  };
}

export * from "./types";
