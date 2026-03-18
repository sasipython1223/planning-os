/**
 * @module domain
 *
 * Parametric Domain Model — Protocol Contracts
 *
 * These types define the structured data model for construction planning.
 * They represent the "project reality" — physical zones, quantities,
 * resources, and productivity assumptions — before compilation into
 * a schedule graph.
 *
 * ⚠️ CONTRACT FILE — No schedule calculation logic belongs here.
 * These types are inputs to the DomainCompiler, not consumed by
 * the solver directly. The kernel boundary must remain pure.
 */

// ─── Identifiers ────────────────────────────────────────────────────

/** Unique identifier for domain entities. */
export type DomainEntityId = string;

// ─── Physical Domain Primitives ─────────────────────────────────────

/**
 * A physical or logical zone within the project.
 * Zones partition the project scope spatially (floors, areas, sections).
 */
export type Zone = {
  readonly id: DomainEntityId;
  readonly name: string;
  /** Optional parent zone for hierarchical decomposition. */
  readonly parentZoneId?: DomainEntityId;
};

/**
 * A measurable quantity of work within a zone.
 * Examples: cubic meters of concrete, square meters of formwork.
 */
export type Quantity = {
  readonly id: DomainEntityId;
  readonly zoneId: DomainEntityId;
  /** Human-readable label for the quantity type (e.g., "Concrete Volume"). */
  readonly label: string;
  /** The unit of measurement (e.g., "m³", "m²", "tonnes"). */
  readonly unit: string;
  /** The measured amount in the specified unit. Must be positive. */
  readonly amount: number;
};

/**
 * A named resource with daily capacity.
 *
 * This is the domain-level resource concept, distinct from the solver-facing
 * Resource defined in types.ts. Domain resources carry richer semantics that
 * are resolved during compilation.
 */
export type DomainResource = {
  readonly id: DomainEntityId;
  readonly name: string;
  /** Maximum units available per working day. Must be positive. */
  readonly maxUnitsPerDay: number;
};

/**
 * A rule that maps a resource operating on a quantity type to a production rate.
 * Used by productivity-driven duration strategies.
 */
export type ProductivityRule = {
  readonly id: DomainEntityId;
  readonly resourceId: DomainEntityId;
  /** The quantity label this rule applies to (must match a Quantity.label). */
  readonly quantityLabel: string;
  /** Units of quantity produced per resource-unit per working day. Must be positive. */
  readonly ratePerUnitPerDay: number;
};

// ─── Duration Strategy (Discriminated Union) ────────────────────────

/**
 * Duration computed from quantity, crew size, and a productivity rule.
 *
 * Resolved formula: `ceil(quantity.amount / (crewSize × rule.ratePerUnitPerDay))`
 *
 * The compiler resolves this into a concrete integer duration.
 */
export type ProductivityDrivenStrategy = {
  readonly kind: "productivity-driven";
  readonly quantityId: DomainEntityId;
  readonly resourceId: DomainEntityId;
  readonly productivityRuleId: DomainEntityId;
  /** Number of resource units (crews) assigned. Must be >= 1. */
  readonly crewSize: number;
};

/**
 * Explicit fixed duration, not derived from any productivity calculation.
 */
export type FixedDurationStrategy = {
  readonly kind: "fixed";
  /** Duration in working days. Must be >= 1. */
  readonly durationDays: number;
};

/**
 * Manual override of a computed duration.
 * Requires structured justification — free-text rationale fields
 * must never influence schedule math.
 */
export type ManualOverrideStrategy = {
  readonly kind: "manual-override";
  /** The overridden duration in working days. Must be >= 1. */
  readonly durationDays: number;
  /** Structured reason code for the override. */
  readonly reasonCode:
    | "client-directive"
    | "site-constraint"
    | "regulatory"
    | "other";
  /** Optional human-readable note. Does not affect calculations. */
  readonly note?: string;
};

/**
 * Discriminated union of all duration calculation strategies.
 * Discriminant field: `kind`
 *
 * Extend this union for future strategies (e.g., resource-leveled,
 * simulation-based) by adding new variants here.
 */
export type DurationStrategy =
  | ProductivityDrivenStrategy
  | FixedDurationStrategy
  | ManualOverrideStrategy;

// ─── Assumption Set ─────────────────────────────────────────────────

/**
 * A versioned container for all domain assumptions that define a project scenario.
 *
 * The AssumptionSet is the top-level input to the DomainCompiler.
 * Changing any value in an AssumptionSet produces a new version;
 * the compiler re-derives the schedule graph from scratch.
 */
export type AssumptionSet = {
  readonly id: DomainEntityId;
  /** Monotonically increasing version number. Starts at 1. */
  readonly version: number;
  /** Human-readable scenario name. */
  readonly name: string;
  readonly zones: readonly Zone[];
  readonly quantities: readonly Quantity[];
  readonly resources: readonly DomainResource[];
  readonly productivityRules: readonly ProductivityRule[];
};
