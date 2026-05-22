import type { ScoredListing } from "../types";

const HEADER = [
  "rank",
  "title",
  "price",
  "annualDepreciation",
  "coeRemainingMonths",
  "deregValue",
  "estimatedParf",
  "scoreTotal",
  "recommendation",
  "riskFlags",
  "reason",
];

export function buildCsvRows(ranked: ScoredListing[]): string[][] {
  const rows = ranked.map((item, index) => [
    String(index + 1),
    item.listing.title,
    String(item.listing.price ?? ""),
    String(item.listing.annualDepreciation ?? ""),
    String(item.listing.coeRemainingMonths ?? ""),
    String(item.listing.deregValue ?? ""),
    String(item.listing.estimatedParf ?? ""),
    item.score.total.toFixed(2),
    item.recommendation,
    item.riskFlags.map((r) => `${r.code}:${r.severity}`).join(" | "),
    item.recommendationReason,
  ]);
  return [HEADER, ...rows];
}

export function buildCsvText(rows: string[][]): string {
  return rows
    .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
    .join("\n");
}
