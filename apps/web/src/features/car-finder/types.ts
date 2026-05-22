export type FuelType = "petrol" | "hybrid" | "electric" | "diesel" | "unknown";

export type CarListing = {
  id?: string;
  sourceUrl?: string;

  make?: string;
  model?: string;
  variant?: string;
  title: string;

  price?: number;
  advertisedMonthlyInstallment?: number;
  annualDepreciation?: number;

  registrationDate?: string;
  coeRemainingMonths?: number;
  coeRemainingText?: string;

  deregValue?: number;
  coeValue?: number;
  omv?: number;
  arf?: number;
  estimatedParf?: number;

  mileageKm?: number;
  ownerCount?: number;

  vehicleType?: string;
  normalPlate?: boolean;
  isOpc?: boolean;
  isCoeCar?: boolean;
  isParfCar?: boolean;

  dealerName?: string;

  warrantyText?: string;
  serviceRecordText?: string;
  description?: string;
  featureText?: string;

  fuelType?: FuelType;
  transmission?: string;

  listedClaims?: {
    accidentFree?: boolean;
    nonPhv?: boolean;
    agentMaintained?: boolean;
    oneOwner?: boolean;
    warrantyProvided?: boolean;
  };

  raw?: Record<string, unknown>;
};

export type DataQuality = {
  reported: string[];
  derived: string[];
  missing: string[];
  requiresDealerConfirmation: string[];
  requiresInspection: string[];
};

export type NormalizedListing = {
  listing: CarListing;
  warnings: string[];
  dataQuality: DataQuality;
};

export type RiskSeverity = "low" | "medium" | "high";

export type RiskFlag = {
  code:
    | "PHV_RISK"
    | "PHV_HISTORY_UNKNOWN"
    | "PHV_CLAIM_REQUIRES_PROOF"
    | "PHV_HISTORY_INDICATED"
    | "PHV_FRIENDLY_MODEL"
    | "COMPANY_USE_RISK"
    | "NO_WARRANTY"
    | "NO_WARRANTY_HYBRID"
    | "NO_SERVICE_HISTORY"
    | "HIGH_OWNER_COUNT"
    | "HYBRID_BATTERY_UNVERIFIED"
    | "OPC"
    | "COE_RENEWED"
    | "MILEAGE_UNVERIFIED"
    | "SHORT_COE"
    | "LOW_TRANSPARENCY"
    | "MISSING_PRICE"
    | "MISSING_DEPRECIATION"
    | "MISSING_REG_DATE"
    | "MISSING_DEREG_VALUE"
    | "DCT_GEARBOX_RISK"
    | "TURBO_SMALL_ENGINE_RISK"
    | "DIRECT_IMPORT_OR_PI_RISK"
    | "PRICE_ABOVE_TARGET"
    | "MONTHLY_ABOVE_TARGET"
    | "BUYER_DEPRIORITISED_MODEL";
  severity: RiskSeverity;
  note: string;
};

export type ScoreBreakdown = {
  financial: number;
  reliability: number;
  historyRisk: number;
  practicality: number;
  total: number;
};

export type Recommendation = "Inspect" | "Watch" | "Skip";

export type ScoredListing = {
  listing: CarListing;
  score: ScoreBreakdown;
  recommendation: Recommendation;
  recommendationReason: string;
  riskFlags: RiskFlag[];
  monthlyAssessment: {
    monthlyInstallment: number | undefined;
    source: "advertised" | "estimated" | "none";
    indicativeOnly: boolean;
    tenureMonths: number | undefined;
  };
  paperValueAssessment: {
    value: number | undefined;
    source: "dereg" | "estimated_coe_plus_parf" | "unknown";
    indicativeOnly: boolean;
  };
  dataQuality: DataQuality;
  warnings: string[];
};

export type CarFinderAnalysis = {
  ranked: ScoredListing[];
  top5Overall: ScoredListing[];
  top5Under90k: ScoredListing[];
  bestLowHeadache?: ScoredListing;
  bestValue?: ScoredListing;
  bestFamilyJb?: ScoredListing;
  avoid: ScoredListing[];
  markdownReport: string;
  csvRows: string[][];
  csvText: string;
  dealerQuestions: string[];
  inspectionChecklist: string[];
  waMessageTemplate: string;
};
