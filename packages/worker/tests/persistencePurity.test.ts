import { describe, expect, it } from "vitest";
import type { PersistedState } from "../src/persistence.js";
import { migratePersistedState, validatePersistedStatePurity } from "../src/persistence.js";
import { wm } from "./helpers.js";

const makePersistedState = (): PersistedState => ({
  version: 1,
  lastModified: Date.now(),
  state: {
    projectStartDate: "2025-01-06",
    excludeWeekends: true,
    tasks: [{ id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V" }],
    dependencies: [],
    baselines: {},
    resources: [],
    assignments: [],
  },
});

describe("D9 persistence purity", () => {
  it("accepts canonical persisted state", () => {
    const violations = validatePersistedStatePurity(makePersistedState());
    expect(violations).toEqual([]);
  });

  it("detects derived fields in persisted root state", () => {
    const persisted = makePersistedState() as PersistedState & {
      state: PersistedState["state"] & { scheduleResults?: unknown };
    };
    persisted.state.scheduleResults = { A: { earlyStartMinutes: 0 } };

    const violations = validatePersistedStatePurity(persisted);

    expect(violations).toContain("state.scheduleResults");
  });

  it("detects schedule-derived fields on tasks", () => {
    const persisted = makePersistedState() as PersistedState & {
      state: PersistedState["state"] & {
        tasks: Array<PersistedState["state"]["tasks"][number] & { earlyStartMinutes?: number }>;
      };
    };
    persisted.state.tasks[0].earlyStartMinutes = 0;

    const violations = validatePersistedStatePurity(persisted);

    expect(violations).toContain("state.tasks[0].earlyStartMinutes");
  });

  it("detects temporal candidate projection placeholders in persisted root state", () => {
    const persisted = makePersistedState() as PersistedState & {
      state: PersistedState["state"] & { lastTemporalCandidateProjection?: unknown };
    };
    persisted.state.lastTemporalCandidateProjection = { candidateRunId: "cand-1" };

    const violations = validatePersistedStatePurity(persisted);

    expect(violations).toContain("state.lastTemporalCandidateProjection");
  });

  it("detects temporal runtime-only authority and diagnostics fields in persisted root state", () => {
    const persisted = makePersistedState() as PersistedState & {
      state: PersistedState["state"] & {
        currentAuthorityEngineMode?: string;
        previousAuthorityEngineMode?: string;
        lastTemporalAuthorityRunId?: string;
        lastTemporalAuthorityDecision?: unknown;
        lastTemporalAuthorityAuditPreview?: unknown;
        lastTemporalAuthorityFallbackReason?: string;
        lastSlotAuthoritativeSnapshot?: unknown;
        temporalAuthorityDiagnostics?: unknown;
        temporalCandidateComparisonSummary?: unknown;
      };
    };

    persisted.state.currentAuthorityEngineMode = "temporal_authoritative";
    persisted.state.previousAuthorityEngineMode = "slot_authoritative";
    persisted.state.lastTemporalAuthorityRunId = "run-1";
    persisted.state.lastTemporalAuthorityDecision = { authorityEngineMode: "temporal_authoritative" };
    persisted.state.lastTemporalAuthorityAuditPreview = { authorityRunId: "run-1" };
    persisted.state.lastTemporalAuthorityFallbackReason = "slot_fallback";
    persisted.state.lastSlotAuthoritativeSnapshot = { T1: { earlyStartMinutes: 0 } };
    persisted.state.temporalAuthorityDiagnostics = { currentAuthorityEngineMode: "slot_authoritative" };
    persisted.state.temporalCandidateComparisonSummary = { comparedTaskCount: 1 };

    const violations = validatePersistedStatePurity(persisted);

    expect(violations).toContain("state.currentAuthorityEngineMode");
    expect(violations).toContain("state.previousAuthorityEngineMode");
    expect(violations).toContain("state.lastTemporalAuthorityRunId");
    expect(violations).toContain("state.lastTemporalAuthorityDecision");
    expect(violations).toContain("state.lastTemporalAuthorityAuditPreview");
    expect(violations).toContain("state.lastTemporalAuthorityFallbackReason");
    expect(violations).toContain("state.lastSlotAuthoritativeSnapshot");
    expect(violations).toContain("state.temporalAuthorityDiagnostics");
    expect(violations).toContain("state.temporalCandidateComparisonSummary");
  });

  it("migratePersistedState strips stale runtime-only temporal artifacts", () => {
    const persisted = makePersistedState() as PersistedState & {
      state: PersistedState["state"] & {
        currentAuthorityEngineMode?: string;
        lastTemporalAuthorityDecision?: unknown;
        lastTemporalAuthorityAuditPreview?: unknown;
        temporalAuthorityDiagnostics?: unknown;
        lastSlotAuthoritativeSnapshot?: unknown;
        temporalCandidateProjection?: unknown;
        tasks: Array<PersistedState["state"]["tasks"][number] & { earlyStartMinutes?: number }>;
      };
    };

    persisted.state.currentAuthorityEngineMode = "temporal_authoritative";
    persisted.state.lastTemporalAuthorityDecision = { authorityEngineMode: "temporal_authoritative" };
    persisted.state.lastTemporalAuthorityAuditPreview = { authorityRunId: "run-1" };
    persisted.state.temporalAuthorityDiagnostics = { currentAuthorityEngineMode: "slot_authoritative" };
    persisted.state.lastSlotAuthoritativeSnapshot = { A: { earlyStartMinutes: 0 } };
    persisted.state.temporalCandidateProjection = { candidateRunId: "cand-1" };
    persisted.state.tasks[0].earlyStartMinutes = 0;

    const migrated = migratePersistedState(persisted);

    expect((migrated.state as Record<string, unknown>).currentAuthorityEngineMode).toBeUndefined();
    expect((migrated.state as Record<string, unknown>).lastTemporalAuthorityDecision).toBeUndefined();
    expect((migrated.state as Record<string, unknown>).lastTemporalAuthorityAuditPreview).toBeUndefined();
    expect((migrated.state as Record<string, unknown>).temporalAuthorityDiagnostics).toBeUndefined();
    expect((migrated.state as Record<string, unknown>).lastSlotAuthoritativeSnapshot).toBeUndefined();
    expect((migrated.state as Record<string, unknown>).temporalCandidateProjection).toBeUndefined();
    expect((migrated.state.tasks[0] as Record<string, unknown>).earlyStartMinutes).toBeUndefined();
    expect(migrated.state.projectStartDate).toBe("2025-01-06");
    expect(migrated.state.tasks[0].id).toBe("A");
  });
});
