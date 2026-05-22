import { BUYER_CONSTRAINTS, DCT_HINTS, DEPRIORITISED_MODEL_HINTS, PI_HINTS, SMALL_TURBO_HINTS } from "../constants";
import type { CarListing, RiskFlag } from "../types";

export function dealerRisk(listing: CarListing): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const text = `${listing.title ?? ""} ${listing.make ?? ""} ${listing.model ?? ""} ${listing.variant ?? ""} ${listing.description ?? ""} ${listing.warrantyText ?? ""} ${listing.featureText ?? ""} ${listing.transmission ?? ""}`.toLowerCase();

  if (listing.isOpc) {
    flags.push({
      code: "OPC",
      severity: "medium",
      note: "OPC plate detected; does not fit normal-plate preference unless special-case accepted.",
    });
  }

  if (listing.isCoeCar) {
    flags.push({
      code: "COE_RENEWED",
      severity: "medium",
      note: "Renewed COE listing; review only if intentionally considering short-term ownership.",
    });
  }

  if ((listing.coeRemainingMonths ?? Number.POSITIVE_INFINITY) < BUYER_CONSTRAINTS.shortCoeMonths) {
    flags.push({
      code: "SHORT_COE",
      severity: "high",
      note: "Short remaining COE materially increases renewal/timeline risk.",
    });
  }

  if (!text.includes("inspection") && !text.includes("sta") && !text.includes("vicom")) {
    flags.push({
      code: "LOW_TRANSPARENCY",
      severity: "medium",
      note: "Dealer inspection readiness is unclear; require pre-purchase inspection approval.",
    });
  }

  if (DCT_HINTS.some((hint) => text.includes(hint))) {
    flags.push({
      code: "DCT_GEARBOX_RISK",
      severity: "medium",
      note: "DCT drivetrain detected; request gearbox servicing history and test-drive checks.",
    });
  }

  if (SMALL_TURBO_HINTS.some((hint) => text.includes(hint))) {
    flags.push({
      code: "TURBO_SMALL_ENGINE_RISK",
      severity: "medium",
      note: "Small turbo engine detected; verify long-term maintenance history and wear condition.",
    });
  }

  if (PI_HINTS.some((hint) => text.includes(hint))) {
    flags.push({
      code: "DIRECT_IMPORT_OR_PI_RISK",
      severity: "medium",
      note: "Direct/parallel import indicators detected; verify supportability, parts, and warranty coverage.",
    });
  }

  if (DEPRIORITISED_MODEL_HINTS.some((hint) => text.includes(hint))) {
    flags.push({
      code: "BUYER_DEPRIORITISED_MODEL",
      severity: "medium",
      note: "Model matches buyer-deprioritised list; only proceed if pricing and records are compelling.",
    });
  }

  return flags;
}
