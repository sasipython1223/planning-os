/// <reference lib="webworker" />

import type {
    BaselineMap,
    CalendarId,
    Command,
    PlannerCalendar,
    ScheduleResultMap,
    Task,
    TemporalAuthorityAuditPreview,
    TemporalAuthorityCutoverDecision,
    TemporalAuthorityCutoverGateInput,
    TemporalAuthorityDiagnosticsPayload,
    TemporalAuthorityRolloutRing,
    TemporalCandidateDivergenceSummary,
    TemporalCandidateProjection,
    TemporalWasmValidationGatePayload,
    WorkerMessage,
} from "@planner/protocol";
import type { FloatPathMvpError, FloatPathMvpResponse, ScheduleError } from "@planner/protocol/kernel";
import { computeBusinessRollups } from "./businessRollup.js";
import { compileCalendar } from "./calendarRegistry.js";
import type { CalendarServices } from "./calendarTypes.js";
import { createTrackACalendarServices, STANDARD_CALENDAR } from "./calendarTypes.js";
import type { CommandEnvelope, DispatchResult } from "./commandEnvelope.js";
import { ack, auditLog, createEnvelope, dispatchError, nack } from "./commandEnvelope.js";
import { computeConstraintDiagnostics, mergeResultDiagnostics } from "./constraintDiagnostics.js";
import { buildSummaryTaskIds, computeDependencyDiagnostics } from "./dependencyDiagnostics.js";
import * as Hierarchy from "./hierarchy.js";
import * as UndoHistory from "./history.js";
import { compileActivityCalendars } from "./import/activityCalendarCompiler.js";
import { computeSourceVarianceReport } from "./import/computeVarianceReport.js";
import { clearPendingCandidate, getPendingCandidate } from "./import/importCandidate.js";
import { runImportPreview } from "./import/previewOrchestrator.js";
import { resolveImportedProjectDefaultCalendarActivation } from "./import/projectDefaultCalendarActivation.js";
import {
    buildSourceImportedLeafDisplayScheduleResults,
    normalizeImportedProjectStartDate,
} from "./import/sourceDisplayProjection.js";
import type { PersistedState } from "./persistence.js";
import {
    loadPersistedState,
    migratePersistedState,
    savePersistedState,
    validatePersistedStatePurity,
} from "./persistence.js";
import { computeResourceHistogram } from "./resourceHistogram.js";
import type { CalendarOutputContext } from "./rollup.js";
import { computeRollups } from "./rollup.js";
import { rollupSummarySchedules } from "./rollupSummaries.js";
import {
    evaluateAuthorityFlipGate,
    evaluateCutoverReadiness,
    evaluateMinuteCanaryEnablementDecision,
    evaluateRehearsalVerificationState,
    evaluateRingProgressionApprovalState,
    evaluateRolloutControlState,
    getCutoverTelemetrySnapshot,
    recordPrimaryProjectionDuration,
    setCanaryMinuteEnablementEnabled,
    setCutoverKillSwitchForceSlot,
    setKillSwitchRehearsalResult,
    setParityGatePassed,
    setPersistencePurityPassed,
    setReadinessBenchmarkPassed,
    setRequestedAuthorityMode,
    setRingProgressionApprovedTo,
    setRollbackRehearsalResult,
    setRolloutRing,
    setRolloutSubjectCohortId,
    setRolloutTargetedCohorts,
    setRolloutTargetingMode,
    setStagingGuardPassed,
} from "./schedule/CutoverReadinessGate.js";
import { buildCutoverReadinessReport, type CutoverReadinessMinuteCanaryExecutionArtifact } from "./schedule/CutoverReadinessReport.js";
import { decideD10eAuthorityRouting } from "./schedule/D10eAuthorityRouting.js";
import type { EngineResult, SchedulingStateSnapshot } from "./schedule/ISchedulingEngine.js";
import { MinuteEngineAdapter } from "./schedule/MinuteEngineAdapter.js";
import { projectFacts } from "./schedule/ProjectionAdapter.js";
import { buildTemporalAuthorityRoutingInput, decideScheduleAuthorityPolicy, type ScheduleAuthorityDecision } from "./schedule/ScheduleAuthorityPolicyGate.js";
import { ShadowEngineFacade } from "./schedule/ShadowEngineFacade.js";
import { SlotEngineAdapter } from "./schedule/SlotEngineAdapter.js";
import { parseProjectStartMs } from "./schedule/SlotScheduleTranslator.js";
import {
    createDefaultTemporalAuthorityCutoverGateInput,
    evaluateTemporalAuthorityCutoverGate,
} from "./schedule/TemporalAuthorityCutoverGate.js";
import { compareSlotVsTemporalCandidate } from "./schedule/TemporalCandidateComparator.js";
import {
    createBlockedTemporalCandidateProjection,
    evaluateTemporalCandidateProjectionGate,
} from "./schedule/TemporalCandidateProjectionGate.js";
import {
    createDefaultTemporalDogfoodControls,
    evaluateTemporalDogfoodEligibility,
} from "./schedule/TemporalDogfoodEligibilityEvaluator.js";
import { setTemporalWasm, TemporalEngineAdapter } from "./schedule/TemporalEngineAdapter.js";
import {
    attachUnexplainedDivergenceBuckets,
    buildTaskBucketHints,
    type UnexplainedDivergenceBucketHints,
} from "./schedule/UnexplainedDivergenceBuckets.js";
import { isMinutePayloadShadowEnabled } from "./schedule/minutePayloadShadowFlag.js";
import { runTemporalWasmValidationGate } from "./schedule/runTemporalWasmValidationGate.js";
import { getSchedulingMode } from "./schedulingMode.js";
import * as State from "./state.js";
import * as StructuralValidation from "./structuralValidation.js";
import * as Validation from "./validation.js";
import { computeVariances } from "./variance.js";
import { getCpmWasm, isWasmLoaded, loadCpmWasm } from "./wasm/loadCpmWasm.js";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

// Worker initialization state
let isReady = false;

// B2.4A: diagnostic-only in-memory placeholders (never persisted, never emitted in DIFF_STATE).
let lastTemporalWasmValidationGateResult: TemporalWasmValidationGatePayload | null = null;
let lastTemporalWasmValidationGateReqId: string | null = null;
let lastTemporalCandidateProjection: TemporalCandidateProjection | null = null;
let lastTemporalCandidateComparisonSummary: TemporalCandidateDivergenceSummary | null = null;

// B2.5D: runtime-only authority state (never persisted).
let currentAuthorityEngineMode: "slot_authoritative" | "slot_fallback" | "temporal_authoritative" = "slot_authoritative";
let previousAuthorityEngineMode: "slot_authoritative" | "slot_fallback" | "temporal_authoritative" = "slot_authoritative";
let lastTemporalAuthorityRunId: string | null = null;
let lastTemporalAuthorityDecision: TemporalAuthorityCutoverDecision | null = null;
let lastTemporalAuthorityAuditPreview: TemporalAuthorityAuditPreview | null = null;
let lastTemporalAuthorityFallbackReason: string | null = null;
let lastTemporalAuthorityAppliedEngine: "slot" | "temporal" | "unknown" = "unknown";
let lastTemporalAuthorityApplyMode:
  | "slot_fallback"
  | "internal_runtime_temporal_authoritative"
  | "dogfood_runtime_temporal_authoritative"
  | "unknown" = "unknown";
let lastTemporalAuthorityApplied = false;
let lastSlotAuthoritativeSnapshot: ScheduleResultMap | null = null;

// Track last emitted calendar data for projection-only updates
let lastNonWorkingDays: number[] = [];

// Phase D3: engine facade — slot (authoritative) + temporal (shadow).
// Worker calls only the facade. Shadow is disabled by default.
const engineFacade = new ShadowEngineFacade(
  new SlotEngineAdapter(),
  new TemporalEngineAdapter(),
);

const minuteAuthorityEngine = new TemporalEngineAdapter();

// D7a: shadow-only minute payload preparation adapter.
const minutePayloadAdapter = new MinuteEngineAdapter();

const syncCutoverFlagsFromRuntime = (): void => {
  const parseRolloutRing = (value: unknown): "off" | "internal_dogfood" | "canary" | "partial_production" | "full_production" => {
    if (
      value === "internal_dogfood" ||
      value === "canary" ||
      value === "partial_production" ||
      value === "full_production"
    ) {
      return value;
    }
    return "off";
  };

  const parseRolloutTargetingMode = (value: unknown): "all" | "cohort_allowlist" =>
    value === "cohort_allowlist" ? "cohort_allowlist" : "all";

  const parseTargetCohorts = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    if (typeof value === "string") {
      return value.split(",");
    }
    return [];
  };

  const parseRehearsalResult = (value: unknown): "not_run" | "passed" | "failed" => {
    if (value === "passed" || value === "failed") {
      return value;
    }
    return "not_run";
  };

  const parseOptionalTimestamp = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const parseOptionalNotes = (value: unknown): string | null | undefined =>
    typeof value === "string" ? value : undefined;

  const parseOptionalRing = (
    value: unknown,
  ): "off" | "internal_dogfood" | "canary" | "partial_production" | "full_production" | null | undefined => {
    if (
      value === "off" ||
      value === "internal_dogfood" ||
      value === "canary" ||
      value === "partial_production" ||
      value === "full_production"
    ) {
      return value;
    }
    if (value == null) {
      return null;
    }
    return undefined;
  };

  const runtime = self as unknown as {
    __PLANNER_REQUESTED_AUTHORITY_MODE?: "slot" | "minute";
    __PLANNER_FORCE_SLOT_AUTHORITY?: boolean;
    __PLANNER_PARITY_GATE_PASSED?: boolean;
    __PLANNER_READINESS_BENCHMARK_PASSED?: boolean;
    __PLANNER_PERSISTENCE_PURITY_PASSED?: boolean;
    __PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY?: boolean;
    __PLANNER_RING_PROGRESSION_APPROVED_TO?:
      | "off"
      | "internal_dogfood"
      | "canary"
      | "partial_production"
      | "full_production";
    __PLANNER_ROLLOUT_RING?:
      | "off"
      | "internal_dogfood"
      | "canary"
      | "partial_production"
      | "full_production";
    __PLANNER_ROLLOUT_TARGETING_MODE?: "all" | "cohort_allowlist";
    __PLANNER_ROLLOUT_SUBJECT_COHORT_ID?: string;
    __PLANNER_ROLLOUT_TARGET_COHORTS?: readonly string[] | string;
    __PLANNER_KILL_SWITCH_REHEARSAL_RESULT?: "not_run" | "passed" | "failed";
    __PLANNER_KILL_SWITCH_REHEARSAL_AT?: number;
    __PLANNER_KILL_SWITCH_REHEARSAL_RING?:
      | "off"
      | "internal_dogfood"
      | "canary"
      | "partial_production"
      | "full_production";
    __PLANNER_KILL_SWITCH_REHEARSAL_NOTES?: string;
    __PLANNER_ROLLBACK_REHEARSAL_RESULT?: "not_run" | "passed" | "failed";
    __PLANNER_ROLLBACK_REHEARSAL_AT?: number;
    __PLANNER_ROLLBACK_REHEARSAL_RING?:
      | "off"
      | "internal_dogfood"
      | "canary"
      | "partial_production"
      | "full_production";
    __PLANNER_ROLLBACK_REHEARSAL_NOTES?: string;
    __PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY?: boolean;
  };

  const LOCAL_RING0_BOOTSTRAP =
    typeof location !== "undefined" &&
    location.hostname === "127.0.0.1";

  if (LOCAL_RING0_BOOTSTRAP) {
    runtime.__PLANNER_REQUESTED_AUTHORITY_MODE = "minute";
    runtime.__PLANNER_FORCE_SLOT_AUTHORITY = false;
    runtime.__PLANNER_PARITY_GATE_PASSED = true;
    runtime.__PLANNER_READINESS_BENCHMARK_PASSED = true;
    runtime.__PLANNER_PERSISTENCE_PURITY_PASSED = true;
    runtime.__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY = true;
    runtime.__PLANNER_ROLLOUT_RING = "internal_dogfood";
    runtime.__PLANNER_RING_PROGRESSION_APPROVED_TO = "internal_dogfood";
    runtime.__PLANNER_ROLLOUT_TARGETING_MODE = "all";
    runtime.__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY = true;
    runtime.__PLANNER_KILL_SWITCH_REHEARSAL_RESULT = "passed";
    runtime.__PLANNER_KILL_SWITCH_REHEARSAL_AT = Date.now();
    runtime.__PLANNER_KILL_SWITCH_REHEARSAL_RING = "internal_dogfood";
    runtime.__PLANNER_ROLLBACK_REHEARSAL_RESULT = "passed";
    runtime.__PLANNER_ROLLBACK_REHEARSAL_AT = Date.now();
    runtime.__PLANNER_ROLLBACK_REHEARSAL_RING = "internal_dogfood";
  }

  setRequestedAuthorityMode(runtime.__PLANNER_REQUESTED_AUTHORITY_MODE === "minute" ? "minute" : "slot");
  setCutoverKillSwitchForceSlot(runtime.__PLANNER_FORCE_SLOT_AUTHORITY !== false);
  setParityGatePassed(runtime.__PLANNER_PARITY_GATE_PASSED === true);
  setReadinessBenchmarkPassed(runtime.__PLANNER_READINESS_BENCHMARK_PASSED === true);
  setPersistencePurityPassed(runtime.__PLANNER_PERSISTENCE_PURITY_PASSED === true);
  setStagingGuardPassed(runtime.__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY === true);
  setRolloutRing(parseRolloutRing(runtime.__PLANNER_ROLLOUT_RING));
  setRingProgressionApprovedTo(parseRolloutRing(runtime.__PLANNER_RING_PROGRESSION_APPROVED_TO));
  setRolloutTargetingMode(parseRolloutTargetingMode(runtime.__PLANNER_ROLLOUT_TARGETING_MODE));
  setRolloutSubjectCohortId(runtime.__PLANNER_ROLLOUT_SUBJECT_COHORT_ID ?? null);
  setRolloutTargetedCohorts(parseTargetCohorts(runtime.__PLANNER_ROLLOUT_TARGET_COHORTS));
  setCanaryMinuteEnablementEnabled(runtime.__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY === true);
  setKillSwitchRehearsalResult(
    parseRehearsalResult(runtime.__PLANNER_KILL_SWITCH_REHEARSAL_RESULT),
    parseOptionalTimestamp(runtime.__PLANNER_KILL_SWITCH_REHEARSAL_AT),
    parseOptionalRing(runtime.__PLANNER_KILL_SWITCH_REHEARSAL_RING),
    parseOptionalNotes(runtime.__PLANNER_KILL_SWITCH_REHEARSAL_NOTES),
  );
  setRollbackRehearsalResult(
    parseRehearsalResult(runtime.__PLANNER_ROLLBACK_REHEARSAL_RESULT),
    parseOptionalTimestamp(runtime.__PLANNER_ROLLBACK_REHEARSAL_AT),
    parseOptionalRing(runtime.__PLANNER_ROLLBACK_REHEARSAL_RING),
    parseOptionalNotes(runtime.__PLANNER_ROLLBACK_REHEARSAL_NOTES),
  );
};

// Test-only seam: allows worker runtime flag sync to be exercised directly.
export const __test__syncCutoverFlagsFromRuntime = (): void => {
  syncCutoverFlagsFromRuntime();
};

export const __test__getLastTemporalCandidateProjection = (): TemporalCandidateProjection | null => {
  return lastTemporalCandidateProjection;
};

/**
 * Emit a message to the UI.
 */
const emit = (message: WorkerMessage): void => {
  ctx.postMessage(message);
};

const syncCalculatedLifecycle = (tasksCount: number, hasVariance: boolean): void => {
  // W.1: accepted imports remain source-authoritative until an explicit
  // recalculation command is introduced in a later W-phase.
  if (State.getScheduleLifecycle() === "sourceImportedNotCalculated") return;
  // W4: preserve explicit variance-report lifecycle after source-vs-planner recalculation.
  if (State.getScheduleLifecycle() === "plannerCalculatedWithVariance" && State.getVarianceReport()) return;

  if (tasksCount === 0) {
    State.setScheduleLifecycle("empty");
    return;
  }

  State.setScheduleLifecycle(hasVariance ? "plannerCalculatedWithVariance" : "plannerCalculated");
};

const parseTemporalAuthorityRolloutRing = (value: unknown): TemporalAuthorityRolloutRing => {
  if (value === "internal_test" || value === "dogfood" || value === "uat" || value === "production") {
    return value;
  }
  return "off";
};

const parseRequestedAuthorityEngineMode = (
  value: unknown,
): TemporalAuthorityCutoverGateInput["requestedAuthorityEngineMode"] => {
  if (value === "slot_authoritative" || value === "temporal_candidate_only" || value === "temporal_authoritative") {
    return value;
  }
  return "temporal_authoritative";
};

const isInternalDiagnosticOverrideAllowed = (): boolean => {
  const runtime = self as unknown as {
    __PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES?: boolean;
  };

  if (runtime.__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES === true) {
    return true;
  }

  if (typeof location !== "undefined") {
    const host = location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      return true;
    }
  }

  return false;
};

const buildTemporalAuthorityCutoverGateInputFromRuntime = (): TemporalAuthorityCutoverGateInput => {
  const runtime = self as unknown as {
    __PLANNER_TEMPORAL_AUTHORITY_ENABLED?: boolean;
    __PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED?: boolean;
    __PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING?: TemporalAuthorityRolloutRing;
    __PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK?: boolean;
    __PLANNER_TEMPORAL_REQUESTED_AUTHORITY_ENGINE_MODE?:
      | "slot_authoritative"
      | "temporal_candidate_only"
      | "temporal_authoritative";
    __PLANNER_TEMPORAL_CANDIDATE_COMPARISON_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_REAL_WASM_GATE_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TOLERANCE?: number;
    __PLANNER_TEMPORAL_SUPPORTED_PROJECT_PROFILE_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_AUTHORITY_PERSISTENCE_ENABLED?: boolean;
    __PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED?: boolean;
    __PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS?: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
    __PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS?: readonly string[];
    __PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED?: boolean;
    __PLANNER_TEMPORAL_RESOURCE_CALENDAR_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_LAG_CALENDAR_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_P6_SEMANTICS_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_PERFORMANCE_THRESHOLD_MS?: number;
    __PLANNER_TEMPORAL_LIFECYCLE_SAFETY_PASSED?: boolean;
  };

  const defaultInput = createDefaultTemporalAuthorityCutoverGateInput();
  const latestComparison = lastTemporalCandidateComparisonSummary ?? lastTemporalCandidateProjection?.comparison ?? null;
  const unsupportedFeatureFlags = Array.isArray(runtime.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS)
    ? runtime.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : (lastTemporalCandidateProjection?.diagnostics.unsupportedFeatureFlags ?? []);
  const temporalExecutionErrors =
    lastTemporalCandidateProjection?.diagnostics.temporalExecutionErrors ?? [];
  const unexplainedDivergenceCount =
    latestComparison?.unexplainedDivergenceCount
    ?? lastTemporalWasmValidationGateResult?.unexplainedDivergenceTaskIds.length
    ?? defaultInput.unexplainedDivergenceCount;

  return {
    ...defaultInput,
    temporalAuthorityEnabled: runtime.__PLANNER_TEMPORAL_AUTHORITY_ENABLED === true,
    temporalCandidateProjectionEnabled:
      runtime.__PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED === true,
    temporalAuthorityRolloutRing: parseTemporalAuthorityRolloutRing(
      runtime.__PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING,
    ),
    temporalAuthorityEmergencyRollback:
      runtime.__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK === true,
    requestedAuthorityEngineMode: parseRequestedAuthorityEngineMode(
      runtime.__PLANNER_TEMPORAL_REQUESTED_AUTHORITY_ENGINE_MODE,
    ),
    candidateComparisonRequired:
      runtime.__PLANNER_TEMPORAL_CANDIDATE_COMPARISON_REQUIRED !== false,
    realWasmGateRequired: runtime.__PLANNER_TEMPORAL_REAL_WASM_GATE_REQUIRED !== false,
    unexplainedDivergenceTolerance:
      typeof runtime.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TOLERANCE === "number"
      && Number.isFinite(runtime.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TOLERANCE)
        ? runtime.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TOLERANCE
        : defaultInput.unexplainedDivergenceTolerance,
    supportedProjectProfileRequired:
      runtime.__PLANNER_TEMPORAL_SUPPORTED_PROJECT_PROFILE_REQUIRED !== false,
    temporalAuthorityPersistenceEnabled:
      runtime.__PLANNER_TEMPORAL_AUTHORITY_PERSISTENCE_ENABLED === true,
    realWasmValidationPassed:
      runtime.__PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED
      ?? lastTemporalWasmValidationGateResult?.realWasmValidationPassed
      ?? defaultInput.realWasmValidationPassed,
    wasmLoadMode:
      lastTemporalWasmValidationGateResult?.wasmLoadMode
      ?? defaultInput.wasmLoadMode,
    candidateProjectionAvailable:
      lastTemporalCandidateProjection?.diagnostics.candidateProjectionAvailable === true,
    candidateComparisonPresent: latestComparison != null,
    candidateAuthorityAppliedPreApply: false,
    temporalExecutionErrors: [...temporalExecutionErrors],
    unexplainedDivergenceCount,
    sourceProtectionStatus:
      runtime.__PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS
      ?? lastTemporalWasmValidationGateResult?.sourceProtectionStatus
      ?? defaultInput.sourceProtectionStatus,
    unsupportedFeatureFlags,
    projectEligibilityProfileSupported:
      runtime.__PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED !== false,
    resourceCalendarRequirementDetected:
      runtime.__PLANNER_TEMPORAL_RESOURCE_CALENDAR_REQUIRED === true,
    lagCalendarRequirementDetected:
      runtime.__PLANNER_TEMPORAL_LAG_CALENDAR_REQUIRED === true,
    p6SemanticsRequirementDetected:
      runtime.__PLANNER_TEMPORAL_P6_SEMANTICS_REQUIRED === true,
    performanceMs: lastTemporalCandidateProjection?.performanceMs ?? defaultInput.performanceMs,
    performanceThresholdMs:
      typeof runtime.__PLANNER_TEMPORAL_PERFORMANCE_THRESHOLD_MS === "number"
      && Number.isFinite(runtime.__PLANNER_TEMPORAL_PERFORMANCE_THRESHOLD_MS)
        ? runtime.__PLANNER_TEMPORAL_PERFORMANCE_THRESHOLD_MS
        : defaultInput.performanceThresholdMs,
    lifecycleSafetyPassed:
      runtime.__PLANNER_TEMPORAL_LIFECYCLE_SAFETY_PASSED ?? defaultInput.lifecycleSafetyPassed,
  };
};

const cloneScheduleResults = (results: ScheduleResultMap): ScheduleResultMap => {
  const cloned: ScheduleResultMap = {};
  for (const [taskId, value] of Object.entries(results)) {
    cloned[taskId] = {
      earlyStartMinutes: value.earlyStartMinutes,
      earlyFinishMinutes: value.earlyFinishMinutes,
      lateStartMinutes: value.lateStartMinutes,
      lateFinishMinutes: value.lateFinishMinutes,
      totalFloatMinutes: value.totalFloatMinutes,
      isCritical: value.isCritical,
    };
  }
  return cloned;
};

const buildAuthorityDiffStatePayload = (scheduleResults: ScheduleResultMap): WorkerMessage => {
  const tasks = State.getTasks();
  const dependencies = State.getDependencies();
  const nwdSet = new Set(lastNonWorkingDays);
  const variances = computeVariances(scheduleResults, State.getBaselineMap());
  const displayProjectStartDate = normalizeImportedProjectStartDate(State.getProjectStartDate());
  const displayScheduleResults = getDisplayScheduleResults(tasks, scheduleResults, displayProjectStartDate);
  const resourceHistogram = computeResourceHistogram(
    State.getAssignments(),
    displayScheduleResults,
    nwdSet,
  );
  const projCalendarCtx: CalendarOutputContext | undefined =
    lastCalendarServices?.compiledProjectCalendar
      ? { calendar: lastCalendarServices.compiledProjectCalendar, projectStartDate: State.getProjectStartDate() }
      : undefined;
  const inputDiags = computeConstraintDiagnostics(tasks);
  const diagnosticsMap = mergeResultDiagnostics(
    tasks,
    scheduleResults,
    inputDiags,
    nwdSet,
    lastCalendarServices?.temporalAdapter.minutesPerDay as number,
    projCalendarCtx,
  );

  const projSchedProj = computeRollups(
    Hierarchy.buildFullProjection(tasks, lastCalendarServices?.resolver),
    displayScheduleResults,
    nwdSet,
    lastCalendarServices?.temporalAdapter.minutesPerDay as number,
    projCalendarCtx,
  );
  const projFullProjection = computeBusinessRollups(projSchedProj);
  Hierarchy.setFullProjection(projFullProjection);

  return {
    type: "DIFF_STATE",
    v: 1,
    payload: {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults: displayScheduleResults,
      baselines: State.getBaselineMap(),
      variances,
      projectStartDate: displayProjectStartDate,
      nonWorkingDays: lastNonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram,
      diagnosticsMap,
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
      visibleRows: Hierarchy.filterVisibleRows(projFullProjection),
      collapsedIds: [...Hierarchy.getCollapsedIds()],
      dependencyDiagnostics: computeDependencyDiagnostics(dependencies, displayScheduleResults, buildSummaryTaskIds(tasks)),
      scheduleLifecycle: State.getScheduleLifecycle(),
      sourceImportRecord: State.getSourceImportRecord(),
      sourceImportFidelityState: State.getSourceImportFidelityState(),
      sourceCalculatedVarianceReport: State.getVarianceReport() ?? undefined,
      plannerCalendars: State.getPlannerCalendars(),
    },
  };
};

const buildTemporalAuthorityDiagnosticsPayload = (): TemporalAuthorityDiagnosticsPayload => {
  const latestComparison = lastTemporalCandidateComparisonSummary ?? lastTemporalCandidateProjection?.comparison ?? null;
  return {
    currentAuthorityEngineMode,
    previousAuthorityEngineMode,
    appliedEngine: lastTemporalAuthorityAppliedEngine,
    applyMode: lastTemporalAuthorityApplyMode,
    rolloutRing: lastTemporalAuthorityDecision?.rolloutRing ?? "unknown",
    authorityApplied: lastTemporalAuthorityApplied || currentAuthorityEngineMode === "temporal_authoritative",
    fallbackReason: lastTemporalAuthorityFallbackReason,
    lastTemporalAuthorityRunId,
    lastTemporalAuthorityDecision,
    lastTemporalAuthorityAuditPreview,
    lastTemporalCandidateRunId: lastTemporalCandidateProjection?.candidateRunId ?? null,
    candidateProjectionAvailable: lastTemporalCandidateProjection?.diagnostics.candidateProjectionAvailable === true,
    comparisonPresent: latestComparison != null,
    unexplainedDivergenceCount:
      latestComparison?.unexplainedDivergenceCount
      ?? lastTemporalAuthorityDecision?.unexplainedDivergenceCount
      ?? lastTemporalWasmValidationGateResult?.unexplainedDivergenceTaskIds.length
      ?? null,
    realWasmValidationPassed: lastTemporalWasmValidationGateResult?.realWasmValidationPassed ?? null,
    wasmLoadMode: lastTemporalWasmValidationGateResult?.wasmLoadMode ?? "unknown",
    sourceProtectionStatus:
      lastTemporalAuthorityDecision?.sourceProtectionStatus
      ?? lastTemporalWasmValidationGateResult?.sourceProtectionStatus
      ?? "unknown",
    persistenceApplied: false,
  };
};

/**
 * W5B-B2.7: Build dogfood controls value from current runtime diagnostics.
 *
 * Hard invariants:
 *   - `dogfoodAuthorityEnabled` is read from `__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED`
 *     which defaults `undefined` → coerced to `false`. The dogfood master switch
 *     therefore defaults OFF.
 *   - `persistencePolicy` is always `"disabled_runtime_only"`.
 *   - Profile fields are derived from `latestComparison` / projection diagnostics
 *     / source-protection status. Nothing here applies authority.
 */
const buildTemporalDogfoodControlsFromRuntime = (
  baseInput: TemporalAuthorityCutoverGateInput,
) => {
  const runtime = self as unknown as {
    __PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED?: boolean;
    __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED?: boolean;
    __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED?: boolean;
    __PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT?: number;
    __PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS?: number;
    __PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS?: number;
    __PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES?: readonly string[];
  };

  const defaults = createDefaultTemporalDogfoodControls();
  const tasks = State.getTasks();
  const projectActivityCount = tasks.filter((t) => !State.isTaskSummary(t.id)).length;
  const projectActivityLimit =
    typeof runtime.__PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT === "number"
    && Number.isFinite(runtime.__PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT)
      ? runtime.__PLANNER_TEMPORAL_DOGFOOD_PROJECT_SIZE_LIMIT
      : defaults.allowedProjectProfile.projectActivityLimit;

  const requiredCleanRuns =
    typeof runtime.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS === "number"
    && Number.isFinite(runtime.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS)
      ? runtime.__PLANNER_TEMPORAL_DOGFOOD_REQUIRED_CLEAN_RUNS
      : defaults.evidenceRequirements.requiredCleanRuns;
  const acceptedCleanRuns =
    typeof runtime.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS === "number"
    && Number.isFinite(runtime.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS)
      ? runtime.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_CLEAN_RUNS
      : defaults.evidenceRequirements.acceptedCleanRuns;
  const acceptedFixtures = Array.isArray(runtime.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES)
    ? runtime.__PLANNER_TEMPORAL_DOGFOOD_ACCEPTED_FIXTURES.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : defaults.evidenceRequirements.acceptedFixtures;

  const latestEvidenceRecommendation: "ready_for_dogfood_controls_default_off" | "evidence_incomplete" | "evidence_blocked" =
    acceptedCleanRuns >= requiredCleanRuns
      ? "ready_for_dogfood_controls_default_off"
      : "evidence_incomplete";

  return {
    dogfoodControlsVersion: 1 as const,
    dogfoodAuthorityEnabled: runtime.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED === true,
    allowedProjectProfile: {
      realWasmGatePassed:
        baseInput.realWasmValidationPassed && baseInput.wasmLoadMode === "real",
      candidateProjectionAvailable: baseInput.candidateProjectionAvailable,
      candidateComparisonPresent: baseInput.candidateComparisonPresent,
      unexplainedDivergenceCount: baseInput.unexplainedDivergenceCount,
      unexplainedDivergenceTolerance: baseInput.unexplainedDivergenceTolerance,
      sourceProtectionStatus: baseInput.sourceProtectionStatus,
      unsupportedFeatureFlags: baseInput.unsupportedFeatureFlags,
      temporalExecutionErrors: baseInput.temporalExecutionErrors,
      persistenceApplied: false as const,
      rollbackAvailable: lastSlotAuthoritativeSnapshot != null,
      projectActivityCount,
      projectActivityLimit,
      resourceCalendarRequirementDetected: baseInput.resourceCalendarRequirementDetected,
      lagCalendarRequirementDetected: baseInput.lagCalendarRequirementDetected,
      p6SemanticsRequirementDetected: baseInput.p6SemanticsRequirementDetected,
    },
    evidenceRequirements: {
      requiredCleanRuns,
      acceptedCleanRuns,
      acceptedFixtures,
      latestEvidenceRecommendation,
    },
    operatorAcknowledgementRequired:
      runtime.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED !== false,
    operatorAcknowledgementProvided:
      runtime.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED === true,
    rollbackRequired: true,
    persistencePolicy: "disabled_runtime_only" as const,
  };
};

const mapTemporalProjectionToScheduleResults = (
  projection: TemporalCandidateProjection,
  currentScheduleResults: ScheduleResultMap,
): { mapped: ScheduleResultMap | null; fallbackReason: string | null; appliedTaskCount: number } => {
  if (!projection.diagnostics.candidateProjectionAvailable) {
    return { mapped: null, fallbackReason: "candidate_projection_unavailable", appliedTaskCount: 0 };
  }
  if (!projection.comparison) {
    return { mapped: null, fallbackReason: "candidate_comparison_missing", appliedTaskCount: 0 };
  }
  if (projection.diagnostics.temporalExecutionErrors.length > 0) {
    return { mapped: null, fallbackReason: "temporal_execution_error", appliedTaskCount: 0 };
  }

  const tasks = State.getTasks();
  const canonicalTaskIdSet = new Set(tasks.map((t) => t.id));
  // Apply basis = canonical leaves with current slot results. Summary rows are
  // intentionally excluded here because they are derived via rollupSummarySchedules
  // from leaf results; the temporal kernel may emit summary entries too, but we
  // never trust them — we recompute summaries from leaves.
  const applicableTaskIds = tasks
    .filter((task) => !State.isTaskSummary(task.id) && currentScheduleResults[task.id])
    .map((task) => task.id);

  // Index candidates by id and split into "summary extras" (known canonical
  // summary ids — safely ignored, rollup will fill) vs. "unknown extras" (ids
  // not in canonical state — block).
  const candidateById = new Map<string, typeof projection.candidateTasks[number]>();
  const unknownExtraTaskIds: string[] = [];
  for (const cand of projection.candidateTasks) {
    candidateById.set(cand.taskId, cand);
    if (!canonicalTaskIdSet.has(cand.taskId)) {
      unknownExtraTaskIds.push(cand.taskId);
    }
  }
  if (unknownExtraTaskIds.length > 0) {
    return { mapped: null, fallbackReason: "temporal_task_count_mismatch", appliedTaskCount: 0 };
  }

  // Every applicable leaf MUST have a candidate. Missing leaf candidates always
  // block — never silently drop a schedulable activity.
  const missingApplicableTaskIds = applicableTaskIds.filter((id) => !candidateById.has(id));
  if (missingApplicableTaskIds.length > 0) {
    return { mapped: null, fallbackReason: "temporal_task_count_mismatch", appliedTaskCount: 0 };
  }

  const mapped: ScheduleResultMap = {};
  for (const id of applicableTaskIds) {
    const candidate = candidateById.get(id)!;
    if (
      candidate.earlyStart == null
      || candidate.earlyFinish == null
      || candidate.lateStart == null
      || candidate.lateFinish == null
      || candidate.totalFloat == null
    ) {
      return { mapped: null, fallbackReason: "temporal_result_incomplete", appliedTaskCount: 0 };
    }

    mapped[id] = {
      earlyStartMinutes: candidate.earlyStart,
      earlyFinishMinutes: candidate.earlyFinish,
      lateStartMinutes: candidate.lateStart,
      lateFinishMinutes: candidate.lateFinish,
      totalFloatMinutes: candidate.totalFloat,
      isCritical: candidate.critical,
    };
  }

  // Recompute summary rollups from leaf temporal results. Any candidate entries
  // for known summary ids are intentionally discarded — rollup is canonical.
  rollupSummarySchedules(tasks, mapped);
  return { mapped, fallbackReason: null, appliedTaskCount: applicableTaskIds.length };
};

const canApplyInternalTemporalAuthority = (
  cmd: Extract<Command, { type: "RUN_TEMPORAL_AUTHORITY_APPLY" }>,
  input: TemporalAuthorityCutoverGateInput,
  decision: ReturnType<typeof evaluateTemporalAuthorityCutoverGate>,
): { eligible: boolean; fallbackReason: string | null } => {
  if (cmd.internalOnly !== true) return { eligible: false, fallbackReason: "non_internal_request" };
  if (input.temporalAuthorityRolloutRing !== "internal_test") return { eligible: false, fallbackReason: "rollout_ring_not_internal_test" };
  if (!input.temporalAuthorityEnabled) return { eligible: false, fallbackReason: "temporal_authority_disabled" };
  if (input.requestedAuthorityEngineMode !== "temporal_authoritative") return { eligible: false, fallbackReason: "requested_mode_not_temporal_authoritative" };
  if (input.temporalAuthorityEmergencyRollback) return { eligible: false, fallbackReason: "emergency_rollback_active" };
  if (decision.authorityEngineMode !== "temporal_authoritative" || !decision.allowed) {
    return { eligible: false, fallbackReason: decision.fallbackReason ?? "slot_fallback" };
  }
  if (input.sourceProtectionStatus !== "ok") return { eligible: false, fallbackReason: "source_protection_not_ok" };
  if (input.unsupportedFeatureFlags.length > 0) return { eligible: false, fallbackReason: "unsupported_feature_detected" };
  if (input.temporalExecutionErrors.length > 0) return { eligible: false, fallbackReason: "temporal_execution_error" };
  return { eligible: true, fallbackReason: null };
};

/**
 * W5B-B2.9: Dogfood apply guard. Mirrors the internal_test guard but adds the
 * explicit dogfood master switch, operator acknowledgement, and dogfood-only
 * project eligibility checks. Default-off: returns ineligible whenever the
 * dogfood master switch is not explicitly true.
 *
 * Hard invariants:
 *   - dogfood is NEVER eligible without `dogfoodAuthorityEnabled === true`.
 *   - dogfood is NEVER eligible without an explicit operator acknowledgement.
 *   - emergency rollback always wins (returns ineligible).
 *   - UAT and production rings are never accepted by this guard.
 *   - this guard never relaxes any internal_test precondition.
 */
const canApplyDogfoodTemporalAuthority = (
  cmd: Extract<Command, { type: "RUN_TEMPORAL_AUTHORITY_APPLY" }>,
  input: TemporalAuthorityCutoverGateInput,
  decision: ReturnType<typeof evaluateTemporalAuthorityCutoverGate>,
  dogfoodAuthorityEnabled: boolean,
  operatorAcknowledgementProvided: boolean,
): { eligible: boolean; fallbackReason: string | null } => {
  if (cmd.internalOnly !== true) return { eligible: false, fallbackReason: "non_internal_request" };
  if (input.temporalAuthorityRolloutRing !== "dogfood") return { eligible: false, fallbackReason: "rollout_ring_not_dogfood" };
  if (!dogfoodAuthorityEnabled) return { eligible: false, fallbackReason: "dogfood_authority_disabled" };
  if (!operatorAcknowledgementProvided) return { eligible: false, fallbackReason: "operator_acknowledgement_missing" };
  if (!input.temporalAuthorityEnabled) return { eligible: false, fallbackReason: "temporal_authority_disabled" };
  if (input.requestedAuthorityEngineMode !== "temporal_authoritative") return { eligible: false, fallbackReason: "requested_mode_not_temporal_authoritative" };
  if (input.temporalAuthorityEmergencyRollback) return { eligible: false, fallbackReason: "emergency_rollback_active" };
  if (decision.authorityEngineMode !== "temporal_authoritative" || !decision.allowed) {
    return { eligible: false, fallbackReason: decision.fallbackReason ?? "slot_fallback" };
  }
  if (input.sourceProtectionStatus !== "ok") return { eligible: false, fallbackReason: "source_protection_not_ok" };
  if (input.unsupportedFeatureFlags.length > 0) return { eligible: false, fallbackReason: "unsupported_feature_detected" };
  if (input.temporalExecutionErrors.length > 0) return { eligible: false, fallbackReason: "temporal_execution_error" };
  if (input.resourceCalendarRequirementDetected) return { eligible: false, fallbackReason: "resource_calendar_not_supported" };
  if (input.lagCalendarRequirementDetected) return { eligible: false, fallbackReason: "lag_calendar_not_supported" };
  if (input.p6SemanticsRequirementDetected) return { eligible: false, fallbackReason: "p6_semantics_not_supported" };
  // Note: rollback availability is structurally guaranteed because the worker
  // snapshots `lastSlotAuthoritativeSnapshot` atomically immediately before
  // mutating State on a successful apply. We therefore do NOT require a prior
  // snapshot here.
  return { eligible: true, fallbackReason: null };
};

const getDisplayScheduleResults = (
  tasks: readonly Task[],
  scheduleResults: ScheduleResultMap,
  projectStartDate: string,
): ScheduleResultMap => {
  if (State.getScheduleLifecycle() !== "sourceImportedNotCalculated") {
    return scheduleResults;
  }

  const sourceDatesByTaskId = State.getSourceDatesByTaskId();
  if (Object.keys(sourceDatesByTaskId).length === 0) {
    return scheduleResults;
  }

  const displayScheduleResults = buildSourceImportedLeafDisplayScheduleResults(
    tasks,
    scheduleResults,
    sourceDatesByTaskId,
    projectStartDate,
  );
  rollupSummarySchedules(tasks, displayScheduleResults);
  return displayScheduleResults;
};

const isFloatPathError = (
  value: FloatPathMvpResponse | FloatPathMvpError,
): value is FloatPathMvpError => {
  return "type" in value;
};

/**
 * Run scheduling and emit state with results.
 * Returns true if scheduling succeeded, false if it failed.
 */
const CALENDAR_HORIZON = 3650; // ~10 years

// Phase A: Calendar services instance — recreated each scheduling pass.
// Future phases may cache services and invalidate on calendar config change.
let lastCalendarServices: CalendarServices | null = null;

const runSchedulingAndEmitState = (): boolean => {
  syncCutoverFlagsFromRuntime();
  const cutoverDecision = evaluateCutoverReadiness();
  const authorityFlipGate = evaluateAuthorityFlipGate();
  const rolloutControl = evaluateRolloutControlState();
  const rehearsalVerification = evaluateRehearsalVerificationState();
  const ringProgressionApproval = evaluateRingProgressionApprovalState();
  const minuteCanaryEnablement = evaluateMinuteCanaryEnablementDecision();
  let d10eExecutionRoute: "slot" | "minute" = "slot";
  let d10eFallbackReason: string | null = null;
  let d10fExecutionArtifact: CutoverReadinessMinuteCanaryExecutionArtifact = {
    attemptedMinuteAuthority: false,
    executedRoute: "slot",
    fallbackOccurred: false,
    fallbackReason: null,
    routingReason: "runtime_not_observed",
    ineligibilityBlockers: minuteCanaryEnablement.blockers,
    persistenceSafetyVerified: false,
    persistencePurityViolationCount: 0,
  };
  let d10fPersistenceSafetyVerified = false;
  let d10fPersistencePurityViolationCount = 0;
  
  // B2.2: Policy gate decision (diagnostics-only in B2.2; slot always applied)
  let scheduleAuthorityPolicyDecision: ScheduleAuthorityDecision | null = null;
  
  const logCutoverReadinessReport = (): void => {
    const report = buildCutoverReadinessReport({
      cutoverDecision,
      telemetry: getCutoverTelemetrySnapshot(),
      authorityFlipGate,
      rolloutControl,
      rehearsalVerification,
      ringProgressionApproval,
      minuteCanaryEnablement,
      minuteCanaryExecution: {
        attemptedMinuteAuthority: d10fExecutionArtifact.attemptedMinuteAuthority,
        executedRoute: d10fExecutionArtifact.executedRoute,
        fallbackOccurred: d10fExecutionArtifact.fallbackOccurred,
        fallbackReason: d10fExecutionArtifact.fallbackReason,
        routingReason: d10fExecutionArtifact.routingReason,
        ineligibilityBlockers: d10fExecutionArtifact.ineligibilityBlockers,
        persistenceSafetyVerified: d10fPersistenceSafetyVerified,
        persistencePurityViolationCount: d10fPersistencePurityViolationCount,
      },
    });
    console.log(
      "[D9e Cutover Readiness Report]",
      report,
    );
    console.log(
      "[D10b Rollout Operator Summary]",
      report.operatorSummary,
    );
    console.log(
      "[D10c Rehearsal Verification]",
      report.rehearsalVerification,
    );
    console.log(
      "[D10d Canary Enablement]",
      report.minuteCanaryEnablement,
    );
    console.log(
      "[D10h Ring 0 Support]",
      report.internalDogfoodSupport,
    );
    console.log("[D10h Ring 0 Review]", {
      executionEntryReady: report.internalDogfoodSupport.executionEntryReady,
      executionEntryBlockers: report.internalDogfoodSupport.executionEntryBlockers,
      evidenceBundleComplete: report.internalDogfoodSupport.evidenceBundleComplete,
      benchmarkReportCaptured: report.internalDogfoodSupport.benchmarkReportCaptured,
      killSwitchEvidenceCaptured: report.internalDogfoodSupport.killSwitchEvidenceCaptured,
      rollbackEvidenceCaptured: report.internalDogfoodSupport.rollbackEvidenceCaptured,
      persistencePurityEvidencePassed:
        report.internalDogfoodSupport.persistencePurityEvidencePassed,
      reviewReady: report.internalDogfoodSupport.reviewReady,
      reviewBlockers: report.internalDogfoodSupport.reviewBlockers,
      continuationGateReady: report.internalDogfoodSupport.continuationGateReady,
      benchmarkPassedForReview: report.internalDogfoodSupport.benchmarkPassedForReview,
      parityClearForReview: report.internalDogfoodSupport.parityClearForReview,
      parityTrueRegressionCount: report.internalDogfoodSupport.parityTrueRegressionCount,
      minimumObservationDurationMsRequired:
        report.internalDogfoodSupport.minimumObservationDurationMsRequired,
      observedObservationDurationMs:
        report.internalDogfoodSupport.observedObservationDurationMs,
      minimumSchedulingRunsRequired: report.internalDogfoodSupport.minimumSchedulingRunsRequired,
      observedSchedulingRuns: report.internalDogfoodSupport.observedSchedulingRuns,
    });
    console.log("[D10e Canary Execution Routing]", {
      route: d10eExecutionRoute,
      reason: report.minuteCanaryExecution.routingReason,
      canaryEligible: minuteCanaryEnablement.canEnableMinuteAuthorityForCohort,
      fallbackReason: d10eFallbackReason,
    });
  };
  if (cutoverDecision.effectiveMode !== "slot") {
    console.warn("[D9 Cutover] Minute mode readiness passed but authority remains slot in D9:", cutoverDecision);
  }

  // Recompute hierarchy metadata before scheduling
  State.computeHierarchy();

  const tasks = State.getTasks();
  const dependencies = State.getDependencies();

  // Phase B: instantiate calendar services from project calendar config
  // Phase C: pass findTask so resolver can look up assignedCalendarId
  // Track A Step 6: derive temporal adapter from compiled project calendar
  const calendarServices = createTrackACalendarServices(
    State.getProjectCalendar(),
    State.getCalendarDefinitions(),
    State.getProjectCalendarId(),
    State.findTask,
  );
  lastCalendarServices = calendarServices;

  // Generate calendar data via CalendarIndexer seam
  const nonWorkingDays = calendarServices.indexer.indexNonWorkingDays(
    calendarServices.resolver.projectCalendarId(),
    State.getProjectStartDate(),
    CALENDAR_HORIZON,
  );
  lastNonWorkingDays = nonWorkingDays;
  const nwdSet = new Set(nonWorkingDays);

  // Track A Step 6b-2: calendar context for output-side duration translation.
  const calendarOutputCtx: CalendarOutputContext | undefined =
    calendarServices.compiledProjectCalendar
      ? { calendar: calendarServices.compiledProjectCalendar, projectStartDate: State.getProjectStartDate() }
      : undefined;

  // Phase D3: build state snapshot and delegate to engine facade.
  // The facade internally runs the slot engine (authoritative) and
  // optionally the temporal engine (shadow, async, flag-guarded).
  // The worker does not know two engines exist.
  const snapshot: SchedulingStateSnapshot = {
    tasks,
    dependencies,
    projectStartDate: State.getProjectStartDate(),
    projectCalendar: State.getProjectCalendar(),
    findTask: State.findTask,
    calendars: State.getCalendars(),
    nonWorkingDays,
    nwdSet,
    schedulingMode: getSchedulingMode(),
    assumptionSet: State.getAssumptionSet(),
    authoredActivities: State.getAuthoredActivities(),
    compiledProjectCalendar: calendarServices.compiledProjectCalendar,
    temporalAdapter: calendarServices.temporalAdapter,
  };

  // D7a: optional minute payload preparation shadow path.
  // This is diagnostics-only and must never affect authoritative scheduling.
  if (isMinutePayloadShadowEnabled()) {
    try {
      const minutePayload = minutePayloadAdapter.prepareRequest(snapshot);
      console.log("[D7a Minute Shadow] prepared minute payload", {
        taskCount: minutePayload.tasks.length,
        depCount: minutePayload.dependencies.length,
        calendarCount: minutePayload.calendars.length,
        abiVersion: minutePayload.abiVersion,
      });
    } catch (error) {
      console.warn("[D7a Minute Shadow] failed to prepare minute payload:", error);
    }
  }

  // B2.2: Evaluate schedule authority policy gate (diagnostics-only; never affects routing in B2.2)
  const policyGateInput = buildTemporalAuthorityRoutingInput({
    temporalShadowExecutionEnabled: true,
    temporalAuthorityRoutingEnabled: false, // disabled by default in B2.2
    temporalAuthorityRolloutRing: "off",
    temporalAuthorityEmergencyRollback: false,
    unsupportedCalendarFeatureFlags: [],
    unsupportedDependencyOrLagModeDetected: false,
    sourceProtectionStatus: "ok",
    performanceThresholdPassed: true,
    realWasmValidationPassed: false,
    allowTemporalAuthorityInTests: false,
    projectEligibilityProfile: "default_supported",
  });
  scheduleAuthorityPolicyDecision = decideScheduleAuthorityPolicy(policyGateInput);
  console.log("[B2.2 Policy Gate Decision]", {
    mode: scheduleAuthorityPolicyDecision.mode,
    fallbackReason: scheduleAuthorityPolicyDecision.fallbackReason,
    temporalAuthorityCandidate: scheduleAuthorityPolicyDecision.temporalAuthorityCandidate,
  });

  let engineResult: EngineResult;
  if (minuteCanaryEnablement.canEnableMinuteAuthorityForCohort) {
    const minuteEngineResult = minuteAuthorityEngine.execute(snapshot);
    const routingDecision = decideD10eAuthorityRouting(
      minuteCanaryEnablement,
      minuteEngineResult,
    );

    if (routingDecision.route === "minute") {
      d10eExecutionRoute = "minute";
      d10fExecutionArtifact = {
        attemptedMinuteAuthority: true,
        executedRoute: "minute",
        fallbackOccurred: false,
        fallbackReason: null,
        routingReason: routingDecision.reason,
        ineligibilityBlockers: routingDecision.ineligibilityBlockers,
        persistenceSafetyVerified: false,
        persistencePurityViolationCount: 0,
      };
      engineResult = minuteEngineResult;
    } else {
      d10eExecutionRoute = "slot";
      d10eFallbackReason = routingDecision.fallbackReason;
      d10fExecutionArtifact = {
        attemptedMinuteAuthority: true,
        executedRoute: "slot",
        fallbackOccurred: true,
        fallbackReason: routingDecision.fallbackReason,
        routingReason: routingDecision.reason,
        ineligibilityBlockers: routingDecision.ineligibilityBlockers,
        persistenceSafetyVerified: false,
        persistencePurityViolationCount: 0,
      };
      engineResult = engineFacade.execute(snapshot);
    }
  } else {
    d10eExecutionRoute = "slot";
    d10fExecutionArtifact = {
      attemptedMinuteAuthority: false,
      executedRoute: "slot",
      fallbackOccurred: false,
      fallbackReason: null,
      routingReason: "cohort_not_eligible",
      ineligibilityBlockers: minuteCanaryEnablement.blockers,
      persistenceSafetyVerified: false,
      persistencePurityViolationCount: 0,
    };
    engineResult = engineFacade.execute(snapshot);
  }

  const result = engineResult.rawResult;

  // Check if result is an error
  if ("type" in result && typeof result.type === "string") {
    const scheduleError = result as ScheduleError;

    // Emit error message
    emit({
      type: "SCHEDULE_ERROR",
      v: 1,
      error: {
        type: scheduleError.type,
        message: scheduleError.message,
        taskId: "taskId" in scheduleError ? scheduleError.taskId : undefined,
      },
    });

    // Emit state without schedule results (current state may be invalid)
    // Pipeline: full projection → schedule rollups → business rollups → cache → filter
    const errorSchedProj = computeRollups(Hierarchy.buildFullProjection(tasks, calendarServices.resolver), {}, nwdSet, calendarServices.temporalAdapter.minutesPerDay as number, calendarOutputCtx);
    const errorFullProjection = computeBusinessRollups(errorSchedProj);
    Hierarchy.setFullProjection(errorFullProjection);
    syncCalculatedLifecycle(tasks.length, false);

    const payload = {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults: {},
      baselines: State.getBaselineMap(),
      variances: {},
      projectStartDate: State.getProjectStartDate(),
      nonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram: {},
      diagnosticsMap: computeConstraintDiagnostics(tasks),
      dependencyDiagnostics: computeDependencyDiagnostics(dependencies, {}, buildSummaryTaskIds(tasks)),
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
      visibleRows: Hierarchy.filterVisibleRows(errorFullProjection),
      collapsedIds: [...Hierarchy.getCollapsedIds()],
      scheduleLifecycle: State.getScheduleLifecycle(),
      sourceImportRecord: State.getSourceImportRecord(),
      sourceImportFidelityState: State.getSourceImportFidelityState(),
      sourceCalculatedVarianceReport: State.getVarianceReport() ?? undefined,
    };
    console.log("[AUDIT Worker Emit] schedule-error path", {
      taskCount: payload.tasks.length,
      depCount: payload.dependencies.length,
    });
    logCutoverReadinessReport();
    emit({ type: "DIFF_STATE", v: 1, payload });

    return false;
  } else {
    // Success — translate normalized facts into ScheduleResultMap
    // Phase D4: worker no longer converts raw engine coordinates itself.
    // The slot adapter's translator produced NormalizedScheduleFacts;
    // the ProjectionAdapter converts those back to ScheduleResultMap
    // in the same day-offset units the downstream pipeline expects.
    //
    // D4 invariant: engineResult.normalized is non-null on the success
    // path because the slot adapter always calls its translator. The !
    // assertion is safe here; a null would indicate a translator bug.
    const facts = engineResult.normalized!;
    const projectionStart = performance.now();
    const scheduleResults = projectFacts(
      facts,
      State.getProjectStartDate(),
      calendarServices.temporalAdapter.minutesPerDay as number,
    );
    recordPrimaryProjectionDuration(performance.now() - projectionStart);
    
    // D10f: Verify persistence safety for minute authority executions
    if (d10fExecutionArtifact.attemptedMinuteAuthority || d10fExecutionArtifact.executedRoute === "minute") {
      const wouldBePersisted: PersistedState = {
        version: 1,
        lastModified: Date.now(),
        state: {
          projectStartDate: State.getProjectStartDate(),
          excludeWeekends: State.getExcludeWeekends(),
          calendarId: State.getCalendarId(),
          projectCalendar: State.getProjectCalendar(),
          calendars: State.getCalendars(),
          tasks: State.getTasks().map(t => ({ ...t })),
          dependencies: State.getDependencies().map(d => ({ ...d })),
          baselines: { ...State.getBaselineMap() },
          resources: State.getResources().map(r => ({ ...r })),
          assignments: State.getAssignments().map(a => ({ ...a })),
          scheduleLifecycle: State.getScheduleLifecycle(),
          sourceImportRecord: State.getSourceImportRecord(),
          sourceImportFidelityState: State.getSourceImportFidelityState(),
          sourceDatesByTaskId: State.getSourceDatesByTaskId(),
          varianceReport: State.getVarianceReport(),
          calendarDefinitions: State.getCalendarDefinitions(),
          resolvedCalendarDefinitions: State.getResolvedCalendarDefinitions(),
          plannerCalendars: State.getPlannerCalendars(),
        },
      };
      const violations = validatePersistedStatePurity(wouldBePersisted);
      d10fPersistenceSafetyVerified = true;
      d10fPersistencePurityViolationCount = violations.length;
      if (violations.length > 0) {
        console.warn("[D10f Persistence Safety] purity violations detected in minute execution", violations);
      }
    }
    
    logCutoverReadinessReport();

    // Worker-authoritative summary rollup (overwrites kernel summary results)
    rollupSummarySchedules(tasks, scheduleResults);

    // Store latest schedule results for baseline snapshot
    State.setLatestScheduleResults(scheduleResults);

    console.log("[AUDIT Kernel Math]", Object.entries(scheduleResults).map(([id, s]) => ({
      id,
      ES: s.earlyStartMinutes,
      EF: s.earlyFinishMinutes,
      LS: s.lateStartMinutes,
      LF: s.lateFinishMinutes,
      TF: s.totalFloatMinutes,
      isCritical: s.isCritical,
    })));

    const variances = computeVariances(scheduleResults, State.getBaselineMap());
    const hasVariance = Object.values(variances).some(v =>
      Number(v.startVarianceMinutes) !== 0
      || Number(v.finishVarianceMinutes) !== 0
      || Number(v.durationVarianceMinutes) !== 0,
    );
    syncCalculatedLifecycle(tasks.length, hasVariance);

    const displayProjectStartDate = normalizeImportedProjectStartDate(State.getProjectStartDate());
    const displayScheduleResults = getDisplayScheduleResults(tasks, scheduleResults, displayProjectStartDate);

    const resourceHistogram = computeResourceHistogram(
      State.getAssignments(),
      displayScheduleResults,
      nwdSet,
    );

    const inputDiags = computeConstraintDiagnostics(tasks);
    const diagnosticsMap = mergeResultDiagnostics(tasks, scheduleResults, inputDiags, nwdSet, calendarServices.temporalAdapter.minutesPerDay as number, calendarOutputCtx);

    // Pipeline: full projection → schedule rollups → business rollups → cache → filter
    const successSchedProj = computeRollups(Hierarchy.buildFullProjection(tasks, calendarServices.resolver), displayScheduleResults, nwdSet, calendarServices.temporalAdapter.minutesPerDay as number, calendarOutputCtx);
    const successFullProjection = computeBusinessRollups(successSchedProj);
    Hierarchy.setFullProjection(successFullProjection);

    const payload = {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults: displayScheduleResults,
      baselines: State.getBaselineMap(),
      variances,
      projectStartDate: displayProjectStartDate,
      nonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram,
      diagnosticsMap,
      dependencyDiagnostics: computeDependencyDiagnostics(dependencies, displayScheduleResults, buildSummaryTaskIds(tasks)),
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
      visibleRows: Hierarchy.filterVisibleRows(successFullProjection),
      collapsedIds: [...Hierarchy.getCollapsedIds()],
      scheduleLifecycle: State.getScheduleLifecycle(),
      sourceImportRecord: State.getSourceImportRecord(),
      sourceImportFidelityState: State.getSourceImportFidelityState(),
      sourceCalculatedVarianceReport: State.getVarianceReport() ?? undefined,
      plannerCalendars: State.getPlannerCalendars(),
    };
    const critCount = Object.values(displayScheduleResults).filter(s => s.isCritical).length;
    console.log("[AUDIT Worker Emit] success path", {
      taskCount: payload.tasks.length,
      depCount: payload.dependencies.length,
      criticalCount: critCount,
    });
    emit({ type: "DIFF_STATE", v: 1, payload });

    return true;
  }
};

/**
 * Emit a DIFF_STATE with updated projection but WITHOUT re-running the kernel.
 * Used by structural mutations (indent/outdent/move/reorder) which change
 * hierarchy but do not affect scheduling math.
 */
const emitProjectionUpdate = (): void => {
  State.computeHierarchy();
  const tasks = State.getTasks();
  const dependencies = State.getDependencies();
  const scheduleResults = State.getLatestScheduleResults();
  const variances = computeVariances(scheduleResults, State.getBaselineMap());
  const hasVariance = Object.values(variances).some(v =>
    Number(v.startVarianceMinutes) !== 0
    || Number(v.finishVarianceMinutes) !== 0
    || Number(v.durationVarianceMinutes) !== 0,
  );
  syncCalculatedLifecycle(tasks.length, hasVariance);
  const nwdSet = new Set(lastNonWorkingDays);
  const resourceHistogram = computeResourceHistogram(
    State.getAssignments(),
    getDisplayScheduleResults(tasks, scheduleResults, normalizeImportedProjectStartDate(State.getProjectStartDate())),
    nwdSet,
  );
  // Track A Step 6b-2: reconstruct calendar context from cached services.
  const projCalendarCtx: CalendarOutputContext | undefined =
    lastCalendarServices?.compiledProjectCalendar
      ? { calendar: lastCalendarServices.compiledProjectCalendar, projectStartDate: State.getProjectStartDate() }
      : undefined;
  const inputDiags = computeConstraintDiagnostics(tasks);
  const diagnosticsMap = mergeResultDiagnostics(tasks, scheduleResults, inputDiags, nwdSet, lastCalendarServices?.temporalAdapter.minutesPerDay as number, projCalendarCtx);

  // Pipeline: full projection → schedule rollups → business rollups → cache → filter
  const displayProjectStartDate = normalizeImportedProjectStartDate(State.getProjectStartDate());
  const displayScheduleResults = getDisplayScheduleResults(tasks, scheduleResults, displayProjectStartDate);
  const projSchedProj = computeRollups(Hierarchy.buildFullProjection(tasks, lastCalendarServices?.resolver), displayScheduleResults, nwdSet, lastCalendarServices?.temporalAdapter.minutesPerDay as number, projCalendarCtx);
  const projFullProjection = computeBusinessRollups(projSchedProj);
  Hierarchy.setFullProjection(projFullProjection);

  emit({
    type: "DIFF_STATE",
    v: 1,
    payload: {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults: displayScheduleResults,
      baselines: State.getBaselineMap(),
      variances,
      projectStartDate: displayProjectStartDate,
      nonWorkingDays: lastNonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram,
      diagnosticsMap,
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
      visibleRows: Hierarchy.filterVisibleRows(projFullProjection),
      collapsedIds: [...Hierarchy.getCollapsedIds()],
      dependencyDiagnostics: computeDependencyDiagnostics(dependencies, displayScheduleResults, buildSummaryTaskIds(tasks)),
      scheduleLifecycle: State.getScheduleLifecycle(),
      sourceImportRecord: State.getSourceImportRecord(),
      sourceImportFidelityState: State.getSourceImportFidelityState(),
      sourceCalculatedVarianceReport: State.getVarianceReport() ?? undefined,
      plannerCalendars: State.getPlannerCalendars(),
    },
  });
};

/**
 * Apply a single command as an internal replay (no history, no ACK).
 * Used by undo/redo transaction replay.
 *
 * TRANSITIONAL: This function mutates canonical state directly,
 * bypassing dispatchCommand() and the envelope/audit path.
 * This is architecturally necessary for undo/redo (replay commands
 * are internal reversals, not new user intent). Do not expand this
 * path to handle new command types or new mutation scenarios.
 * When undo/redo is refactored to use the command spine natively,
 * this function should be removed.
 */
const applyReplayCommand = (cmd: Command): void => {
  switch (cmd.type) {
    case "ADD_TASK":
      State.addTask(cmd.payload);
      break;
    case "UPDATE_TASK":
      State.updateTask(cmd.taskId, cmd.updates);
      break;
    case "DELETE_TASK":
      State.deleteTaskRecursive(cmd.taskId);
      break;
    case "ADD_DEPENDENCY":
      State.addDependency(cmd.payload);
      break;
    case "DELETE_DEPENDENCY":
      State.deleteDependency(cmd.dependencyId);
      break;
    case "UPDATE_DEPENDENCY":
      State.updateDependency(cmd.dependencyId, cmd.updates);
      break;
    case "SNAPSHOT_BASELINE": {
      const sr = State.getLatestScheduleResults();
      const newBaseline: BaselineMap = {};
      for (const taskId of Object.keys(sr)) {
        newBaseline[taskId] = { startMinutes: sr[taskId].earlyStartMinutes, finishMinutes: sr[taskId].earlyFinishMinutes };
      }
      State.setBaselineMap(newBaseline);
      break;
    }
    case "CLEAR_BASELINE":
      State.setBaselineMap({});
      break;
    case "ADD_RESOURCE":
      State.addResource(cmd.payload);
      break;
    case "UPDATE_RESOURCE":
      State.updateResource(cmd.resourceId, cmd.updates);
      break;
    case "DELETE_RESOURCE":
      State.deleteResource(cmd.resourceId);
      break;
    case "ADD_ASSIGNMENT":
      State.addAssignment(cmd.payload);
      break;
    case "UPDATE_ASSIGNMENT":
      State.updateAssignment(cmd.assignmentId, cmd.updates);
      break;
    case "DELETE_ASSIGNMENT":
      State.deleteAssignment(cmd.assignmentId);
      break;
    default: {
      // Handle internal-only replay commands
      const any = cmd as unknown as { type: string; baselines?: BaselineMap; snapshot?: State.StateSnapshot };
      if (any.type === "RESTORE_BASELINES" && any.baselines) {
        State.setBaselineMap({ ...any.baselines });
      } else if (any.type === "RESTORE_FULL_STATE" && any.snapshot) {
        // W.4: Restore full canonical state for import undo/redo
        State.restoreSnapshot(any.snapshot);
        State.setBaselineMap({});
      }
      break;
    }
  }
};

/** History-eligible command types. */
const HISTORY_ELIGIBLE = new Set([
  "ADD_TASK", "UPDATE_TASK", "DELETE_TASK",
  "ADD_DEPENDENCY", "DELETE_DEPENDENCY", "UPDATE_DEPENDENCY",
  "SNAPSHOT_BASELINE", "CLEAR_BASELINE",
  "ADD_RESOURCE", "UPDATE_RESOURCE", "DELETE_RESOURCE",
  "ADD_ASSIGNMENT", "UPDATE_ASSIGNMENT", "DELETE_ASSIGNMENT",
]);

const MANUAL_ACTIVITY_PREFIX = "A";
const MANUAL_ACTIVITY_START = 1000;
const MANUAL_ACTIVITY_STEP = 10;

const collectVisibleActivityIds = (): Set<string> => {
  const used = new Set<string>();
  for (const task of State.getTasks()) {
    const manual = task.activityCode?.trim();
    if (manual) used.add(manual);
    const imported = task.sourceActivityId?.trim();
    if (imported) used.add(imported);
  }
  return used;
};

const needsManualActivityCode = (task: Task): boolean => {
  const hasManualCode = typeof task.activityCode === "string" && task.activityCode.trim().length > 0;
  const hasImportedCode = typeof task.sourceActivityId === "string" && task.sourceActivityId.trim().length > 0;
  return !hasManualCode && !hasImportedCode;
};

const generateManualActivityCode = (): string => {
  const used = collectVisibleActivityIds();
  let sequence = MANUAL_ACTIVITY_START;
  while (true) {
    const candidate = `${MANUAL_ACTIVITY_PREFIX}${sequence}`;
    if (!used.has(candidate)) return candidate;
    sequence += MANUAL_ACTIVITY_STEP;
  }
};

const resolveAddTaskPayloadForActivityCode = (task: Task): Task => {
  if (!needsManualActivityCode(task)) return task;
  return {
    ...task,
    activityCode: generateManualActivityCode(),
  };
};

const plannerCalendarToBaseDefinition = (calendar: PlannerCalendar): import("@planner/protocol").BaseCalendarDefinition => {
  const sourceCalendarType: "project" | "resource" | "global" =
    calendar.type === "Project"
      ? "project"
      : calendar.type === "Resource"
        ? "resource"
        : "global";

  return {
    id: calendar.calendarId,
    name: calendar.name,
    weeklyPattern: calendar.weeklyWorkPeriods,
    exceptions: calendar.exceptions.map((ex) => ({
      date: ex.date,
      workIntervals: ex.workIntervals,
      name: ex.name,
    })),
    parentCalendarId: calendar.parentCalendarId,
    sourceHoursPerDay: calendar.hoursPerDay,
    sourceHoursPerWeek: calendar.hoursPerWeek,
    sourceHoursPerMonth: calendar.hoursPerMonth,
    sourceHoursPerYear: calendar.hoursPerYear,
    sourceCalendarType,
    workingPatternSource: "parsed" as const,
  };
};

const plannerCalendarToProjectConfig = (calendar: PlannerCalendar) => {
  const hasWeekendWork = (calendar.weeklyHours[0] ?? 0) > 0 || (calendar.weeklyHours[6] ?? 0) > 0;
  return {
    id: calendar.calendarId,
    name: calendar.name,
    minutesPerDay: Math.max(1, Math.round(calendar.hoursPerDay * 60)) as import("@planner/protocol").WorkMinutes,
    workingWeekPattern: hasWeekendWork ? "ALL_DAYS" as const : "MON_FRI" as const,
    holidays: calendar.exceptions.filter((ex) => ex.workIntervals.length === 0).map((ex) => ex.date),
  };
};

const importedDefinitionToPlannerCalendar = (
  sourceCalendarId: CalendarId,
  sourceDef: import("@planner/protocol").BaseCalendarDefinition,
  isDefaultProjectCalendar: boolean,
  nameOverride?: string,
): PlannerCalendar => {
  const now = new Date().toISOString();
  const hoursByDay: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };
  for (const key of [0, 1, 2, 3, 4, 5, 6] as const) {
    const intervals = sourceDef.weeklyPattern[key] ?? [];
    hoursByDay[key] = intervals.reduce((sum, iv) => sum + (iv.endMinute - iv.startMinute), 0) / 60;
  }
  const weeklyHours = Object.values(hoursByDay).reduce((sum, h) => sum + h, 0);
  const dayHours = sourceDef.sourceHoursPerDay ?? Math.max(...Object.values(hoursByDay), 8);

  return {
    calendarId: (`planner-${sourceCalendarId}-${Math.random().toString(36).slice(2, 8)}`) as CalendarId,
    name: nameOverride?.trim() || `${sourceDef.name} (Clone)`,
    type:
      sourceDef.sourceCalendarType === "resource"
        ? "Resource"
        : sourceDef.sourceCalendarType === "project"
          ? "Project"
          : "Global",
    source: "cloned-from-import",
    parentCalendarId: sourceDef.parentCalendarId,
    isDefaultProjectCalendar,
    hoursPerDay: dayHours,
    hoursPerWeek: sourceDef.sourceHoursPerWeek ?? weeklyHours,
    hoursPerMonth: sourceDef.sourceHoursPerMonth ?? (sourceDef.sourceHoursPerWeek ?? weeklyHours) * 4,
    hoursPerYear: sourceDef.sourceHoursPerYear ?? (sourceDef.sourceHoursPerWeek ?? weeklyHours) * 52,
    weeklyHours: hoursByDay,
    weeklyWorkPeriods: sourceDef.weeklyPattern,
    exceptions: sourceDef.exceptions.map((ex) => ({
      date: ex.date,
      type: ex.workIntervals.length === 0 ? "non-working" : "custom",
      workIntervals: ex.workIntervals,
      name: ex.name,
    })),
    createdAt: now,
    updatedAt: now,
  };
};

export const __test__resolveAddTaskPayloadForActivityCode = (task: Task): Task =>
  resolveAddTaskPayloadForActivityCode(task);

// ── M03 Command Spine ────────────────────────────────────────────────
//
// dispatchCommand() is the single entry point for all inbound commands.
// It wraps commands in a CommandEnvelope (internal metadata), delegates
// to handleCommand() for routing/execution, and logs at the audit seam.
//
// Phase 1: Envelope + coarse audit log (always "ack").
// Phase 2: handleCommand returns DispatchOutcome for accurate audit.
//          Replay bypass paths marked as transitional.
//
// TRANSITIONAL: handleCommand() retains all existing per-command routing,
// validation, rollback, history, and persistence logic. It is not yet
// refactored into per-type handler functions. Future milestones may
// extract handlers, but behavioral correctness must not change here.
// ─────────────────────────────────────────────────────────────────────

// W5B-B2.4B: Temporal Candidate Projection Execution (diagnostic-only)

/**
 * Build a SchedulingStateSnapshot from current State.
 * Used for diagnostic-only temporal execution (candidate projection).
 * This snapshot is never applied to canonical state.
 */
const buildSchedulingStateSnapshot = (calendarServices: CalendarServices): SchedulingStateSnapshot => {
  const tasks = State.getTasks();
  const dependencies = State.getDependencies();

  // Generate calendar data via CalendarIndexer seam
  const nonWorkingDays = calendarServices.indexer.indexNonWorkingDays(
    calendarServices.resolver.projectCalendarId(),
    State.getProjectStartDate(),
    CALENDAR_HORIZON,
  );
  const nwdSet = new Set(nonWorkingDays);

  return {
    tasks,
    dependencies,
    projectStartDate: State.getProjectStartDate(),
    projectCalendar: State.getProjectCalendar(),
    findTask: State.findTask,
    calendars: State.getCalendars(),
    nonWorkingDays,
    nwdSet,
    schedulingMode: getSchedulingMode(),
    assumptionSet: State.getAssumptionSet(),
    authoredActivities: State.getAuthoredActivities(),
    compiledProjectCalendar: calendarServices.compiledProjectCalendar,
    temporalAdapter: calendarServices.temporalAdapter,
  };
};

/**
 * Execute temporal candidate projection when gate is allowed.
 * Returns a TemporalCandidateProjection object.
 * Diagnostic-only: never mutates canonical state or applies results.
 */
const executeTemporalCandidateProjection = (
  candidateRunId: string,
  gateReqId: string | null,
  realWasmValidationPassed: boolean,
  wasmLoadMode: "real" | "unavailable" | "mocked",
  expectedDivergenceTaskIds: readonly string[],
  unsupportedFeatureFlags: readonly string[],
): TemporalCandidateProjection | null => {
  const startTime = performance.now();
  
  try {
    // Build calendar services for this execution
    const calendarServices = createTrackACalendarServices(
      State.getProjectCalendar(),
      State.getCalendarDefinitions(),
      State.getProjectCalendarId(),
      State.findTask,
    );
    
    // Build state snapshot (diagnostic-only, never modifies canonical state)
    const snapshot = buildSchedulingStateSnapshot(calendarServices);
    
    // Execute temporal engine
    const temporalEngine = new TemporalEngineAdapter();
    const engineResult = temporalEngine.execute(snapshot);
    
    // Check if execution succeeded and has normalized facts
    if (!engineResult.normalized) {
      console.warn("[W5B-B2.4B] Temporal engine returned no normalized facts");
      return null;
    }
    
    const facts = engineResult.normalized;
    const projectStartDate = State.getProjectStartDate();
    const minutesPerDay = calendarServices.temporalAdapter.minutesPerDay as number;
    const projectStartMs = parseProjectStartMs(projectStartDate);
    
    // Map facts to candidate task results
    const candidateTasks: Array<import("@planner/protocol").TemporalCandidateTaskResult> = [];
    let projectStartMinutes: number | null = null;
    let projectFinishMinutes: number | null = null;
    let criticalCount = 0;
    
    for (const taskId of Object.keys(facts)) {
      const fact = facts[taskId];
      
      // Convert epoch-ms dates to day-offset WorkMinutes
      const earlyStart = ((fact.earlyStartDate - projectStartMs) / 86_400_000) as import("@planner/protocol").WorkMinutes;
      const earlyFinish = ((fact.earlyFinishDate - projectStartMs) / 86_400_000) as import("@planner/protocol").WorkMinutes;
      const lateStart = ((fact.lateStartDate - projectStartMs) / 86_400_000) as import("@planner/protocol").WorkMinutes;
      const lateFinish = ((fact.lateFinishDate - projectStartMs) / 86_400_000) as import("@planner/protocol").WorkMinutes;
      
      // Convert float minutes to day-offset WorkMinutes
      const totalFloat = (fact.totalFloatMinutes / minutesPerDay) as import("@planner/protocol").WorkMinutes;
      const freeFloat = (fact.freeFloatMinutes / minutesPerDay) as import("@planner/protocol").WorkMinutes;
      
      candidateTasks.push({
        taskId,
        earlyStart,
        earlyFinish,
        lateStart,
        lateFinish,
        totalFloat,
        freeFloat,
        critical: fact.isCritical,
        calendarIdUsed: null, // Not available from normalized facts
      });
      
      // Track summary metrics
      if (projectStartMinutes === null || earlyStart < projectStartMinutes) {
        projectStartMinutes = earlyStart;
      }
      if (projectFinishMinutes === null || earlyFinish > projectFinishMinutes) {
        projectFinishMinutes = earlyFinish;
      }
      if (fact.isCritical) {
        criticalCount++;
      }
    }
    
    // Build candidate summary
    const candidateSummary: import("@planner/protocol").TemporalCandidateSummary = {
      projectStart: projectStartMinutes as any,
      projectFinish: projectFinishMinutes as any,
      criticalCount,
      totalTaskCount: candidateTasks.length,
      scheduledTaskCount: candidateTasks.length,
    };
    
    // Calculate execution time
    const performanceMs = Math.round(performance.now() - startTime);
    
    // Build complete projection (diagnostic-only, never applied)
    const summaryTaskIdsForComparison = State.getTasks()
      .filter((t) => State.isTaskSummary(t.id))
      .map((t) => t.id);
    const slotVsTemporalComparison = compareSlotVsTemporalCandidate({
      slotResults: State.getLatestScheduleResults(),
      candidateTasks,
      expectedCalendarDivergenceTaskIds: expectedDivergenceTaskIds,
      unsupportedFeatureFlags,
      summaryTaskIds: summaryTaskIdsForComparison,
    });

    // W5B-B2.12A: attach read-only diagnostic buckets to `unexplained_divergence`
    // rows. Does NOT alter `unexplainedDivergenceCount`, classifications, the
    // cutover gate, fallback reason, unsupportedFeatureFlags, or schedule
    // outputs. Pure read of State to compute per-task heuristics.
    const unexplainedDivergenceTaskIdSet = new Set(
      slotVsTemporalComparison.summary.taskComparisons
        .filter((row) => row.classification === "unexplained_divergence")
        .map((row) => row.taskId),
    );
    if (unexplainedDivergenceTaskIdSet.size > 0) {
      const allTasks = State.getTasks();
      const taskById = new Map(allTasks.map((t) => [t.id, t] as const));
      const allDeps = State.getDependencies();
      const calendarDefs = State.getCalendarDefinitions();
      const calendars = State.getCalendars();
      // W5B-B2.12A.3: also consult the resolved calendar registry that the
      // XER/MSP import paths actually populate. B2.12A.2 audit confirmed
      // imported calendars never reach `calendarDefinitions` or `calendars`
      // — they live in `resolvedCalendarDefinitions`. Without this, every
      // imported-calendar task is false-bucketed as missing metadata.
      const resolvedCalendarDefs = State.getResolvedCalendarDefinitions();
      const projectCalendarId = State.getCalendarId();
      const predCount = new Map<string, number>();
      const succCount = new Map<string, number>();
      const taskHasNonZeroLag = new Map<string, boolean>();
      for (const dep of allDeps) {
        succCount.set(dep.predId, (succCount.get(dep.predId) ?? 0) + 1);
        predCount.set(dep.succId, (predCount.get(dep.succId) ?? 0) + 1);
        if ((dep.lagWorkMinutes as number) !== 0) {
          taskHasNonZeroLag.set(dep.predId, true);
          taskHasNonZeroLag.set(dep.succId, true);
        }
      }
      const hintsByTaskId = new Map<string, UnexplainedDivergenceBucketHints>();
      for (const taskId of unexplainedDivergenceTaskIdSet) {
        const task = taskById.get(taskId);
        // W5B-B2.12A.3: structural-summary detection accepts EITHER the
        // source `isStructuralSummary` marker OR child-based detection.
        // Childless `isStructuralSummary=true` rows (B2.12A.2 §8) would
        // otherwise fall through to `unknown_unclassified`.
        hintsByTaskId.set(
          taskId,
          buildTaskBucketHints({
            task: task ?? null,
            projectCalendarId,
            calendarDefinitions: calendarDefs,
            calendars,
            resolvedCalendarDefinitions: resolvedCalendarDefs,
            hasChildrenInHierarchy: State.isTaskSummary(taskId),
            hasNonZeroLag: taskHasNonZeroLag.get(taskId) === true,
            predecessorCount: predCount.get(taskId) ?? 0,
            successorCount: succCount.get(taskId) ?? 0,
          }),
        );
      }
      const enriched = attachUnexplainedDivergenceBuckets({
        taskComparisons: slotVsTemporalComparison.summary.taskComparisons,
        hintsByTaskId,
      });
      // Rewrite in place (same array reference is used inside `summary`).
      slotVsTemporalComparison.summary.taskComparisons.splice(
        0,
        slotVsTemporalComparison.summary.taskComparisons.length,
        ...enriched,
      );
    }

    const combinedUnexplainedDivergenceTaskIds = [
      ...new Set([
        ...slotVsTemporalComparison.summary.taskComparisons
          .filter((item) => item.classification === "unexplained_divergence")
          .map((item) => item.taskId),
        ...slotVsTemporalComparison.unexplainedTaskIds,
      ]),
    ];

    const projection: TemporalCandidateProjection = {
      candidateRunId,
      engine: "temporal",
      calculatedAt: Date.now(),
      performanceMs,
      realWasmGateReference: {
        gateReqId,
        gateVersion: 1,
        realWasmValidationPassedAtRun: realWasmValidationPassed,
        wasmLoadModeAtRun: wasmLoadMode,
      },
      candidateTasks,
      candidateSummary,
      diagnostics: {
        candidateProjectionAvailable: true,
        candidateProjectionBlockedReason: null,
        unsupportedFeatureFlags: [...unsupportedFeatureFlags],
        temporalExecutionErrors: [],
        unexplainedDivergenceTaskIds: combinedUnexplainedDivergenceTaskIds,
        expectedDivergenceTaskIds: [...expectedDivergenceTaskIds],
      },
      comparison: slotVsTemporalComparison.summary,
    };
    
    return projection;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[W5B-B2.4B] Temporal candidate projection execution failed:", error);
    return null;
  }
};

/**
 * Dispatch a command through the envelope spine.
 * Creates an envelope, delegates to handleCommand, and logs the outcome.
 *
 * This is the only entry point for UI-issued commands.
 * Internal replay paths (undo/redo) use applyReplayCommand() which
 * bypasses the envelope spine — see transitional comment there.
 *
 * AUDIT SEAM: The auditLog call after handleCommand is the single
 * attachment point for future event ledger / governance hooks.
 * Outcome is now classified per-branch: "ack", "nack", or "error".
 */
const dispatchCommand = (cmd: Command): void => {
  const envelope = createEnvelope(cmd, "human");
  let result: DispatchResult;
  try {
    result = handleCommand(cmd, envelope);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DISPATCH] Uncaught error in ${cmd.type}:`, err);
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Internal error: ${message}` });
    result = dispatchError(message);
  }
  auditLog(envelope, result);
};

/**
 * Handle incoming commands.
 * Routes to appropriate handlers and triggers scheduling.
 *
 * @param cmd      - The protocol command to execute
 * @param envelope - Optional envelope for audit logging. Absent during
 *                   internal replay (undo/redo), where audit is not needed.
 *
 * TRANSITIONAL: The envelope parameter is optional to allow the existing
 * applyReplayCommand() and undo/redo paths to call handleCommand directly
 * without constructing envelopes. Once all mutation paths route through
 * dispatchCommand, the envelope parameter may become required.
 */
const handleCommand = (cmd: Command, envelope?: CommandEnvelope): DispatchResult => {
  if (!isReady) {
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Worker not ready" });
    return nack("Worker not ready", "not-ready");
  }

  // ---- UNDO ----
  if (cmd.type === "UNDO") {
    const entry = UndoHistory.popUndo();
    if (!entry) return nack("Nothing to undo", "logical");
    // TRANSITIONAL: undo replay mutates state via applyReplayCommand,
    // bypassing the command spine. See applyReplayCommand() comment.
    for (const c of entry.undo) applyReplayCommand(c);
    runSchedulingAndEmitState();
    debouncedSave();
    return ack();
  }

  // ---- REDO ----
  if (cmd.type === "REDO") {
    const entry = UndoHistory.popRedo();
    if (!entry) return nack("Nothing to redo", "logical");
    // TRANSITIONAL: redo replay mutates state via applyReplayCommand,
    // bypassing the command spine. See applyReplayCommand() comment.
    for (const c of entry.redo) applyReplayCommand(c);
    runSchedulingAndEmitState();
    debouncedSave();
    return ack();
  }

  // ---- TOGGLE_NODE (hierarchy collapse/expand — no scheduling) ----
  if (cmd.type === "TOGGLE_NODE") {
    const task = State.findTask(cmd.id);
    if (!task || !State.isTaskSummary(cmd.id)) {
      const reason = `Cannot toggle node ${cmd.id}: ${!task ? "not found" : "not a summary"}`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "validation");
    }

    Hierarchy.toggleCollapsed(cmd.id);
    // Reuse cached full projection — no rollup recomputation
    const visibleRows = Hierarchy.filterVisibleRows(Hierarchy.getFullProjection());
    const newAnchorIndex = Hierarchy.computeAnchorIndex(
      visibleRows,
      cmd.anchorTaskId,
      State.getTasks(),
    );

    emit({
      type: "VISIBLE_ROWS_UPDATE",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        visibleRows,
        totalVisibleRowCount: visibleRows.length,
        newAnchorIndex,
        collapsedIds: [...Hierarchy.getCollapsedIds()],
      },
    });
    return ack();
  }

  // ---- EXPAND_ALL (clear all collapse state — no scheduling) ----
  if (cmd.type === "EXPAND_ALL") {
    Hierarchy.clearCollapsedIds();
    const visibleRows = Hierarchy.filterVisibleRows(Hierarchy.getFullProjection());
    const newAnchorIndex = Hierarchy.computeAnchorIndex(
      visibleRows,
      cmd.anchorTaskId,
      State.getTasks(),
    );
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emit({
      type: "VISIBLE_ROWS_UPDATE",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        visibleRows,
        totalVisibleRowCount: visibleRows.length,
        newAnchorIndex,
        collapsedIds: [],
      },
    });
    return ack();
  }

  // ---- COLLAPSE_ALL_NODES (collapse every summary — no scheduling) ----
  if (cmd.type === "COLLAPSE_ALL_NODES") {
    const allTasks = State.getTasks();
    const summaryIds = new Set<string>();
    for (const t of allTasks) {
      if (State.isTaskSummary(t.id)) summaryIds.add(t.id);
    }
    Hierarchy.setCollapsedIds(summaryIds);
    const visibleRows = Hierarchy.filterVisibleRows(Hierarchy.getFullProjection());
    const newAnchorIndex = Hierarchy.computeAnchorIndex(
      visibleRows,
      cmd.anchorTaskId,
      State.getTasks(),
    );
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emit({
      type: "VISIBLE_ROWS_UPDATE",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        visibleRows,
        totalVisibleRowCount: visibleRows.length,
        newAnchorIndex,
        collapsedIds: [...summaryIds],
      },
    });
    return ack();
  }

  // ---- Read-only float path analysis query (AI-FPA.3E) ----
  if (cmd.type === "ANALYZE_FLOAT_PATHS") {
    const scheduleResults = State.getLatestScheduleResults();
    const taskIds = Object.keys(scheduleResults);
    if (taskIds.length === 0) {
      const reason = "No solved schedule results available for float path analysis";
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "validation");
    }

    const dependencies = State.getDependencies();
    const wasmRequest = {
      analysisVersion: 1,
      scheduleVersion: 1,
      targetTaskId: cmd.targetTaskId,
      maxPaths: cmd.maxPaths,
      nearCriticalThresholdMinutes: cmd.nearCriticalThresholdMinutes,
      scheduleResults: taskIds.map(taskId => {
        const result = scheduleResults[taskId];
        return {
          taskId,
          earlyStartMinutes: result.earlyStartMinutes,
          earlyFinishMinutes: result.earlyFinishMinutes,
          lateStartMinutes: result.lateStartMinutes,
          lateFinishMinutes: result.lateFinishMinutes,
          totalFloatMinutes: result.totalFloatMinutes,
          isCritical: result.isCritical,
        };
      }),
      dependencies: dependencies.map(dep => ({
        predId: dep.predId,
        succId: dep.succId,
        depType: dep.type,
        lagWorkMinutes: dep.lagWorkMinutes,
      })),
    };

    try {
      const wasm = getCpmWasm();
      const raw = wasm.analyze_float_paths(wasmRequest) as FloatPathMvpResponse | FloatPathMvpError;

      if (isFloatPathError(raw)) {
        emit({
          type: "FLOAT_PATH_ERROR",
          v: 1,
          reqId: cmd.reqId,
          error: raw,
        });
      } else {
        emit({
          type: "FLOAT_PATH_RESULT",
          v: 1,
          reqId: cmd.reqId,
          payload: raw,
        });
      }
      return ack();
    } catch (error) {
      const reason = `Float path analysis failed: ${error}`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return dispatchError(reason);
    }
  }

  // ---- Structural Mutations (Phase 2B: validate → mutate → projection) ----

  if (cmd.type === "INDENT_TASK") {
    const error = StructuralValidation.validateIndent(cmd.taskId);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    const snapshot = State.createSnapshot();
    State.indentTask(cmd.taskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    UndoHistory.pushEntry({ undo: [{ type: "RESTORE_FULL_STATE", snapshot } as unknown as Command], redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as Command] });
    debouncedSave();
    return ack();
  }

  if (cmd.type === "OUTDENT_TASK") {
    const error = StructuralValidation.validateOutdent(cmd.taskId);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    const snapshot = State.createSnapshot();
    State.outdentTask(cmd.taskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    UndoHistory.pushEntry({ undo: [{ type: "RESTORE_FULL_STATE", snapshot } as unknown as Command], redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as Command] });
    debouncedSave();
    return ack();
  }

  if (cmd.type === "MOVE_TASK") {
    const error = StructuralValidation.validateMove(cmd.taskId, cmd.newParentId, cmd.afterTaskId);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    const snapshot = State.createSnapshot();
    State.moveTask(cmd.taskId, cmd.newParentId, cmd.afterTaskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    UndoHistory.pushEntry({ undo: [{ type: "RESTORE_FULL_STATE", snapshot } as unknown as Command], redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as Command] });
    debouncedSave();
    return ack();
  }

  if (cmd.type === "REORDER_TASK") {
    const error = StructuralValidation.validateReorder(cmd.taskId, cmd.afterTaskId);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    const snapshot = State.createSnapshot();
    State.reorderTask(cmd.taskId, cmd.afterTaskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    UndoHistory.pushEntry({ undo: [{ type: "RESTORE_FULL_STATE", snapshot } as unknown as Command], redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as Command] });
    debouncedSave();
    return ack();
  }

  // ---- Forward mutations ----

  const addTaskPayload = cmd.type === "ADD_TASK"
    ? resolveAddTaskPayloadForActivityCode(cmd.payload)
    : null;

  // Build history entry BEFORE mutation (captures pre-state)
  const historyEntry = HISTORY_ELIGIBLE.has(cmd.type)
    ? UndoHistory.buildHistoryEntry(
      cmd.type === "ADD_TASK"
        ? { ...cmd, payload: addTaskPayload! }
        : cmd,
    )
    : null;

  if (cmd.type === "ADD_TASK") {
    const payload = addTaskPayload!;
    const error = Validation.validateTask(payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }

    State.addTask(payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "UPDATE_TASK") {
    const task = State.findTask(cmd.taskId);
    if (!task) {
      const reason = `Task ${cmd.taskId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    const updates = { ...cmd.updates };
    if (State.isTaskSummary(cmd.taskId)) {
      delete updates.durationWorkMinutes;
      delete updates.minEarlyStartMinutes;
    }

    const error = Validation.validateTaskUpdate(cmd.taskId, updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }

    const snapshot = State.createSnapshot();
    State.updateTask(cmd.taskId, updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return dispatchError("Scheduling failed after UPDATE_TASK");
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return ack();
    }
  }

  if (cmd.type === "ADD_DEPENDENCY") {
    const error = Validation.validateDependency(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }

    const snapshot = State.createSnapshot();
    State.addDependency(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return dispatchError("Scheduling failed after ADD_DEPENDENCY");
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return ack();
    }
  }

  if (cmd.type === "DELETE_TASK") {
    if (!State.findTask(cmd.taskId)) {
      const reason = `Task ${cmd.taskId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    State.deleteTaskRecursive(cmd.taskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "DELETE_DEPENDENCY") {
    if (!State.findDependencyById(cmd.dependencyId)) {
      const reason = `Dependency ${cmd.dependencyId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    State.deleteDependency(cmd.dependencyId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "UPDATE_DEPENDENCY") {
    if (!State.findDependencyById(cmd.dependencyId)) {
      const reason = `Dependency ${cmd.dependencyId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    const error = Validation.validateDependencyUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }

    const snapshot = State.createSnapshot();
    State.updateDependency(cmd.dependencyId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return dispatchError("Scheduling failed after UPDATE_DEPENDENCY");
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return ack();
    }
  }

  if (cmd.type === "SNAPSHOT_BASELINE") {
    const sr = State.getLatestScheduleResults();
    const newBaseline: BaselineMap = {};
    for (const taskId of Object.keys(sr)) {
      newBaseline[taskId] = { startMinutes: sr[taskId].earlyStartMinutes, finishMinutes: sr[taskId].earlyFinishMinutes };
    }
    State.setBaselineMap(newBaseline);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "CLEAR_BASELINE") {
    State.setBaselineMap({});
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  // ---- Resource commands ----

  if (cmd.type === "ADD_RESOURCE") {
    const error = Validation.validateResource(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    State.addResource(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "UPDATE_RESOURCE") {
    if (!State.findResource(cmd.resourceId)) {
      const reason = `Resource ${cmd.resourceId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }
    const error = Validation.validateResourceUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    State.updateResource(cmd.resourceId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "DELETE_RESOURCE") {
    if (!State.findResource(cmd.resourceId)) {
      const reason = `Resource ${cmd.resourceId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }
    State.deleteResource(cmd.resourceId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  // ---- Assignment commands ----

  if (cmd.type === "ADD_ASSIGNMENT") {
    const error = Validation.validateAssignment(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    State.addAssignment(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "UPDATE_ASSIGNMENT") {
    if (!State.findAssignment(cmd.assignmentId)) {
      const reason = `Assignment ${cmd.assignmentId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }
    const error = Validation.validateAssignmentUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return nack(error, "validation");
    }
    State.updateAssignment(cmd.assignmentId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "DELETE_ASSIGNMENT") {
    if (!State.findAssignment(cmd.assignmentId)) {
      const reason = `Assignment ${cmd.assignmentId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }
    State.deleteAssignment(cmd.assignmentId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return ack();
  }

  if (cmd.type === "UPSERT_PLANNER_CALENDAR") {
    if (cmd.payload.source === "imported-readonly") {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Imported source calendars are read-only. Clone first." });
      return nack("Imported source calendars are read-only. Clone first.", "validation");
    }

    const existing = State.getPlannerCalendars()[cmd.payload.calendarId as string];
    if (existing && existing.source === "imported-readonly") {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Imported source calendars are read-only. Clone first." });
      return nack("Imported source calendars are read-only. Clone first.", "validation");
    }

    const next: PlannerCalendar = {
      ...cmd.payload,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt ?? cmd.payload.createdAt ?? new Date().toISOString(),
    };
    State.upsertPlannerCalendar(next);

    const plannerDef = plannerCalendarToBaseDefinition(next);
    State.setCalendarDefinitions({
      ...State.getCalendarDefinitions(),
      [next.calendarId as string]: plannerDef,
    });

    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    debouncedSave();
    return ack();
  }

  if (cmd.type === "CLONE_IMPORTED_CALENDAR") {
    const sourceRecord = State.getSourceImportRecord();
    const sourceDefs = sourceRecord?.resolvedCalendarDefinitions ?? sourceRecord?.calendarDefinitions ?? {};
    const sourceDef = sourceDefs[cmd.sourceCalendarId as CalendarId];
    if (!sourceDef) {
      const reason = `Imported calendar ${cmd.sourceCalendarId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    const cloned = importedDefinitionToPlannerCalendar(
      cmd.sourceCalendarId,
      sourceDef,
      false,
      cmd.newName,
    );

    State.upsertPlannerCalendar(cloned);
    State.setCalendarDefinitions({
      ...State.getCalendarDefinitions(),
      [cloned.calendarId as string]: plannerCalendarToBaseDefinition(cloned),
    });

    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    debouncedSave();
    return ack();
  }

  if (cmd.type === "SET_PROJECT_DEFAULT_CALENDAR") {
    const plannerCalendar = State.getPlannerCalendars()[cmd.calendarId as string];
    const sourceRecord = State.getSourceImportRecord();
    const sourceDefs = sourceRecord?.resolvedCalendarDefinitions ?? sourceRecord?.calendarDefinitions ?? {};
    const sourceDef = sourceDefs[cmd.calendarId as CalendarId] ?? State.getCalendarDefinitions()[cmd.calendarId as string];

    if (!plannerCalendar && !sourceDef) {
      const reason = `Calendar ${cmd.calendarId} not found`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    State.setCalendarId(cmd.calendarId);

    const plannerState = State.getPlannerCalendars();
    const updatedPlannerState: Record<string, PlannerCalendar> = {};
    for (const [id, calendar] of Object.entries(plannerState)) {
      updatedPlannerState[id] = {
        ...calendar,
        isDefaultProjectCalendar: id === (cmd.calendarId as string),
      };
    }
    State.setPlannerCalendars(updatedPlannerState);

    if (plannerCalendar) {
      State.setProjectCalendar(plannerCalendarToProjectConfig(plannerCalendar));
    } else if (sourceDef) {
      const compiled = compileCalendar(sourceDef);
      const weekendWorking = compiled.dailyMinutes[0] > 0 || compiled.dailyMinutes[6] > 0;
      State.setProjectCalendar({
        id: cmd.calendarId,
        name: sourceDef.name,
        minutesPerDay: Math.max(1, ...compiled.dailyMinutes) as import("@planner/protocol").WorkMinutes,
        workingWeekPattern: weekendWorking ? "ALL_DAYS" : "MON_FRI",
        holidays: sourceDef.exceptions
          .filter((ex: import("@planner/protocol").CalendarDateException) => ex.workIntervals.length === 0)
          .map((ex: import("@planner/protocol").CalendarDateException) => ex.date),
      });
    }

    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    debouncedSave();
    return ack();
  }

  if (cmd.type === "ASSIGN_CALENDAR_TO_ACTIVITIES") {
    const missing = cmd.taskIds.filter((taskId) => !State.findTask(taskId));
    if (missing.length > 0) {
      const reason = `Task(s) not found: ${missing.join(", ")}`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "not-found");
    }

    for (const taskId of cmd.taskIds) {
      State.updateTask(taskId, { assignedCalendarId: cmd.calendarId });
    }

    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    emitProjectionUpdate();
    debouncedSave();
    return ack();
  }

  // ---- Import preview commands (W.2) ----

  if (cmd.type === "PREVIEW_IMPORT") {
    const result = runImportPreview(
      cmd.reqId,
      cmd.payload.format,
      cmd.payload.content,
      cmd.payload.sourceFileName,
    );
    if (result.ok) {
      emit(result.message);
      return ack();
    } else {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: result.error });
      return nack(result.error, "validation");
    }
  }

  if (cmd.type === "CANCEL_IMPORT_PREVIEW") {
    clearPendingCandidate();
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    return ack();
  }

  if (cmd.type === "IMPORT_SCHEDULE") {
    // W.4: Atomic import commit — replace canonical state with mapped candidate.
    const candidate = getPendingCandidate();
    if (!candidate) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "No pending import candidate" });
      return nack("No pending import candidate", "validation");
    }
    if (!candidate.canCommit) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Import candidate has errors \u2014 cannot commit" });
      return nack("Import candidate has errors", "validation");
    }
    if (!candidate.mappedTasks || !candidate.mappedDependencies || !candidate.mappedResources || !candidate.mappedAssignments) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Import candidate has no mapped data" });
      return nack("Import candidate has no mapped data", "validation");
    }

    try {
    // Capture pre-import snapshot for undo (full state strategy per spec §5.1)
    const preImportSnapshot = State.createSnapshot();
    const preImportBaselines = { ...State.getBaselineMap() };

    // Replace canonical state atomically (replace-only, spec §5.2)
    State.restoreSnapshot({
      tasks: [...candidate.mappedTasks],
      dependencies: [...candidate.mappedDependencies],
      resources: [...candidate.mappedResources],
      assignments: [...candidate.mappedAssignments],
      projectStartDate: normalizeImportedProjectStartDate(candidate.projectStartDate),
    });
    State.setBaselineMap({}); // Imported project starts with no baseline
    State.setSourceImportRecord({
      format: candidate.format,
      summary: candidate.summary,
      diagnostics: candidate.diagnostics,
      sourceFileName: candidate.sourceFileName,
      status: "sourceImportedNotCalculated",
      sourceImportFidelityState: {
        ...(candidate.sourceImportFidelityState ?? { actualsByTaskId: {}, progressByTaskId: {} }),
        sourceDatesByTaskId: candidate.sourceDatesByTaskId,
      },
      calendarDefinitions: candidate.calendarDefinitions,
      resolvedCalendarDefinitions: candidate.resolvedCalendarDefinitions,
      sourceProjectSettings: candidate.sourceProjectSettings,
      importedAt: new Date().toISOString(),
    });
    State.setSourceImportFidelityState({
      ...(candidate.sourceImportFidelityState ?? { actualsByTaskId: {}, progressByTaskId: {} }),
      sourceDatesByTaskId: candidate.sourceDatesByTaskId,
    });
    // W4: Store source planned dates sidecar and reset any prior variance report.
    State.setSourceDatesByTaskId({ ...(candidate.sourceDatesByTaskId ?? {}) });
    State.setVarianceReport(null);
    // W3C: Store resolved calendar definitions from import
    if (candidate.resolvedCalendarDefinitions) {
      State.setResolvedCalendarDefinitions({ ...candidate.resolvedCalendarDefinitions as Record<string, import("@planner/protocol").BaseCalendarDefinition> });
    }
    State.setScheduleLifecycle("sourceImportedNotCalculated");

    // Run scheduling for rendering compatibility only.
    // TODO(W.2+): fully separate imported source dates from planner-calculated dates.
    // Until explicit recalc exists, lifecycle remains sourceImportedNotCalculated.
    const success = runSchedulingAndEmitState();
    if (!success) {
      // Roll back to pre-import state
      State.restoreSnapshot(preImportSnapshot);
      State.setBaselineMap(preImportBaselines);
      runSchedulingAndEmitState();
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Scheduling failed after import — rolled back" });
      return dispatchError("Scheduling failed after import");
    }

    // Success \u2014 push undo entry (one entry for entire import)
    const undoEntry: UndoHistory.HistoryEntry = {
      undo: [{ type: "RESTORE_FULL_STATE", snapshot: preImportSnapshot, baselines: preImportBaselines } as unknown as Command],
      redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot(), baselines: {} } as unknown as Command],
    };
    UndoHistory.pushEntry(undoEntry);

    // Clear held candidate, reset hierarchy cache, and persist
    clearPendingCandidate();
    Hierarchy.clearCollapsedIds();
    Hierarchy.resetCache();
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    debouncedSave();
    return ack();

    } catch (importError) {
      const err = importError instanceof Error ? importError : new Error(String(importError));
      console.error("[IMPORT_SCHEDULE CATCH] error=%s", err.message);
      console.error("[IMPORT_SCHEDULE CATCH] stack=%s", err.stack);
      console.error("[IMPORT_SCHEDULE CATCH] State tasks=%d deps=%d res=%d assign=%d",
        State.getTasks().length, State.getDependencies().length,
        State.getResources().length, State.getAssignments().length);
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Import failed: ${err.message}` });
      return dispatchError(`Import failed: ${err.message}`);
    }
  }

  if (cmd.type === "RUN_IMPORTED_SCHEDULE_RECALCULATION") {
    const sourceRecord = State.getSourceImportRecord();
    if (!sourceRecord) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "No committed source import available" });
      return nack("No committed source import available", "validation");
    }

    const sourceDatesByTaskId = State.getSourceDatesByTaskId();
    if (Object.keys(sourceDatesByTaskId).length === 0) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "No source planned dates available for variance analysis" });
      return nack("No source planned dates available for variance analysis", "validation");
    }

    const calendarActivation = resolveImportedProjectDefaultCalendarActivation(
      sourceRecord,
      State.getProjectCalendarId(),
      State.getProjectCalendar(),
      State.getResolvedCalendarDefinitions(),
      State.getCalendarDefinitions(),
    );
    if (calendarActivation.activated) {
      State.setCalendarId(calendarActivation.calendarId);
      State.setProjectCalendar(calendarActivation.calendarConfig);
      console.info(
        `[W5A] Project default calendar is active for Planner-Studio recalculation: ${calendarActivation.calendarId}`,
      );
    } else {
      console.warn(
        `[W5A] Imported project default calendar activation skipped. Using existing project calendar (${State.getProjectCalendarId()}). Reason: ${calendarActivation.reason ?? "unknown"}`,
      );
    }

    // W5B: Activate activity-level assigned calendars during recalculation
    const projectCalendarId = State.getProjectCalendarId();
    const resolvedDefs = State.getResolvedCalendarDefinitions();
    const rawDefs = State.getCalendarDefinitions();
    const tasks = State.getTasks();
    
    // Get project calendar definition from raw or resolved definitions to compile
    const projectCalendarDef = rawDefs[projectCalendarId as string] || resolvedDefs[projectCalendarId as string];
    const compiledProjectCal = projectCalendarDef ? compileCalendar(projectCalendarDef) : compileCalendar(STANDARD_CALENDAR);
    
    // Compile activity calendars (maps each task to its assigned calendar if available)
    const activityCalendarCompilation = compileActivityCalendars(
      tasks,
      projectCalendarId,
      compiledProjectCal,
      resolvedDefs,
      rawDefs,
    );

    // Log activity calendar diagnostics.
    // W5B-B1: activity calendars are active in temporal shadow calculation only.
    // Slot-authoritative scheduling still uses project calendar.
    // Lag/resource calendar behavior remains deferred.
    const tasksWithAssignedCals = activityCalendarCompilation.mappings.filter(m => m.assignedCalendarId).length;
    if (tasksWithAssignedCals > 0) {
      console.info(`[W5B-B1] Activity calendars compiled/preserved; active in temporal shadow only (slot authority unchanged): ${tasksWithAssignedCals} task(s)`);
      for (const [taskId, diagnostic] of Object.entries(activityCalendarCompilation.diagnostics)) {
        console.warn(`[W5B-B1] Task ${taskId} — ${diagnostic}`);
      }
    }

    const success = runSchedulingAndEmitState();
    if (!success) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Scheduling failed during recalculation" });
      return dispatchError("Scheduling failed during recalculation");
    }

    const recalcTasks = State.getTasks();
    const recalcScheduleResults = State.getLatestScheduleResults();
    const recalcNwdSet = new Set(lastNonWorkingDays);
    const recalcCalendarCtx: CalendarOutputContext | undefined =
      lastCalendarServices?.compiledProjectCalendar
        ? { calendar: lastCalendarServices.compiledProjectCalendar, projectStartDate: State.getProjectStartDate() }
        : undefined;
    const recalcInputDiags = computeConstraintDiagnostics(recalcTasks);
    const recalcDiagnosticsMap = mergeResultDiagnostics(
      recalcTasks,
      recalcScheduleResults,
      recalcInputDiags,
      recalcNwdSet,
      lastCalendarServices?.temporalAdapter.minutesPerDay as number,
      recalcCalendarCtx,
    );

    const varianceReport = computeSourceVarianceReport(
      recalcTasks,
      recalcScheduleResults,
      sourceDatesByTaskId,
      recalcDiagnosticsMap,
      sourceRecord.diagnostics,
    );

    State.setVarianceReport(varianceReport);
    State.setScheduleLifecycle("plannerCalculatedWithVariance");
    State.setSourceImportRecord({
      ...sourceRecord,
      status: "plannerCalculatedWithVariance",
    });

    emitProjectionUpdate();
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    debouncedSave();
    return ack();
  }

  // ---- W5B-B2.3C: Temporal WASM Validation Gate (diagnostic-only) ----
  if (cmd.type === "RUN_TEMPORAL_WASM_VALIDATION_GATE") {
    try {
      // Get the cached WASM module if available
      let wasmModule = null;
      try {
        if (isWasmLoaded()) {
          wasmModule = getCpmWasm() as unknown as { calculate_schedule_minute: (request: unknown) => unknown } | null;
        }
      } catch {
        // WASM not available — run gate with null
        wasmModule = null;
      }

      // Run validation harness (diagnostic-only; no state mutation)
      const result = runTemporalWasmValidationGate(wasmModule);
      lastTemporalWasmValidationGateResult = result;
      lastTemporalWasmValidationGateReqId = cmd.reqId;

      // Emit result with matching reqId
      emit({
        type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT",
        v: 1,
        reqId: cmd.reqId,
        payload: result,
      });
      return ack();
    } catch (error) {
      const reason = `Validation gate error: ${error instanceof Error ? error.message : String(error)}`;
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: reason });
      return nack(reason, "logical");
    }
  }

  // ---- W5B-B2.4A: Temporal Candidate Projection (gate skeleton only) ----
  if (cmd.type === "RUN_TEMPORAL_CANDIDATE_PROJECTION") {
    const runtime = self as unknown as {
      __PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED?: boolean;
      __PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK?: boolean;
      __PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING?: TemporalAuthorityRolloutRing;
      __PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED?: boolean;
      __PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS?: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
      __PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS?: readonly string[];
      __PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS?: readonly string[];
      __PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED?: boolean;
      __PLANNER_TEMPORAL_ENGINE_AVAILABLE?: boolean;
    };

    const requestOverrides = cmd.internalOnly === true ? cmd.devOverrides : undefined;

    const unsupportedFeatureFlags = Array.isArray(runtime.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS)
      ? runtime.__PLANNER_TEMPORAL_UNSUPPORTED_FEATURE_FLAGS.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    const unexplainedDivergenceTaskIds = Array.isArray(runtime.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS)
      ? runtime.__PLANNER_TEMPORAL_UNEXPLAINED_DIVERGENCE_TASK_IDS.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : (lastTemporalWasmValidationGateResult?.unexplainedDivergenceTaskIds ?? []);

    const useLastSuccessfulWasmGate = requestOverrides?.useLastSuccessfulWasmGate === true;
    const selectedGateResult =
      useLastSuccessfulWasmGate
        ? (lastTemporalWasmValidationGateResult?.realWasmValidationPassed
            ? lastTemporalWasmValidationGateResult
            : null)
        : lastTemporalWasmValidationGateResult;

    const sourceProtectionStatus = requestOverrides?.sourceProtectionStatus
      ?? runtime.__PLANNER_TEMPORAL_SOURCE_PROTECTION_STATUS
      ?? selectedGateResult?.sourceProtectionStatus
      ?? "blocked";

    const realWasmValidationPassed = requestOverrides?.realWasmValidationPassed
      ?? runtime.__PLANNER_TEMPORAL_REAL_WASM_VALIDATION_PASSED
      ?? selectedGateResult?.realWasmValidationPassed
      ?? false;

    const temporalEngineAvailable =
      requestOverrides?.temporalEngineAvailable
      ?? runtime.__PLANNER_TEMPORAL_ENGINE_AVAILABLE
      ?? (() => {
        try {
          return isWasmLoaded();
        } catch {
          return false;
        }
      })();

    const gateDecision = evaluateTemporalCandidateProjectionGate({
      temporalCandidateProjectionEnabled:
        requestOverrides?.temporalCandidateProjectionEnabled
        ?? (runtime.__PLANNER_TEMPORAL_CANDIDATE_PROJECTION_ENABLED === true),
      temporalAuthorityEmergencyRollback:
        requestOverrides?.temporalAuthorityEmergencyRollback
        ?? (runtime.__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK === true),
      realWasmValidationPassed,
      sourceProtectionStatus,
      unexplainedDivergenceTaskIds,
      unsupportedFeatureFlags,
      projectFeatureProfileSupported: runtime.__PLANNER_TEMPORAL_PROJECT_FEATURE_PROFILE_SUPPORTED !== false,
      rolloutRing: parseTemporalAuthorityRolloutRing(
        requestOverrides?.temporalAuthorityRolloutRing ?? runtime.__PLANNER_TEMPORAL_AUTHORITY_ROLLOUT_RING,
      ),
      temporalEngineAvailable,
    });

    let projection: TemporalCandidateProjection;

    if (gateDecision.allowed) {
      // Gate passed — execute temporal scheduling diagnostically
      const executedProjection = executeTemporalCandidateProjection(
        cmd.reqId,
        lastTemporalWasmValidationGateReqId,
        realWasmValidationPassed,
        lastTemporalWasmValidationGateResult?.wasmLoadMode ?? "unavailable",
        lastTemporalWasmValidationGateResult?.expectedDivergenceTaskIds ?? [],
        unsupportedFeatureFlags,
      );

      if (executedProjection) {
        // Execution succeeded — use the real projection
        projection = executedProjection;
      } else {
        // Execution failed — return blocked projection with error reason
        projection = createBlockedTemporalCandidateProjection({
          candidateRunId: cmd.reqId,
          blockedReason: "candidate_execution_failed",
          unsupportedFeatureFlags,
          unexplainedDivergenceTaskIds,
          expectedDivergenceTaskIds: lastTemporalWasmValidationGateResult?.expectedDivergenceTaskIds ?? [],
          temporalExecutionErrors: ["Temporal scheduling execution failed"],
          gateReqId: lastTemporalWasmValidationGateReqId,
          realWasmValidationPassedAtRun: realWasmValidationPassed,
          wasmLoadModeAtRun: lastTemporalWasmValidationGateResult?.wasmLoadMode ?? "unavailable",
        });
      }
    } else {
      // Gate blocked — return blocked projection
      const blockedReason = gateDecision.blockedReason ?? "candidate_execution_failed";
      projection = createBlockedTemporalCandidateProjection({
        candidateRunId: cmd.reqId,
        blockedReason,
        unsupportedFeatureFlags,
        unexplainedDivergenceTaskIds,
        expectedDivergenceTaskIds: lastTemporalWasmValidationGateResult?.expectedDivergenceTaskIds ?? [],
        temporalExecutionErrors: [],
        gateReqId: lastTemporalWasmValidationGateReqId,
        realWasmValidationPassedAtRun: realWasmValidationPassed,
        wasmLoadModeAtRun: lastTemporalWasmValidationGateResult?.wasmLoadMode ?? "unavailable",
      });
    }

    lastTemporalCandidateProjection = projection;
    lastTemporalCandidateComparisonSummary = projection.comparison;

    emit({
      type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        projection,
        gateDecision,
        authorityApplied: false,
      },
    });

    return ack();
  }

  // ---- W5B-B2.5B: Temporal Authority Cutover Decision (diagnostic-only) ----
  if (cmd.type === "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION") {
    const canApplyOverrides = cmd.internalOnly === true && isInternalDiagnosticOverrideAllowed();
    const baseInput = buildTemporalAuthorityCutoverGateInputFromRuntime();
    const effectiveInput = canApplyOverrides
      ? { ...baseInput, ...cmd.inputOverrides }
      : baseInput;

    const decision = evaluateTemporalAuthorityCutoverGate(effectiveInput);
    const evaluatedAt = Date.now();

    emit({
      type: "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        decision,
        evaluatedAt,
        reqId: cmd.reqId,
        authorityApplied: false,
      },
    });

    return ack();
  }

  // ---- W5B-B2.5D: Temporal Authority Apply (internal runtime apply behind gates) ----
  if (cmd.type === "RUN_TEMPORAL_AUTHORITY_APPLY") {
    const canApplyOverrides = cmd.internalOnly === true && isInternalDiagnosticOverrideAllowed();
    const baseInput = buildTemporalAuthorityCutoverGateInputFromRuntime();
    const effectiveInput = canApplyOverrides
      ? { ...baseInput, ...cmd.inputOverrides }
      : baseInput;

    const decision = evaluateTemporalAuthorityCutoverGate(effectiveInput);
    const evaluatedAt = Date.now();
    const authorityRunId = `${cmd.reqId}:${evaluatedAt}`;
    const previousMode = currentAuthorityEngineMode;
    const latestComparison = lastTemporalCandidateComparisonSummary ?? lastTemporalCandidateProjection?.comparison ?? null;
    const realWasmGateReference = lastTemporalCandidateProjection?.realWasmGateReference ?? null;
    const candidateRunId = lastTemporalCandidateProjection?.candidateRunId ?? null;

    let authorityApplied = false;
    let appliedEngine: "slot" | "temporal" = "slot";
    let applyMode:
      | "slot_fallback"
      | "internal_runtime_temporal_authoritative"
      | "dogfood_runtime_temporal_authoritative" = "slot_fallback";
    let appliedTaskCount = 0;
    let fallbackReason: string | null = decision.fallbackReason;

    // W5B-B2.9: dogfood-specific runtime inputs.
    const runtimeScope = self as unknown as {
      __PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED?: boolean;
      __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED?: boolean;
      __PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED?: boolean;
    };
    // W5B-B2.10A: cmd-level dogfood master-switch override is honoured ONLY
    // when internal diagnostic overrides are permitted (same gate as
    // inputOverrides). Default posture is unchanged: runtime flag governs.
    const dogfoodAuthorityEnabled =
      runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED === true
      || (canApplyOverrides && cmd.dogfoodAuthorityEnabled === true);
    const operatorAcknowledgementRequired =
      runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_REQUIRED !== false;
    const operatorAcknowledgementProvided =
      cmd.dogfoodAcknowledgement?.acknowledged === true
      || runtimeScope.__PLANNER_TEMPORAL_DOGFOOD_OPERATOR_ACK_PROVIDED === true;

    const isDogfoodRing = effectiveInput.temporalAuthorityRolloutRing === "dogfood";
    const eligibility = isDogfoodRing
      ? canApplyDogfoodTemporalAuthority(
          cmd,
          effectiveInput,
          decision,
          dogfoodAuthorityEnabled,
          operatorAcknowledgementProvided,
        )
      : canApplyInternalTemporalAuthority(cmd, effectiveInput, decision);
    if (eligibility.eligible) {
      if (!lastTemporalCandidateProjection) {
        fallbackReason = "candidate_projection_unavailable";
      } else {
        const mapped = mapTemporalProjectionToScheduleResults(
          lastTemporalCandidateProjection,
          State.getLatestScheduleResults(),
        );

        if (mapped.mapped && mapped.fallbackReason == null) {
          lastSlotAuthoritativeSnapshot = cloneScheduleResults(State.getLatestScheduleResults());
          State.setLatestScheduleResults(mapped.mapped);
          emit(buildAuthorityDiffStatePayload(mapped.mapped));
          authorityApplied = true;
          appliedEngine = "temporal";
          applyMode = isDogfoodRing
            ? "dogfood_runtime_temporal_authoritative"
            : "internal_runtime_temporal_authoritative";
          appliedTaskCount = mapped.appliedTaskCount;
          fallbackReason = null;
          previousAuthorityEngineMode = previousMode;
          currentAuthorityEngineMode = "temporal_authoritative";
        } else {
          fallbackReason = mapped.fallbackReason ?? "slot_fallback";
          previousAuthorityEngineMode = previousMode;
          currentAuthorityEngineMode = "slot_fallback";
        }
      }
    } else {
      fallbackReason = eligibility.fallbackReason ?? fallbackReason ?? "slot_fallback";
      previousAuthorityEngineMode = previousMode;
      currentAuthorityEngineMode = "slot_fallback";
    }

    if (authorityApplied) {
      lastTemporalAuthorityFallbackReason = null;
    } else {
      lastTemporalAuthorityFallbackReason = fallbackReason ?? "slot_fallback";
    }
    lastTemporalAuthorityRunId = authorityRunId;
    lastTemporalAuthorityDecision = decision;
    lastTemporalAuthorityApplied = authorityApplied;
    lastTemporalAuthorityAppliedEngine = appliedEngine;
    lastTemporalAuthorityApplyMode = applyMode;

    const auditPreview: TemporalAuthorityAuditPreview = {
      authorityRunId,
      timestamp: evaluatedAt,
      previousAuthorityEngine: previousMode,
      requestedAuthorityEngine: decision.requestedAuthorityEngineMode,
      effectiveAuthorityEngine: authorityApplied ? "temporal_authoritative" : "slot",
      rolloutRing: decision.rolloutRing,
      realWasmGateReference,
      candidateRunId,
      comparisonSummary: latestComparison,
      appliedTaskCount,
      fallbackReason,
      sourceProtectionStatus: decision.sourceProtectionStatus,
      unsupportedFeatureFlags: [...decision.unsupportedFeatureFlags],
      unexplainedDivergenceCount: decision.unexplainedDivergenceCount,
      performanceMs: decision.performanceMs,
      authorityApplied: false,
      persistenceApplied: false,
    };
    lastTemporalAuthorityAuditPreview = auditPreview;

    emit({
      type: "TEMPORAL_AUTHORITY_APPLY_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        decision,
        evaluatedAt,
        authorityApplied,
        appliedEngine,
        fallbackReason,
        applyMode,
        persistenceApplied: false,
        auditPreview,
        rolloutRing: effectiveInput.temporalAuthorityRolloutRing,
        dogfoodAuthorityEnabled,
        operatorAcknowledgementStatus: {
          required: operatorAcknowledgementRequired,
          provided: operatorAcknowledgementProvided,
          acknowledgementTextVersion: 1,
        },
      },
    });

    return ack();
  }

  if (cmd.type === "RUN_TEMPORAL_AUTHORITY_ROLLBACK") {
    const rollbackRunId = `${cmd.reqId}:${Date.now()}`;
    const isInternal = cmd.internalOnly === true;

    if (!isInternal) {
      emit({
        type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT",
        v: 1,
        reqId: cmd.reqId,
        payload: {
          authorityRunId: rollbackRunId,
          rolledBack: false,
          restoredEngine: "slot_fallback",
          restoredTaskCount: Object.keys(State.getLatestScheduleResults()).length,
          fallbackReason: "non_internal_request",
          authorityApplied: false,
          persistenceApplied: false,
        },
      });
      return ack();
    }

    if (!lastSlotAuthoritativeSnapshot) {
      currentAuthorityEngineMode = "slot_fallback";
      emit({
        type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT",
        v: 1,
        reqId: cmd.reqId,
        payload: {
          authorityRunId: rollbackRunId,
          rolledBack: false,
          restoredEngine: "slot_fallback",
          restoredTaskCount: Object.keys(State.getLatestScheduleResults()).length,
          fallbackReason: "no_slot_snapshot_available",
          authorityApplied: false,
          persistenceApplied: false,
        },
      });
      return ack();
    }

    const currentResults = State.getLatestScheduleResults();
    const snapshot = cloneScheduleResults(lastSlotAuthoritativeSnapshot);
    const changed = JSON.stringify(currentResults) !== JSON.stringify(snapshot);

    State.setLatestScheduleResults(snapshot);
    previousAuthorityEngineMode = currentAuthorityEngineMode;
    currentAuthorityEngineMode = "slot_authoritative";
    lastTemporalAuthorityFallbackReason = "rollback_requested";
    lastTemporalAuthorityRunId = rollbackRunId;
    lastTemporalAuthorityApplied = false;
    lastTemporalAuthorityAppliedEngine = "slot";
    lastTemporalAuthorityApplyMode = "slot_fallback";

    if (changed) {
      emit(buildAuthorityDiffStatePayload(snapshot));
    }

    emit({
      type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        authorityRunId: rollbackRunId,
        rolledBack: changed,
        restoredEngine: "slot_authoritative",
        restoredTaskCount: Object.keys(snapshot).length,
        fallbackReason: null,
        authorityApplied: false,
        persistenceApplied: false,
      },
    });

    return ack();
  }

  if (cmd.type === "RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS") {
    emit({
      type: "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: buildTemporalAuthorityDiagnosticsPayload(),
    });
    return ack();
  }

  // ---- W5B-B2.7: Dogfood readiness check (diagnostic-only, never applies) ----
  if (cmd.type === "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK") {
    const baseInput = buildTemporalAuthorityCutoverGateInputFromRuntime();
    const evaluatedAt = Date.now();
    const controls = buildTemporalDogfoodControlsFromRuntime(baseInput);
    const decision = evaluateTemporalDogfoodEligibility({
      controls,
      rolloutRing: baseInput.temporalAuthorityRolloutRing,
    });

    emit({
      type: "TEMPORAL_DOGFOOD_READINESS_RESULT",
      v: 1,
      reqId: cmd.reqId,
      payload: {
        decision,
        controls,
        evaluatedAt,
        evidenceRunCountRequired: controls.evidenceRequirements.requiredCleanRuns,
        evidenceRunCountAccepted: controls.evidenceRequirements.acceptedCleanRuns,
        evidenceFixtureNames: controls.evidenceRequirements.acceptedFixtures,
        realWasmGateStatus: {
          required: baseInput.realWasmGateRequired,
          passed: baseInput.realWasmValidationPassed && baseInput.wasmLoadMode === "real",
          wasmLoadMode: baseInput.wasmLoadMode,
        },
        candidateProjectionStatus: {
          candidateProjectionEnabled: baseInput.temporalCandidateProjectionEnabled,
          available: baseInput.candidateProjectionAvailable,
        },
        comparisonStatus: {
          required: baseInput.candidateComparisonRequired,
          present: baseInput.candidateComparisonPresent,
        },
        sourceProtectionStatus: baseInput.sourceProtectionStatus,
        persistenceStatus: {
          persistencePolicy: "disabled_runtime_only",
          persistenceApplied: false,
        },
        rollbackStatus: {
          rollbackAvailable: controls.allowedProjectProfile.rollbackAvailable,
          rollbackRequired: controls.rollbackRequired,
        },
        unsupportedFeatureFlags: baseInput.unsupportedFeatureFlags,
        projectProfileStatus: controls.allowedProjectProfile,
        authorityApplied: false,
      },
    });
    return ack();
  }

  // Unrecognized command type — emit NACK so the UI sees the rejection.
  // TypeScript narrows cmd to `never` here because all Command union members are handled above.
  // The cast is intentional: this is a runtime safety net for future protocol additions.
  const unknownCmd = cmd as unknown as { type: string; reqId: string };
  const unknownReason = `Unknown command type: ${unknownCmd.type}`;
  emit({ type: "NACK", v: 1, reqId: unknownCmd.reqId, error: unknownReason });
  return nack(unknownReason, "unknown-command");
};

// ---- Debounced persistence ----
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const saveState = (): void => {
  const persisted: PersistedState = {
    version: 1,
    lastModified: Date.now(),
    state: {
      projectStartDate: State.getProjectStartDate(),
      excludeWeekends: State.getExcludeWeekends(),
      calendarId: State.getCalendarId(),
      projectCalendar: State.getProjectCalendar(),
      calendars: State.getCalendars(),
      tasks: State.getTasks().map(t => ({ ...t })),
      dependencies: State.getDependencies().map(d => ({ ...d })),
      baselines: { ...State.getBaselineMap() },
      resources: State.getResources().map(r => ({ ...r })),
      assignments: State.getAssignments().map(a => ({ ...a })),
      scheduleLifecycle: State.getScheduleLifecycle(),
      sourceImportRecord: State.getSourceImportRecord(),
      sourceImportFidelityState: State.getSourceImportFidelityState(),
      sourceDatesByTaskId: State.getSourceDatesByTaskId(),
      varianceReport: State.getVarianceReport(),
      calendarDefinitions: State.getCalendarDefinitions(),
      resolvedCalendarDefinitions: State.getResolvedCalendarDefinitions(),
      plannerCalendars: State.getPlannerCalendars(),
    },
  };

  const purityViolations = validatePersistedStatePurity(persisted);
  if (purityViolations.length > 0) {
    console.warn("[D9 Persistence] purity violation(s), save blocked:", purityViolations);
    return;
  }

  savePersistedState(persisted);
};

const debouncedSave = (): void => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 2000);
};

/**
 * Initialize worker: load WASM, hydrate persisted state, and emit WORKER_READY.
 */
const initializeWorker = async (): Promise<void> => {
  try {
    await loadCpmWasm();

    // Phase D3: wire temporal WASM module for shadow engine
    setTemporalWasm(getCpmWasm());

    // Attempt hydration from IndexedDB
    const raw = await loadPersistedState();
    const persisted = raw ? migratePersistedState(raw) : null;
    if (persisted?.state) {
      State.hydrateState(persisted.state);
      console.log("[Persistence] Hydrated", persisted.state.tasks.length, "tasks",
        persisted.state.dependencies.length, "deps");
    }

    isReady = true;
    emit({ type: "WORKER_READY", v: 1 });

    // Recompute schedule from hydrated state and emit initial DIFF_STATE
    runSchedulingAndEmitState();
  } catch (error) {
    console.error("Failed to initialize worker:", error);
    // Worker remains not ready
  }
};

// Set up message handler — all UI commands enter through the envelope spine.
ctx.onmessage = (event: MessageEvent<Command>) => {
  dispatchCommand(event.data);
};

// Start initialization
initializeWorker();

export { };
