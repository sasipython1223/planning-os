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
  assumedFlatInterestRate: 0.0278,
  maxLoanTenureMonths: 84,
  defaultLoanTenureMonths: 60,
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
  "avante gls",
  "older-shape avante",
] as const;

export const RELIABLE_BRANDS = ["toyota", "honda", "hyundai", "kia", "mazda"] as const;
export const HIGHER_RISK_BRANDS = ["peugeot", "citroen", "opel", "bmw"] as const;
export const SAFETY_FEATURE_HINTS = ["airbag", "blind spot", "lane", "aeb", "adas", "collision"] as const;

export const PHV_FRIENDLY_MODEL_HINTS = [
  "altis hybrid",
  "corolla altis hybrid",
  "prius",
  "vezel hybrid",
  "hr-v hybrid",
  "sienta",
  "freed",
  "kicks e-power",
  "note e-power",
  "vios",
  "attrage",
  "avante",
  "cerato",
] as const;

export const HYBRID_HINTS = ["hybrid", "e:hev", "e-hev", "hev", "prius", "e-power"] as const;
export const DCT_HINTS = ["dct", "dual clutch", "dry clutch", "7dct", "6dct"] as const;
export const SMALL_TURBO_HINTS = ["1.0 turbo", "1.2 turbo", "t-gdi", "puretech", "ecoboost"] as const;
export const PI_HINTS = ["pi", "parallel import", "direct import", "no warranty"] as const;
