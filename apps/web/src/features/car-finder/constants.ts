export const BUYER_CONSTRAINTS = {
  preferredBudget: 90000,
  comparisonBudget: 100000,
  downpaymentComfort: 25000,
  monthlyComfort: 1300,
  preferredMaxDepreciation: 11000,
  shortCoeMonths: 36,
  depreciationUpperBound: 15000,
  depreciationScoreRange: 7000,
  veryLowMileageKm: 40000,
  veryHighMileageKm: 180000,
  familyMpvBonus: 2,
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

export const RELIABLE_BRANDS = ["toyota", "honda", "hyundai", "kia", "mazda"] as const;
export const HIGHER_RISK_BRANDS = ["peugeot", "citroen", "opel", "bmw"] as const;
export const SAFETY_FEATURE_HINTS = ["airbag", "blind spot", "lane", "aeb", "adas", "collision"] as const;
