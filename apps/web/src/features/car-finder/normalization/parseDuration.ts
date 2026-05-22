import { parseNumber } from "./parseNumber";

export function parseDurationToMonths(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return undefined;

  const lower = value.toLowerCase();
  const yearsMatch = lower.match(/(\d+(?:\.\d+)?)\s*(y|yr|year)/);
  const monthsMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m|mo|month)/);

  if (yearsMatch || monthsMatch) {
    const years = yearsMatch ? Number(yearsMatch[1]) : 0;
    const months = monthsMatch ? Number(monthsMatch[1]) : 0;
    return Math.round(years * 12 + months);
  }

  return parseNumber(value);
}
