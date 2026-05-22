import type { CarFinderAnalysis, ScoredListing } from "../types";

function money(value: number | undefined): string {
  return value == null ? "-" : `$${Math.round(value).toLocaleString()}`;
}

function score(value: number): string {
  return value.toFixed(2);
}

function riskCodes(item: ScoredListing): string {
  return item.riskFlags.map((risk) => risk.code).join(", ") || "none";
}

function row(item: ScoredListing, rank: number): string {
  return `| ${rank} | ${item.listing.title} | ${score(item.score.total)} | ${item.recommendation} | ${money(item.listing.annualDepreciation)} | ${money(item.listing.price)} | ${riskCodes(item)} |`;
}

function summaryLine(title: string, item?: ScoredListing): string {
  if (!item) return `- ${title}: N/A`;
  return `- ${title}: ${item.listing.title} (score ${score(item.score.total)}, ${item.recommendation})`;
}

function avoidSection(items: ScoredListing[]): string {
  if (items.length === 0) return "- None currently marked Skip.";
  return items
    .map((item, index) => `${index + 1}. ${item.listing.title} | score ${score(item.score.total)} | risks: ${riskCodes(item)}`)
    .join("\n");
}

export function buildTop5CarsByCopilotRankingOutput(
  analysis: Pick<CarFinderAnalysis, "top5Overall" | "bestValue" | "bestLowHeadache" | "avoid">,
): string {
  const header = "| Rank | Title | Total Score | Recommendation | Annual Depreciation | Price | Risk Flags |";
  const separator = "|---:|---|---:|---|---:|---:|---|";

  return [
    "## Top 5 cars by Copilot ranking",
    "",
    header,
    separator,
    ...analysis.top5Overall.map((item, index) => row(item, index + 1)),
    "",
    "## Best value",
    "",
    summaryLine("Best value", analysis.bestValue),
    "",
    "## Low headache",
    "",
    summaryLine("Low headache", analysis.bestLowHeadache),
    "",
    "## Avoid / Skip",
    "",
    avoidSection(analysis.avoid),
    "",
  ].join("\n");
}
