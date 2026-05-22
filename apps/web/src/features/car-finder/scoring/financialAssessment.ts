import { BUYER_CONSTRAINTS } from "../constants";
import type { CarListing } from "../types";

export type DepreciationBand = {
  maxInclusive: number;
  ratio: number;
};

export const DEPRECIATION_BANDS: DepreciationBand[] = [
  { maxInclusive: 14000, ratio: 1 },
  { maxInclusive: 16000, ratio: 0.8 },
  { maxInclusive: 17500, ratio: 0.6 },
  { maxInclusive: 18500, ratio: 0.35 },
  { maxInclusive: Number.POSITIVE_INFINITY, ratio: 0.1 },
];

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

export function getDepreciationRatio(annualDepreciation: number | undefined): number {
  if (annualDepreciation == null) return 0.4;
  return DEPRECIATION_BANDS.find((band) => annualDepreciation <= band.maxInclusive)?.ratio ?? 0.1;
}

export function getPaperValueAssessment(listing: CarListing): {
  value: number | undefined;
  source: "dereg" | "estimated_coe_plus_parf" | "unknown";
  indicativeOnly: boolean;
} {
  if (listing.deregValue != null) {
    return { value: listing.deregValue, source: "dereg", indicativeOnly: false };
  }

  const estimated = (listing.coeValue ?? 0) + (listing.estimatedParf ?? 0);
  if (estimated > 0) {
    return { value: estimated, source: "estimated_coe_plus_parf", indicativeOnly: true };
  }

  return { value: undefined, source: "unknown", indicativeOnly: true };
}

export function getMonthlyAssessment(listing: CarListing): {
  monthlyInstallment: number | undefined;
  source: "advertised" | "estimated" | "none";
  indicativeOnly: boolean;
  tenureMonths: number | undefined;
} {
  if (listing.advertisedMonthlyInstallment != null) {
    return {
      monthlyInstallment: listing.advertisedMonthlyInstallment,
      source: "advertised",
      indicativeOnly: false,
      tenureMonths: undefined,
    };
  }

  if (listing.price == null) {
    return {
      monthlyInstallment: undefined,
      source: "none",
      indicativeOnly: true,
      tenureMonths: undefined,
    };
  }

  const rawTenure = Math.min(
    BUYER_CONSTRAINTS.defaultLoanTenureMonths,
    BUYER_CONSTRAINTS.maxLoanTenureMonths,
    listing.coeRemainingMonths ?? BUYER_CONSTRAINTS.defaultLoanTenureMonths,
  );
  const tenureMonths = Math.max(12, rawTenure);
  const financed = Math.max(0, listing.price - BUYER_CONSTRAINTS.downpaymentComfort);
  const years = tenureMonths / 12;
  const totalRepayment = financed * (1 + BUYER_CONSTRAINTS.assumedFlatInterestRate * years);

  return {
    monthlyInstallment: totalRepayment / tenureMonths,
    source: "estimated",
    indicativeOnly: true,
    tenureMonths,
  };
}

export function getPriceRatio(price: number | undefined): number {
  if (price == null) return 0.3;
  if (price <= BUYER_CONSTRAINTS.preferredBudget) return 1;
  if (price <= BUYER_CONSTRAINTS.comparisonBudget) return 0.5;
  return 0;
}

export function getMonthlyRatio(monthlyInstallment: number | undefined): number {
  if (monthlyInstallment == null) return 0.4;
  return clamp(
    (BUYER_CONSTRAINTS.monthlyComfort * 1.5 - monthlyInstallment) / (BUYER_CONSTRAINTS.monthlyComfort * 1.2),
  );
}
