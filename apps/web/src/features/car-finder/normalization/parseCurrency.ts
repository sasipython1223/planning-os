import { parseNumber } from "./parseNumber";

export function parseCurrency(value: unknown): number | undefined {
  return parseNumber(value);
}
