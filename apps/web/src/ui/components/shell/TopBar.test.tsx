// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../../store/uiStore";
import { TopBar } from "./TopBar";

describe("TopBar temporal authority diagnostics", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useUIStore.setState({
      statusText: "",
      temporalAuthorityDiagnostics: null,
    });
  });

  it("does not render diagnostics badge when no diagnostics snapshot exists", () => {
    render(<TopBar />);
    expect(screen.queryByLabelText("Temporal authority diagnostics")).toBeNull();
  });

  it("renders Slot authoritative badge by default", () => {
    useUIStore.setState({
      temporalAuthorityDiagnostics: {
        currentAuthorityEngineMode: "slot_authoritative",
        previousAuthorityEngineMode: "slot_authoritative",
        appliedEngine: "unknown",
        applyMode: "unknown",
        rolloutRing: "unknown",
        authorityApplied: false,
        fallbackReason: null,
        lastTemporalAuthorityRunId: null,
        lastTemporalAuthorityDecision: null,
        lastTemporalAuthorityAuditPreview: null,
        lastTemporalCandidateRunId: null,
        candidateProjectionAvailable: false,
        comparisonPresent: false,
        unexplainedDivergenceCount: null,
        realWasmValidationPassed: null,
        wasmLoadMode: "unknown",
        sourceProtectionStatus: "unknown",
        persistenceApplied: false,
      },
    });

    render(<TopBar />);
    expect(screen.getByText("Slot authoritative")).not.toBeNull();
  });

  it("renders Temporal candidate badge when candidate projection exists", () => {
    useUIStore.setState({
      temporalAuthorityDiagnostics: {
        currentAuthorityEngineMode: "slot_authoritative",
        previousAuthorityEngineMode: "slot_authoritative",
        appliedEngine: "unknown",
        applyMode: "unknown",
        rolloutRing: "internal_test",
        authorityApplied: false,
        fallbackReason: null,
        lastTemporalAuthorityRunId: null,
        lastTemporalAuthorityDecision: null,
        lastTemporalAuthorityAuditPreview: null,
        lastTemporalCandidateRunId: "cand-1",
        candidateProjectionAvailable: true,
        comparisonPresent: true,
        unexplainedDivergenceCount: 0,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        persistenceApplied: false,
      },
    });

    render(<TopBar />);
    expect(screen.getByText("Temporal candidate")).not.toBeNull();
  });

  it("renders Temporal authoritative and Slot fallback badges from current mode", () => {
    useUIStore.setState({
      temporalAuthorityDiagnostics: {
        currentAuthorityEngineMode: "temporal_authoritative",
        previousAuthorityEngineMode: "slot_authoritative",
        appliedEngine: "temporal",
        applyMode: "internal_runtime_temporal_authoritative",
        rolloutRing: "internal_test",
        authorityApplied: true,
        fallbackReason: null,
        lastTemporalAuthorityRunId: "run-1",
        lastTemporalAuthorityDecision: null,
        lastTemporalAuthorityAuditPreview: null,
        lastTemporalCandidateRunId: "cand-1",
        candidateProjectionAvailable: true,
        comparisonPresent: true,
        unexplainedDivergenceCount: 0,
        realWasmValidationPassed: true,
        wasmLoadMode: "real",
        sourceProtectionStatus: "ok",
        persistenceApplied: false,
      },
    });

    const { rerender } = render(<TopBar />);
    expect(screen.getByText("Temporal authoritative")).not.toBeNull();

    useUIStore.setState({
      temporalAuthorityDiagnostics: {
        currentAuthorityEngineMode: "slot_fallback",
        previousAuthorityEngineMode: "temporal_authoritative",
        appliedEngine: "slot",
        applyMode: "slot_fallback",
        rolloutRing: "internal_test",
        authorityApplied: false,
        fallbackReason: "rollback_requested",
        lastTemporalAuthorityRunId: "run-2",
        lastTemporalAuthorityDecision: null,
        lastTemporalAuthorityAuditPreview: null,
        lastTemporalCandidateRunId: "cand-2",
        candidateProjectionAvailable: false,
        comparisonPresent: false,
        unexplainedDivergenceCount: null,
        realWasmValidationPassed: null,
        wasmLoadMode: "unknown",
        sourceProtectionStatus: "unknown",
        persistenceApplied: false,
      },
    });

    rerender(<TopBar />);
    expect(screen.getByText("Slot fallback")).not.toBeNull();
  });

  it("includes source/slot/temporal date safety copy", () => {
    useUIStore.setState({
      temporalAuthorityDiagnostics: {
        currentAuthorityEngineMode: "slot_authoritative",
        previousAuthorityEngineMode: "slot_authoritative",
        appliedEngine: "unknown",
        applyMode: "unknown",
        rolloutRing: "unknown",
        authorityApplied: false,
        fallbackReason: null,
        lastTemporalAuthorityRunId: null,
        lastTemporalAuthorityDecision: null,
        lastTemporalAuthorityAuditPreview: null,
        lastTemporalCandidateRunId: null,
        candidateProjectionAvailable: false,
        comparisonPresent: false,
        unexplainedDivergenceCount: null,
        realWasmValidationPassed: null,
        wasmLoadMode: "unknown",
        sourceProtectionStatus: "unknown",
        persistenceApplied: false,
      },
    });

    render(<TopBar />);
    expect(screen.getByText(/Imported Source Dates are immutable references/i)).not.toBeNull();
    expect(screen.getByText(/Slot-Calculated Dates are current authoritative output/i)).not.toBeNull();
    expect(screen.getByText(/Temporal-Calculated Dates are candidate or authority diagnostics only/i)).not.toBeNull();
  });
});
