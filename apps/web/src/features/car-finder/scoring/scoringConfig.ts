import { BUYER_CONSTRAINTS } from "../constants";

export const SCORING_CONFIG = {
  financial: {
    total: 35,
    depreciation: 15,
    priceBudget: 8,
    paymentFit: 6,
    paperValue: 6,
  },
  reliability: {
    total: 25,
    modelReliability: 10,
    drivetrainSimplicity: 5,
    maintenanceCost: 5,
    warrantyService: 5,
  },
  historyRisk: {
    total: 20,
    ownerCount: 5,
    phvRentalCompanyRisk: 6,
    serviceRecords: 4,
    dealerTransparency: 5,
  },
  practicality: {
    total: 20,
    officialUse: 4,
    familyComfort: 5,
    safetyFeatures: 5,
    fuelEconomy: 3,
    resaleLiquidity: 3,
  },
  thresholds: {
    inspect: 75,
    watch: 55,
  },
  buyer: BUYER_CONSTRAINTS,
} as const;

export type ScoringConfig = typeof SCORING_CONFIG;
