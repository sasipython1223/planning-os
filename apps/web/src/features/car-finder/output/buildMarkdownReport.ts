import type { CarFinderAnalysis, ScoredListing } from "../types";

function fmt(value: number | undefined): string {
  return value == null ? "-" : `$${Math.round(value).toLocaleString()}`;
}

function coeText(item: ScoredListing): string {
  if (item.listing.coeRemainingText) return item.listing.coeRemainingText;
  if (item.listing.coeRemainingMonths == null) return "-";
  const years = Math.floor(item.listing.coeRemainingMonths / 12);
  const months = item.listing.coeRemainingMonths % 12;
  return `${years}y ${months}m`;
}

function notes(item: ScoredListing): string {
  const monthly = item.monthlyAssessment.monthlyInstallment == null
    ? "Monthly -"
    : `Monthly $${Math.round(item.monthlyAssessment.monthlyInstallment).toLocaleString()}${item.monthlyAssessment.indicativeOnly ? " (indicative)" : ""}`;
  const paper = item.paperValueAssessment.value == null
    ? "Paper unknown"
    : `Paper ${fmt(item.paperValueAssessment.value)} (${item.paperValueAssessment.source}${item.paperValueAssessment.indicativeOnly ? ", indicative" : ""})`;
  return `${paper}; ${monthly}; risks: ${item.riskFlags.map((r) => r.code).join(", ") || "none"}`;
}

function row(item: ScoredListing, rank: number): string {
  return `| ${rank} | ${item.listing.title} | ${fmt(item.listing.price)} | ${fmt(item.listing.annualDepreciation)} | ${coeText(item)} | ${notes(item)} | ${item.recommendation} | ${item.recommendationReason} |`;
}

function section(title: string, listings: ScoredListing[]): string {
  if (listings.length === 0) return `### ${title}\n\nNo listings.\n`;
  return `### ${title}\n\n${listings.map((item, i) => `- ${i + 1}. ${item.listing.title} (${item.recommendation})`).join("\n")}\n`;
}

export function buildMarkdownReport(analysis: Omit<CarFinderAnalysis, "markdownReport">): string {
  const header = "| Rank | Model | Price | Depreciation | COE Remaining | Dereg/PARF Notes | Final Recommendation | Reason |";
  const sep = "|---|---|---:|---:|---|---|---|---|";

  const avoidLines = analysis.avoid.length === 0
    ? "- None currently marked as Skip."
    : analysis.avoid.map((item) => `- ${item.listing.title}: ${item.riskFlags.map((r) => r.note).join("; ") || item.recommendationReason}`).join("\n");

  return [
    "## Ranked Shortlist",
    "",
    header,
    sep,
    ...analysis.ranked.map((item, index) => row(item, index + 1)),
    "",
    section("Top 5 overall", analysis.top5Overall),
    section("Top 5 under SGD 90k", analysis.top5Under90k),
    `### Best low-headache choice\n\n- ${analysis.bestLowHeadache?.listing.title ?? "N/A"}`,
    `### Best value choice\n\n- ${analysis.bestValue?.listing.title ?? "N/A"}`,
    `### Best family/Johor Bahru choice\n\n- ${analysis.bestFamilyJb?.listing.title ?? "N/A"}`,
    "### Listings to avoid and why",
    "",
    avoidLines,
    "",
    "### Dealer questions to ask",
    "",
    ...analysis.dealerQuestions.map((q) => `- ${q}`),
    "",
    "### Inspection checklist for shortlisted cars",
    "",
    ...analysis.inspectionChecklist.map((item) => `- ${item}`),
    "",
    "### WA message template for dealer follow-up",
    "",
    analysis.waMessageTemplate,
  ].join("\n");
}
