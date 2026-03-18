/**
 * @module activities
 *
 * Activity Variant Contracts — Protocol Definitions
 *
 * Defines the two lifecycle stages of an activity:
 * 1. AuthoredActivity — human-authored planning intent (domain input)
 * 2. GeneratedActivity — compiler-generated activity definition (pre-solver)
 *
 * Activities are projections of domain objects and assumptions.
 * The AuthoredActivity captures user intent; the GeneratedActivity
 * is what the DomainCompiler produces after resolving all domain
 * references into concrete scheduling primitives.
 *
 * ⚠️ CONTRACT FILE — No schedule calculation logic belongs here.
 */

import type { DomainEntityId, DurationStrategy } from "./domain.js";

// ─── Constraint Types ───────────────────────────────────────────────

/** Constraint types supported by the solver (mirrors kernel constraint vocabulary). */
export type ActivityConstraintType =
  | "ASAP"
  | "ALAP"
  | "SNET"
  | "FNLT"
  | "MSO"
  | "MFO";

// ─── Authored Activity ──────────────────────────────────────────────

/**
 * A dependency link authored between two activities.
 */
export type AuthoredDependencyLink = {
  readonly predecessorActivityId: DomainEntityId;
  readonly type: "FS" | "SS" | "FF" | "SF";
  readonly lagDays: number;
};

/**
 * A human-authored activity representing planning intent.
 *
 * AuthoredActivities reference domain entities (zones, quantities, resources)
 * by ID. They are the primary input alongside the AssumptionSet to the
 * DomainCompiler.
 *
 * The compiler resolves the DurationStrategy into a concrete duration
 * and emits a GeneratedActivity.
 */
export type AuthoredActivity = {
  readonly id: DomainEntityId;
  readonly name: string;
  /** The zone this activity takes place in. */
  readonly zoneId: DomainEntityId;
  /** How the duration is determined. */
  readonly durationStrategy: DurationStrategy;
  /** Dependencies on other authored activities. */
  readonly dependencies: readonly AuthoredDependencyLink[];
  /** Optional constraint type forwarded to the solver. */
  readonly constraintType?: ActivityConstraintType;
  /** Optional constraint date as day-offset from project start. */
  readonly constraintDate?: number | null;
};

// ─── Generated Activity ─────────────────────────────────────────────

/**
 * A compiler-generated activity definition, ready for the solver.
 *
 * All domain references have been resolved:
 * - DurationStrategy → concrete `durationDays`
 * - Zone / Quantity IDs → traceability metadata only
 *
 * GeneratedActivities are the rows of the CompiledScheduleGraph.
 * They do NOT go to the solver directly — the CompiledScheduleGraph
 * is further mapped to ScheduleRequest (kernel.ts) at the worker boundary.
 */
export type GeneratedActivity = {
  readonly id: DomainEntityId;
  /** The authored activity this was derived from. */
  readonly sourceAuthoredActivityId: DomainEntityId;
  readonly name: string;
  /** Resolved concrete duration in working days. */
  readonly durationDays: number;
  /** The kind of strategy that produced this duration, for traceability. */
  readonly resolvedStrategyKind: DurationStrategy["kind"];
  /** Zone ID for traceability. */
  readonly zoneId: DomainEntityId;
  readonly constraintType?: ActivityConstraintType;
  readonly constraintDate?: number | null;
};

/**
 * A resolved dependency between two GeneratedActivities.
 */
export type GeneratedDependency = {
  readonly predecessorId: DomainEntityId;
  readonly successorId: DomainEntityId;
  readonly type: "FS" | "SS" | "FF" | "SF";
  readonly lagDays: number;
};
