/**
 * Protocol Types Index
 *
 * Centralized exports for all protocol types.
 */

// Worker protocol types
export type {
    AckMessage, AddAssignmentCommand, AddDependencyCommand, AddResourceCommand, AddTaskCommand, Assignment, BaselineMap, Command, ConstraintDiagnosticCode, ConstraintType, DeleteAssignmentCommand, DeleteResourceCommand, Dependency, DependencyType, DiagnosticSeverity, DiagnosticsMap, DiffStateMessage, NackMessage, RedoCommand, Resource, ResourceHistogram, ScheduleResultMap, Task, TaskVariance, UndoCommand, UpdateAssignmentCommand, UpdateDependencyCommand, UpdateResourceCommand, UpdateTaskCommand, VarianceMap, WorkerMessage, WorkerReadyMessage
} from "./types.js";

export { SEVERITY_RANK } from "./types.js";

// CPM Kernel scheduling contract
export type {
    CycleDetectedError, DuplicateTaskIdError, KernelDependencyType, ScheduleDependency, ScheduleError, ScheduleRequest, ScheduleResponse, ScheduleTask, ScheduleTaskResult, SelfDependencyError,
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
    CancelImportPreviewCommand, ImportDiagnostic, ImportDiagnosticCode,
    ImportDiagnosticsSummary, ImportFormat, ImportPreviewMessage,
    ImportScheduleCommand, ImportSummary, PreviewImportCommand
} from "./import.js";

