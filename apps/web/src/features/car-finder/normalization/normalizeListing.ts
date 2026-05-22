import type { CarListing, DataQuality, FuelType, NormalizedListing } from "../types";
import { parseCurrency } from "./parseCurrency";
import { parseDurationToMonths } from "./parseDuration";
import { parseNumber } from "./parseNumber";

type AnyRow = Record<string, unknown>;

const KNOWN_KEYS = new Set([
  "id", "sourceUrl", "url", "listingUrl", "make", "model", "variant", "title", "name",
  "price", "advertisedMonthlyInstallment", "monthly", "annualDepreciation", "depreciation",
  "registrationDate", "regDate", "coeRemainingMonths", "coeRemaining", "coeRemainingText",
  "deregValue", "coeValue", "omv", "arf", "estimatedParf", "parf",
  "mileageKm", "mileage", "ownerCount", "owners", "vehicleType", "normalPlate", "isOpc",
  "isCoeCar", "isParfCar", "dealerName", "dealer", "warrantyText", "warranty",
  "serviceRecordText", "serviceRecords", "description", "featureText", "features", "fuelType",
  "transmission", "listedClaims", "raw",
]);

const BOOL_TRUE = new Set(["true", "yes", "y", "1"]);

function readValue(row: AnyRow, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== "") {
      return row[key];
    }
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase().trim();
  if (BOOL_TRUE.has(lower)) return true;
  if (["false", "no", "n", "0"].includes(lower)) return false;
  return undefined;
}

function parseFuelType(value: unknown): FuelType {
  if (typeof value !== "string") return "unknown";
  const lower = value.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("electric") || lower.includes("ev")) return "electric";
  if (lower.includes("diesel")) return "diesel";
  if (lower.includes("petrol") || lower.includes("gasoline")) return "petrol";
  return "unknown";
}

function buildTitle(make?: string, model?: string, variant?: string): string {
  return [make, model, variant].filter(Boolean).join(" ").trim() || "Unknown Listing";
}

function buildDataQuality(listing: CarListing, derived: string[]): DataQuality {
  const requiredFields: (keyof CarListing)[] = [
    "price",
    "annualDepreciation",
    "registrationDate",
    "coeRemainingMonths",
  ];

  const missing = requiredFields.filter((k) => listing[k] == null).map(String);
  const requiresDealerConfirmation = [
    "listedClaims.nonPhv",
    "listedClaims.accidentFree",
    "serviceRecordText",
  ];

  const requiresInspection = [
    "accident/paint assessment",
    "engine/gearbox diagnostics",
    "hybrid battery health (if applicable)",
  ];

  const reported = Object.entries(listing)
    .filter(([, value]) => value != null)
    .map(([key]) => key)
    .filter((key) => !derived.includes(key));

  return { reported, derived, missing, requiresDealerConfirmation, requiresInspection };
}

export function normalizeListing(input: CarListing | AnyRow, index = 0): NormalizedListing {
  const row = input as AnyRow;
  const warnings: string[] = [];
  const derived: string[] = [];

  const make = (readValue(row, ["make"]) as string | undefined)?.trim();
  const model = (readValue(row, ["model"]) as string | undefined)?.trim();
  const variant = (readValue(row, ["variant"]) as string | undefined)?.trim();
  const explicitTitle = (readValue(row, ["title", "name"]) as string | undefined)?.trim();
  const title = explicitTitle || buildTitle(make, model, variant);
  if (!explicitTitle) derived.push("title");

  const coeRemainingText = (readValue(row, ["coeRemainingText", "coeRemaining"]) as string | undefined)?.trim();
  const coeRemainingMonths = parseDurationToMonths(readValue(row, ["coeRemainingMonths", "coeRemaining"]));
  if (coeRemainingMonths != null && row.coeRemainingMonths == null) derived.push("coeRemainingMonths");

  const fuelType = parseFuelType(readValue(row, ["fuelType"]));
  if (fuelType === "unknown") warnings.push("Fuel type missing or unrecognized; defaulted to unknown.");

  for (const key of Object.keys(row)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`Unknown field preserved in raw payload: ${key}`);
    }
  }

  const listing: CarListing = {
    id: String(readValue(row, ["id"]) ?? `listing-${index + 1}`),
    sourceUrl: (readValue(row, ["sourceUrl", "url", "listingUrl"]) as string | undefined)?.trim(),
    make,
    model,
    variant,
    title,
    price: parseCurrency(readValue(row, ["price"])),
    advertisedMonthlyInstallment: parseCurrency(readValue(row, ["advertisedMonthlyInstallment", "monthly"])),
    annualDepreciation: parseCurrency(readValue(row, ["annualDepreciation", "depreciation"])),
    registrationDate: (readValue(row, ["registrationDate", "regDate"]) as string | undefined)?.trim(),
    coeRemainingMonths,
    coeRemainingText,
    deregValue: parseCurrency(readValue(row, ["deregValue"])),
    coeValue: parseCurrency(readValue(row, ["coeValue"])),
    omv: parseCurrency(readValue(row, ["omv"])),
    arf: parseCurrency(readValue(row, ["arf"])),
    estimatedParf: parseCurrency(readValue(row, ["estimatedParf", "parf"])),
    mileageKm: parseNumber(readValue(row, ["mileageKm", "mileage"])),
    ownerCount: parseNumber(readValue(row, ["ownerCount", "owners"])),
    vehicleType: (readValue(row, ["vehicleType"]) as string | undefined)?.trim(),
    normalPlate: parseBoolean(readValue(row, ["normalPlate"])),
    isOpc: parseBoolean(readValue(row, ["isOpc"])),
    isCoeCar: parseBoolean(readValue(row, ["isCoeCar"])),
    isParfCar: parseBoolean(readValue(row, ["isParfCar"])),
    dealerName: (readValue(row, ["dealerName", "dealer"]) as string | undefined)?.trim(),
    warrantyText: (readValue(row, ["warrantyText", "warranty"]) as string | undefined)?.trim(),
    serviceRecordText: (readValue(row, ["serviceRecordText", "serviceRecords"]) as string | undefined)?.trim(),
    description: (readValue(row, ["description"]) as string | undefined)?.trim(),
    featureText: (readValue(row, ["featureText", "features"]) as string | undefined)?.trim(),
    fuelType,
    transmission: (readValue(row, ["transmission"]) as string | undefined)?.trim(),
    listedClaims: typeof row.listedClaims === "object" && row.listedClaims != null
      ? (row.listedClaims as CarListing["listedClaims"])
      : undefined,
    raw: { ...row },
  };

  if (listing.isOpc === true) {
    listing.normalPlate = false;
  }

  if (listing.isParfCar == null && listing.isCoeCar != null) {
    listing.isParfCar = !listing.isCoeCar;
    derived.push("isParfCar");
  }

  const dataQuality = buildDataQuality(listing, derived);
  if (dataQuality.missing.length > 0) {
    warnings.push(`Critical fields missing: ${dataQuality.missing.join(", ")}`);
  }

  return { listing, warnings, dataQuality };
}

export function normalizeListings(inputs: Array<CarListing | AnyRow>): NormalizedListing[] {
  return inputs.map((input, index) => normalizeListing(input, index));
}
