/**
 * W5B-B2.7: Dogfood Eligibility Evaluator (diagnostic-only).
 *
 * Pure function. Produces a `TemporalDogfoodEligibilityDecision` describing
 * whether the runtime is ready to run under the `dogfood` rollout ring.
 *
 * Hard invariants:
 *   - Default decision is INELIGIBLE because `dogfoodAuthorityEnabled` defaults false.
 *   - Even if all eligibility checks pass, `authorityApplied` remains literal `false`.
 *   - This evaluator never enables dogfood authority. It is a control-plane
 *     readiness signal only. The apply path (`canApplyInternalTemporalAuthority`
 *     in worker.ts) independently blocks any non-`internal_test` ring.
 *   - UAT and production rings are always ineligible from this evaluator.
 */

import type {
    TemporalAuthorityRolloutRing,
    TemporalDogfoodAllowedProfile,
    TemporalDogfoodBlockedReason,
    TemporalDogfoodControls,
    TemporalDogfoodEligibilityDecision,
    TemporalDogfoodEvidenceRequirements,
} from "@planner/protocol";

export type TemporalDogfoodEvaluatorInput = {
  controls: TemporalDogfoodControls;
  rolloutRing: TemporalAuthorityRolloutRing;
};

const pushUnique = (
  list: TemporalDogfoodBlockedReason[],
  reason: TemporalDogfoodBlockedReason,
): void => {
  if (!list.includes(reason)) {
    list.push(reason);
  }
};

const evaluateAllowedProfile = (
  profile: TemporalDogfoodAllowedProfile,
  reasons: TemporalDogfoodBlockedReason[],
): void => {
  if (!profile.realWasmGatePassed) {
    pushUnique(reasons, "real_wasm_gate_not_passed");
  }
  if (!profile.candidateProjectionAvailable) {
    pushUnique(reasons, "candidate_projection_unavailable");
  }
  if (!profile.candidateComparisonPresent) {
    pushUnique(reasons, "candidate_comparison_missing");
  }
  if (profile.unexplainedDivergenceCount > profile.unexplainedDivergenceTolerance) {
    pushUnique(reasons, "unexplained_divergence_present");
  }
  if (profile.sourceProtectionStatus !== "ok") {
    pushUnique(reasons, "source_protection_not_ok");
  }
  if (profile.unsupportedFeatureFlags.length > 0) {
    pushUnique(reasons, "unsupported_feature_detected");
  }
  if (profile.temporalExecutionErrors.length > 0) {
    pushUnique(reasons, "temporal_execution_error");
  }
  if (profile.resourceCalendarRequirementDetected) {
    pushUnique(reasons, "resource_calendar_not_supported");
  }
  if (profile.lagCalendarRequirementDetected) {
    pushUnique(reasons, "lag_calendar_not_supported");
  }
  if (profile.p6SemanticsRequirementDetected) {
    pushUnique(reasons, "p6_semantics_not_supported");
  }
  if (profile.projectActivityCount > profile.projectActivityLimit) {
    pushUnique(reasons, "project_size_exceeds_dogfood_limit");
  }
  if (!profile.rollbackAvailable) {
    pushUnique(reasons, "rollback_not_available");
  }
  if (profile.persistenceApplied !== false) {
    pushUnique(reasons, "persistence_not_disabled");
  }
};

const evaluateEvidence = (
  evidence: TemporalDogfoodEvidenceRequirements,
  reasons: TemporalDogfoodBlockedReason[],
): void => {
  if (evidence.acceptedCleanRuns < evidence.requiredCleanRuns) {
    pushUnique(reasons, "evidence_package_missing");
  }
};

export const evaluateTemporalDogfoodEligibility = (
  input: TemporalDogfoodEvaluatorInput,
): TemporalDogfoodEligibilityDecision => {
  const { controls, rolloutRing } = input;
  const blockedReasons: TemporalDogfoodBlockedReason[] = [];
  const warnings: string[] = [];

  // Master switch — DEFAULT OFF.
  if (!controls.dogfoodAuthorityEnabled) {
    pushUnique(blockedReasons, "dogfood_authority_disabled");
  }

  // Operator acknowledgement.
  if (controls.operatorAcknowledgementRequired && !controls.operatorAcknowledgementProvided) {
    pushUnique(blockedReasons, "operator_acknowledgement_missing");
  }

  // Persistence must remain disabled.
  if (controls.persistencePolicy !== "disabled_runtime_only") {
    pushUnique(blockedReasons, "persistence_not_disabled");
  }

  // Profile and evidence.
  evaluateAllowedProfile(controls.allowedProjectProfile, blockedReasons);
  evaluateEvidence(controls.evidenceRequirements, blockedReasons);

  // UAT/production are always ineligible via this evaluator (separate
  // milestone is required to introduce them; B2.7 must never path-bypass).
  if (rolloutRing === "uat" || rolloutRing === "production") {
    warnings.push(`rollout_ring_${rolloutRing}_outside_dogfood_scope`);
  }
  if (rolloutRing === "off") {
    warnings.push("rollout_ring_off");
  }

  const eligible = blockedReasons.length === 0;

  return {
    dogfoodControlsVersion: 1,
    eligible,
    dogfoodAuthorityEnabled: controls.dogfoodAuthorityEnabled === true,
    rolloutRing,
    blockedReasons,
    warnings,
    evidenceStatus: controls.evidenceRequirements,
    allowedProjectProfileStatus: controls.allowedProjectProfile,
    rollbackStatus: {
      rollbackAvailable: controls.allowedProjectProfile.rollbackAvailable,
      rollbackRequired: controls.rollbackRequired,
    },
    persistenceStatus: {
      persistencePolicy: "disabled_runtime_only",
      persistenceApplied: false,
    },
    sourceProtectionStatus: controls.allowedProjectProfile.sourceProtectionStatus,
    // Hard invariant: authority is never applied by the dogfood evaluator,
    // regardless of eligibility outcome.
    authorityApplied: false,
  };
};

/**
 * Build a safe-default `TemporalDogfoodControls` value:
 *   - dogfoodAuthorityEnabled = false (master switch off)
 *   - operatorAcknowledgement required but not provided
 *   - rollback required
 *   - persistence disabled
 *   - allowed profile populated with deliberately-failing defaults so a
 *     caller must explicitly populate live diagnostics to pass
 */
export const createDefaultTemporalDogfoodControls = (): TemporalDogfoodControls => ({
  dogfoodControlsVersion: 1,
  dogfoodAuthorityEnabled: false,
  allowedProjectProfile: {
    realWasmGatePassed: false,
    candidateProjectionAvailable: false,
    candidateComparisonPresent: false,
    unexplainedDivergenceCount: 0,
    unexplainedDivergenceTolerance: 0,
    sourceProtectionStatus: "not_evaluated_wasm_unavailable",
    unsupportedFeatureFlags: [],
    temporalExecutionErrors: [],
    persistenceApplied: false,
    rollbackAvailable: true,
    projectActivityCount: 0,
    projectActivityLimit: 1000,
    resourceCalendarRequirementDetected: false,
    lagCalendarRequirementDetected: false,
    p6SemanticsRequirementDetected: false,
  },
  evidenceRequirements: {
    requiredCleanRuns: 3,
    acceptedCleanRuns: 0,
    acceptedFixtures: [],
    latestEvidenceRecommendation: "evidence_incomplete",
  },
  operatorAcknowledgementRequired: true,
  operatorAcknowledgementProvided: false,
  rollbackRequired: true,
  persistencePolicy: "disabled_runtime_only",
});
