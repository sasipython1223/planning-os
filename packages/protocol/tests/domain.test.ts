/**
 * M02 Domain Model — Mock Instantiation Tests
 *
 * These tests verify that:
 * 1. All protocol contracts can be instantiated with realistic values
 * 2. Discriminated unions narrow correctly via the `kind` field
 * 3. Types model a simple realistic scenario cleanly
 * 4. CompiledScheduleGraph bridges domain → solver boundary
 *
 * No UI, worker, or solver code is exercised.
 */

import { describe, expect, it } from "vitest";
import type {
    AuthoredActivity,
    AuthoredDependencyLink,
    GeneratedActivity,
    GeneratedDependency,
} from "../src/activities.js";
import type {
    CompiledScheduleGraph,
    DomainCompiler,
} from "../src/compiler.js";
import type {
    AssumptionSet,
    DomainResource,
    DurationStrategy,
    FixedDurationStrategy,
    ManualOverrideStrategy,
    ProductivityDrivenStrategy,
    ProductivityRule,
    Quantity,
    Zone,
} from "../src/domain.js";

// ─── Fixtures ───────────────────────────────────────────────────────

const zone: Zone = {
  id: "zone-1",
  name: "Ground Floor",
};

const quantity: Quantity = {
  id: "qty-1",
  zoneId: "zone-1",
  label: "Concrete Volume",
  unit: "m³",
  amount: 120,
};

const resource: DomainResource = {
  id: "res-1",
  name: "Concrete Crew A",
  maxUnitsPerDay: 2,
};

const productivityRule: ProductivityRule = {
  id: "rule-1",
  resourceId: "res-1",
  quantityLabel: "Concrete Volume",
  ratePerUnitPerDay: 15,
};

const assumptionSet: AssumptionSet = {
  id: "as-1",
  version: 1,
  name: "Baseline Scenario",
  zones: [zone],
  quantities: [quantity],
  resources: [resource],
  productivityRules: [productivityRule],
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("Domain Model Contracts (M02)", () => {
  describe("physical domain primitives", () => {
    it("should instantiate a Zone", () => {
      expect(zone.id).toBe("zone-1");
      expect(zone.name).toBe("Ground Floor");
    });

    it("should instantiate a Zone with parent", () => {
      const childZone: Zone = {
        id: "zone-2",
        name: "Wing A",
        parentZoneId: "zone-1",
      };
      expect(childZone.parentZoneId).toBe("zone-1");
    });

    it("should instantiate a Quantity", () => {
      expect(quantity.zoneId).toBe("zone-1");
      expect(quantity.amount).toBe(120);
      expect(quantity.unit).toBe("m³");
    });

    it("should instantiate a DomainResource", () => {
      expect(resource.maxUnitsPerDay).toBe(2);
    });

    it("should instantiate a ProductivityRule", () => {
      expect(productivityRule.resourceId).toBe("res-1");
      expect(productivityRule.ratePerUnitPerDay).toBe(15);
    });
  });

  describe("DurationStrategy discriminated union", () => {
    it("should narrow productivity-driven strategy via kind", () => {
      const strategy: DurationStrategy = {
        kind: "productivity-driven",
        quantityId: "qty-1",
        resourceId: "res-1",
        productivityRuleId: "rule-1",
        crewSize: 2,
      };

      expect(strategy.kind).toBe("productivity-driven");

      // Type narrowing check
      if (strategy.kind === "productivity-driven") {
        const narrowed: ProductivityDrivenStrategy = strategy;
        expect(narrowed.crewSize).toBe(2);
        expect(narrowed.quantityId).toBe("qty-1");
      }
    });

    it("should narrow fixed strategy via kind", () => {
      const strategy: DurationStrategy = {
        kind: "fixed",
        durationDays: 5,
      };

      expect(strategy.kind).toBe("fixed");

      if (strategy.kind === "fixed") {
        const narrowed: FixedDurationStrategy = strategy;
        expect(narrowed.durationDays).toBe(5);
      }
    });

    it("should narrow manual-override strategy via kind", () => {
      const strategy: DurationStrategy = {
        kind: "manual-override",
        durationDays: 10,
        reasonCode: "client-directive",
        note: "Client requested extended curing period",
      };

      expect(strategy.kind).toBe("manual-override");

      if (strategy.kind === "manual-override") {
        const narrowed: ManualOverrideStrategy = strategy;
        expect(narrowed.reasonCode).toBe("client-directive");
        expect(narrowed.note).toBeDefined();
      }
    });

    it("should model manual-override without optional note", () => {
      const strategy: ManualOverrideStrategy = {
        kind: "manual-override",
        durationDays: 3,
        reasonCode: "regulatory",
      };
      expect(strategy.note).toBeUndefined();
    });

    it("should exhaustively switch on DurationStrategy kind", () => {
      const strategies: DurationStrategy[] = [
        { kind: "productivity-driven", quantityId: "q", resourceId: "r", productivityRuleId: "p", crewSize: 1 },
        { kind: "fixed", durationDays: 5 },
        { kind: "manual-override", durationDays: 3, reasonCode: "other" },
      ];

      const kinds = strategies.map((s) => {
        switch (s.kind) {
          case "productivity-driven": return "productivity-driven";
          case "fixed": return "fixed";
          case "manual-override": return "manual-override";
        }
      });

      expect(kinds).toEqual(["productivity-driven", "fixed", "manual-override"]);
    });
  });

  describe("AssumptionSet", () => {
    it("should instantiate a complete AssumptionSet", () => {
      expect(assumptionSet.id).toBe("as-1");
      expect(assumptionSet.version).toBe(1);
      expect(assumptionSet.zones).toHaveLength(1);
      expect(assumptionSet.quantities).toHaveLength(1);
      expect(assumptionSet.resources).toHaveLength(1);
      expect(assumptionSet.productivityRules).toHaveLength(1);
    });
  });

  describe("AuthoredActivity", () => {
    it("should instantiate with productivity-driven strategy and dependencies", () => {
      const dep: AuthoredDependencyLink = {
        predecessorActivityId: "act-0",
        type: "FS",
        lagDays: 0,
      };

      const activity: AuthoredActivity = {
        id: "act-1",
        name: "Pour Ground Floor Concrete",
        zoneId: "zone-1",
        durationStrategy: {
          kind: "productivity-driven",
          quantityId: "qty-1",
          resourceId: "res-1",
          productivityRuleId: "rule-1",
          crewSize: 2,
        },
        dependencies: [dep],
        constraintType: "SNET",
        constraintDate: 10,
      };

      expect(activity.id).toBe("act-1");
      expect(activity.durationStrategy.kind).toBe("productivity-driven");
      expect(activity.dependencies).toHaveLength(1);
      expect(activity.constraintType).toBe("SNET");
    });

    it("should instantiate without optional constraint fields", () => {
      const activity: AuthoredActivity = {
        id: "act-2",
        name: "Install Formwork",
        zoneId: "zone-1",
        durationStrategy: { kind: "fixed", durationDays: 3 },
        dependencies: [],
      };

      expect(activity.constraintType).toBeUndefined();
      expect(activity.constraintDate).toBeUndefined();
    });
  });

  describe("GeneratedActivity", () => {
    it("should instantiate with resolved duration", () => {
      const generated: GeneratedActivity = {
        id: "gen-1",
        sourceAuthoredActivityId: "act-1",
        name: "Pour Ground Floor Concrete",
        durationDays: 4, // ceil(120 / (2 × 15))
        resolvedStrategyKind: "productivity-driven",
        zoneId: "zone-1",
        constraintType: "SNET",
        constraintDate: 10,
      };

      expect(generated.durationDays).toBe(4);
      expect(generated.resolvedStrategyKind).toBe("productivity-driven");
      expect(generated.sourceAuthoredActivityId).toBe("act-1");
    });
  });

  describe("GeneratedDependency", () => {
    it("should instantiate a resolved dependency", () => {
      const dep: GeneratedDependency = {
        predecessorId: "gen-0",
        successorId: "gen-1",
        type: "FS",
        lagDays: 0,
      };

      expect(dep.predecessorId).toBe("gen-0");
      expect(dep.successorId).toBe("gen-1");
    });
  });

  describe("CompiledScheduleGraph", () => {
    it("should instantiate a complete graph from a realistic scenario", () => {
      const graph: CompiledScheduleGraph = {
        activities: [
          {
            id: "gen-1",
            sourceAuthoredActivityId: "act-1",
            name: "Pour Ground Floor Concrete",
            durationDays: 4,
            resolvedStrategyKind: "productivity-driven",
            zoneId: "zone-1",
          },
          {
            id: "gen-2",
            sourceAuthoredActivityId: "act-2",
            name: "Cure Concrete",
            durationDays: 7,
            resolvedStrategyKind: "fixed",
            zoneId: "zone-1",
          },
        ],
        dependencies: [
          {
            predecessorId: "gen-1",
            successorId: "gen-2",
            type: "FS",
            lagDays: 1,
          },
        ],
        nonWorkingDays: [5, 6, 12, 13],
        sourceAssumptionSetId: "as-1",
        sourceAssumptionSetVersion: 1,
        compiledAt: "2026-03-15T12:00:00.000Z",
      };

      expect(graph.activities).toHaveLength(2);
      expect(graph.dependencies).toHaveLength(1);
      expect(graph.sourceAssumptionSetId).toBe("as-1");
      expect(graph.sourceAssumptionSetVersion).toBe(1);
      expect(graph.nonWorkingDays).toEqual([5, 6, 12, 13]);
    });
  });

  describe("DomainCompiler interface", () => {
    it("should be implementable with a mock", () => {
      const mockCompiler: DomainCompiler = {
        compile(assumptions, activities, nonWorkingDays) {
          return {
            activities: activities.map((a) => ({
              id: `gen-${a.id}`,
              sourceAuthoredActivityId: a.id,
              name: a.name,
              durationDays: a.durationStrategy.kind === "fixed"
                ? a.durationStrategy.durationDays
                : 1,
              resolvedStrategyKind: a.durationStrategy.kind,
              zoneId: a.zoneId,
              constraintType: a.constraintType,
              constraintDate: a.constraintDate,
            })),
            dependencies: [],
            nonWorkingDays: [...nonWorkingDays],
            sourceAssumptionSetId: assumptions.id,
            sourceAssumptionSetVersion: assumptions.version,
            compiledAt: new Date().toISOString(),
          };
        },
      };

      const authored: AuthoredActivity = {
        id: "act-1",
        name: "Test Activity",
        zoneId: "zone-1",
        durationStrategy: { kind: "fixed", durationDays: 5 },
        dependencies: [],
      };

      const result = mockCompiler.compile(assumptionSet, [authored], [5, 6]);

      expect(result.activities).toHaveLength(1);
      expect(result.activities[0].durationDays).toBe(5);
      expect(result.activities[0].resolvedStrategyKind).toBe("fixed");
      expect(result.sourceAssumptionSetId).toBe("as-1");
      expect(result.nonWorkingDays).toEqual([5, 6]);
    });
  });
});
