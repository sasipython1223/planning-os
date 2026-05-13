/**
 * Protocol Types Index
 *
 * Centralized exports for all protocol types.
 */

// Worker protocol types
export type {
    AckMessage, AddAssignmentCommand, AddDependencyCommand, AddResourceCommand, AddTaskCommand, AnalyzeFloatPathsCommand, AssignCalendarToActivitiesCommand, Assignment, BaseCalendarDefinition, BaselineMap, CalendarAssignmentMap, CalendarAssignmentState, CalendarConfig, CalendarDateException, CalendarId, CalendarProvenance, CloneImportedCalendarCommand, Command, ConstraintDiagnosticCode, ConstraintType, DayOfWeek, DeleteAssignmentCommand, DeleteResourceCommand, Dependency, DependencyDiagnostic, DependencyDiagnosticsMap, DependencyType, DiagnosticSeverity, DiagnosticsMap, DiffStateMessage, FloatPathErrorMessage, FloatPathResultMessage, IndentTaskCommand, MoveTaskCommand, NackMessage, OutdentTaskCommand, PlannerCalendar, PlannerCalendarException, PlannerCalendarExceptionType, PlannerCalendarSource, PlannerCalendarType, RedoCommand, ReorderTaskCommand, Resource, ResourceHistogram, RunTemporalAuthorityApplyCommand, RunTemporalAuthorityCutoverDecisionCommand, RunTemporalAuthorityDiagnosticsCommand, RunTemporalAuthorityRollbackCommand, RunTemporalCandidateProjectionCommand, RunTemporalDogfoodReadinessCheckCommand, RunTemporalWasmValidationGateCommand, ScheduleResultMap, SetProjectDefaultCalendarCommand, Task, TaskVariance, TemporalAuthorityApplyResultMessage, TemporalAuthorityApplyResultPayload, TemporalAuthorityAuditPreview, TemporalAuthorityCutoverDecision, TemporalAuthorityCutoverDecisionResultMessage, TemporalAuthorityCutoverDecisionResultPayload, TemporalAuthorityCutoverFallbackReason, TemporalAuthorityCutoverGateInput, TemporalAuthorityCutoverGatePassMatrix, TemporalAuthorityDiagnosticsMessage, TemporalAuthorityDiagnosticsPayload, TemporalAuthorityEngineMode, TemporalAuthorityRequestedEngineMode, TemporalAuthorityRollbackResultMessage, TemporalAuthorityRollbackResultPayload, TemporalAuthorityRolloutRing, TemporalCandidateDiagnostics, TemporalCandidateDivergenceSummary, TemporalCandidateProjection, TemporalCandidateProjectionBlockedReason, TemporalCandidateProjectionGateDecision, TemporalCandidateProjectionGateInput, TemporalCandidateProjectionResultMessage, TemporalCandidateProjectionResultPayload, TemporalCandidateSummary, TemporalCandidateTaskComparison, TemporalCandidateTaskDivergenceClass, TemporalCandidateTaskResult, TemporalCandidateUnexplainedDivergenceBucket, TemporalDogfoodAllowedProfile, TemporalDogfoodBlockedReason, TemporalDogfoodControls, TemporalDogfoodEligibilityDecision, TemporalDogfoodEvidenceRequirements, TemporalDogfoodOperatorAcknowledgement, TemporalDogfoodReadinessResultMessage, TemporalDogfoodReadinessResultPayload, TemporalWasmValidationGateMessage, TemporalWasmValidationGatePayload, TemporalWasmValidationScenarioResult, TimeInterval, ToggleNodeCommand, UndoCommand, UpdateAssignmentCommand, UpdateDependencyCommand, UpdateResourceCommand, UpdateTaskCommand, UpsertPlannerCalendarCommand, VarianceMap, VisibleRow, VisibleRowsUpdateMessage, WeeklyWorkPattern, WorkerMessage, WorkerReadyMessage, WorkingWeekPattern, WorkMinutes
} from "./types.js";

export { DEFAULT_CALENDAR_ID, MINUTES_PER_DAY, SEVERITY_RANK } from "./types.js";

// CPM Kernel scheduling contract
export { ENGINE_ABI_VERSION } from "./kernel.js";
export type {
    CycleDetectedError, DuplicateTaskIdError, FloatPathMvpActivity, FloatPathMvpError,
    FloatPathMvpMode, FloatPathMvpPath, FloatPathMvpRelationship,
    FloatPathMvpRelationshipType, FloatPathMvpRequest, FloatPathMvpResponse,
    FloatPathMvpWarning, FloatPathMvpWarningCode, FloatPathMvpWarningSeverity,
    KernelDependencyType, ScheduleDependency, ScheduleError, ScheduleRequest,
    ScheduleResponse, ScheduleTask, ScheduleTaskResult, SelfDependencyError,
    TaskNotFoundError
} from "./kernel.js";

// Domain model contracts (M02)
export type {
    AssumptionSet, DomainEntityId, DomainResource, DurationStrategy, FixedDurationStrategy,
    ManualOverrideStrategy, ProductivityDrivenStrategy, ProductivityRule, Quantity, Zone
} from "./domain.js";

// Activity variant contracts (M02)
export type {
    ActivityConstraintType, AuthoredActivity, AuthoredDependencyLink,
    GeneratedActivity, GeneratedDependency
} from "./activities.js";

// Domain compiler contract (M02)
export type {
    CompiledScheduleGraph
} from "./compiler.js";

export type { DomainCompiler } from "./compiler.js";

// Import/export contracts (W.1)
export type {
    CalendarFidelitySummary, CancelImportPreviewCommand, ImportDiagnostic, ImportDiagnosticCode,
    ImportDiagnosticsSummary, ImportFormat, ImportPreviewMessage,
    ImportScheduleCommand, ImportSummary, PreviewImportCommand,
    RunImportedScheduleRecalculationCommand,
    ScheduleLifecycleState, SourceCalculatedVarianceReport, SourceImportFidelityState, SourceImportRecord,
    SourceImportStatus, SourceProjectSettings, SourceProjectStatus, SourceTaskActuals, SourceTaskDates,
    SourceTaskProgress, TaskDateVariance, VarianceSeverity
} from "./import.js";

