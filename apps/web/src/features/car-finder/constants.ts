export const BUYER_CONSTRAINTS = {
  preferredBudget: 90000,
  comparisonBudget: 100000,
  downpaymentComfort: 25000,
  monthlyComfort: 1300,
  preferredMaxDepreciation: 11000,
  shortCoeMonths: 36,
} as const;

export const PREFERRED_MODEL_HINTS = [
  "corolla altis",
  "avante",
  "cerato",
  "civic 1.6",
  "mazda 3",
  "sienta",
  "freed",
] as const;

export const DEPRIORITISED_MODEL_HINTS = [
  "peugeot",
  "citroen",
  "opel",
  "bmw",
  "raize",
  "vios",
  "yaris",
] as const;
