/**
 * W5B-B2.7: Dogfood Eligibility Evaluator unit tests.
 *
 * Verifies the diagnostic-only control plane semantics:
 *   - Default-off: master switch defaults false → ineligible.
 *   - All blocked-reason flags are wired correctly.
 *   - UAT/production rings never reach eligibility.
 *   - `authorityApplied` is always literal `false` regardless of eligibility.
 */
import type {
    TemporalAuthorityRolloutRing,
    TemporalDogfoodControls,
} from "@planner/protocol";
import { describe, expect, it } from "vitest";
import {
    createDefaultTemporalDogfoodControls,
    evaluateTemporalDogfoodEligibility,
} from "../../src/schedule/TemporalDogfoodEligibilityEvaluator.js";

const makeReadyControls = (): TemporalDogfoodControls => ({
  dogfoodControlsVersion: 1,
  dogfoodAuthorityEnabled: true,
  allowedProjectProfile: {
    realWasmGatePassed: true,
    candidateProjectionAvailable: true,
    candidateComparisonPresent: true,
    unexplainedDivergenceCount: 0,
    unexplainedDivergenceTolerance: 0,
    sourceProtectionStatus: "ok",
    unsupportedFeatureFlags: [],
    temporalExecutionErrors: [],
    persistenceApplied: false,
    rollbackAvailable: true,
    projectActivityCount: 250,
    projectActivityLimit: 1000,
    resourceCalendarRequirementDetected: false,
    lagCalendarRequirementDetected: false,
    p6SemanticsRequirementDetected: false,
  },
  evidenceRequirements: {
    requiredCleanRuns: 3,
    acceptedCleanRuns: 3,
    acceptedFixtures: ["AI001", "AI002", "AI004"],
    latestEvidenceRecommendation: "ready_for_dogfood_controls_default_off",
  },
  operatorAcknowledgementRequired: true,
  operatorAcknowledgementProvided: true,
  rollbackRequired: true,
  persistencePolicy: "disabled_runtime_only",
});

const evaluate = (
  controls: TemporalDogfoodControls,
  rolloutRing: TemporalAuthorityRolloutRing = "internal_test",
) => evaluateTemporalDogfoodEligibility({ controls, rolloutRing });

describe("W5B-B2.7 TemporalDogfoodEligibilityEvaluator", () => {
  it("1) default controls are ineligible (master switch off)", () => {
    const decision = evaluate(createDefaultTemporalDogfoodControls());
    expect(decision.eligible).toBe(false);
    expect(decision.blockedReasons).toContain("dogfood_authority_disabled");
    expect(decision.authorityApplied).toBe(false);
  });

  it("2) default decision authorityApplied is literally false", () => {
    const decision = evaluate(createDefaultTemporalDogfoodControls());
    expect(decision.authorityApplied).toBe(false);
  });

  it("3) blocked when realWasm gate not passed", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.realWasmGatePassed = false;
    expect(evaluate(controls).blockedReasons).toContain("real_wasm_gate_not_passed");
  });

  it("4) blocked when candidate projection unavailable", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.candidateProjectionAvailable = false;
    expect(evaluate(controls).blockedReasons).toContain("candidate_projection_unavailable");
  });

  it("5) blocked when candidate comparison missing", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.candidateComparisonPresent = false;
    expect(evaluate(controls).blockedReasons).toContain("candidate_comparison_missing");
  });

  it("6) blocked when unexplained divergences exceed tolerance", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.unexplainedDivergenceCount = 1;
    controls.allowedProjectProfile.unexplainedDivergenceTolerance = 0;
    expect(evaluate(controls).blockedReasons).toContain("unexplained_divergence_present");
  });

  it("7) blocked when source protection not ok", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.sourceProtectionStatus = "violated";
    expect(evaluate(controls).blockedReasons).toContain("source_protection_not_ok");
  });

  it("8) blocked when unsupported feature flags present", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.unsupportedFeatureFlags = ["custom_feature_x"];
    expect(evaluate(controls).blockedReasons).toContain("unsupported_feature_detected");
  });

  it("9) blocked when temporal execution errors present", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.temporalExecutionErrors = ["solver_error"];
    expect(evaluate(controls).blockedReasons).toContain("temporal_execution_error");
  });

  it("10) blocked when resource calendar requirement detected", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.resourceCalendarRequirementDetected = true;
    expect(evaluate(controls).blockedReasons).toContain("resource_calendar_not_supported");
  });

  it("11) blocked when lag calendar requirement detected", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.lagCalendarRequirementDetected = true;
    expect(evaluate(controls).blockedReasons).toContain("lag_calendar_not_supported");
  });

  it("12) blocked when p6 semantics requirement detected", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.p6SemanticsRequirementDetected = true;
    expect(evaluate(controls).blockedReasons).toContain("p6_semantics_not_supported");
  });

  it("13) blocked when project activity count exceeds limit", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.projectActivityCount = 1500;
    controls.allowedProjectProfile.projectActivityLimit = 1000;
    expect(evaluate(controls).blockedReasons).toContain("project_size_exceeds_dogfood_limit");
  });

  it("14) blocked when rollback unavailable", () => {
    const controls = makeReadyControls();
    controls.allowedProjectProfile.rollbackAvailable = false;
    expect(evaluate(controls).blockedReasons).toContain("rollback_not_available");
  });

  it("15) blocked when persistence policy not disabled_runtime_only", () => {
    const controls = makeReadyControls();
    // @ts-expect-error — intentionally invalid persistence policy to test guard.
    controls.persistencePolicy = "applied";
    expect(evaluate(controls).blockedReasons).toContain("persistence_not_disabled");
  });

  it("16) blocked when operator acknowledgement required but not provided", () => {
    const controls = makeReadyControls();
    controls.operatorAcknowledgementProvided = false;
    expect(evaluate(controls).blockedReasons).toContain("operator_acknowledgement_missing");
  });

  it("17) blocked when evidence accepted runs less than required", () => {
    const controls = makeReadyControls();
    controls.evidenceRequirements.acceptedCleanRuns = 2;
    controls.evidenceRequirements.requiredCleanRuns = 3;
    expect(evaluate(controls).blockedReasons).toContain("evidence_package_missing");
  });

  it("18) happy path eligible only when all checks pass + master switch on", () => {
    const decision = evaluate(makeReadyControls());
    expect(decision.eligible).toBe(true);
    expect(decision.blockedReasons).toEqual([]);
    // Hard invariant: even happy path never applies authority.
    expect(decision.authorityApplied).toBe(false);
  });

  it("19) UAT ring emits warning and remains diagnostic-only", () => {
    const decision = evaluate(makeReadyControls(), "uat");
    expect(decision.rolloutRing).toBe("uat");
    expect(decision.warnings.some((w) => w.includes("uat"))).toBe(true);
    expect(decision.authorityApplied).toBe(false);
  });

  it("20) production ring emits warning and remains diagnostic-only", () => {
    const decision = evaluate(makeReadyControls(), "production");
    expect(decision.rolloutRing).toBe("production");
    expect(decision.warnings.some((w) => w.includes("production"))).toBe(true);
    expect(decision.authorityApplied).toBe(false);
  });

  it("21) off ring emits warning", () => {
    const decision = evaluate(makeReadyControls(), "off");
    expect(decision.warnings).toContain("rollout_ring_off");
  });

  it("22) default controls have safe-off defaults", () => {
    const controls = createDefaultTemporalDogfoodControls();
    expect(controls.dogfoodAuthorityEnabled).toBe(false);
    expect(controls.operatorAcknowledgementRequired).toBe(true);
    expect(controls.operatorAcknowledgementProvided).toBe(false);
    expect(controls.rollbackRequired).toBe(true);
    expect(controls.persistencePolicy).toBe("disabled_runtime_only");
    expect(controls.evidenceRequirements.requiredCleanRuns).toBe(3);
    expect(controls.evidenceRequirements.acceptedCleanRuns).toBe(0);
  });

  it("23) blockedReasons are deduplicated", () => {
    const controls = createDefaultTemporalDogfoodControls();
    const decision = evaluate(controls);
    const unique = new Set(decision.blockedReasons);
    expect(unique.size).toBe(decision.blockedReasons.length);
  });

  it("24) decision carries rolloutRing back to caller", () => {
    expect(evaluate(makeReadyControls(), "internal_test").rolloutRing).toBe("internal_test");
    expect(evaluate(makeReadyControls(), "dogfood").rolloutRing).toBe("dogfood");
  });
});
