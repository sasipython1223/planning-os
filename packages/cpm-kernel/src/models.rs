use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DepType {
    FS,
    SS,
    FF,
    SF,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum ConstraintType {
    #[default]
    ASAP,
    ALAP,
    SNET,
    FNLT,
    MSO,
    MFO,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawTask {
    pub id: String,
    pub duration_work_minutes: u32,
    pub min_early_start_minutes: u32,
    pub parent_id: Option<String>,
    pub is_summary: bool,
    pub constraint_type: ConstraintType,
    pub constraint_date_minutes: Option<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawDependency {
    pub pred_id: String,
    pub succ_id: String,
    pub dep_type: DepType,
    pub lag_work_minutes: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleResult {
    pub task_id: String,
    pub early_start_minutes: u32,
    pub early_finish_minutes: u32,
    pub late_start_minutes: u32,
    pub late_finish_minutes: u32,
    pub total_float_minutes: i32,
    pub is_critical: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CpmError {
    TaskNotFound(String),
    DuplicateTaskId(String),
    SelfDependency(String),
    CycleDetected,
}

impl fmt::Display for CpmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CpmError::TaskNotFound(id) => write!(f, "Task not found: {}", id),
            CpmError::DuplicateTaskId(id) => write!(f, "Duplicate task ID: {}", id),
            CpmError::SelfDependency(id) => write!(f, "Self-dependency detected for task: {}", id),
            CpmError::CycleDetected => write!(f, "Cycle detected in dependency graph"),
        }
    }
}

impl std::error::Error for CpmError {}

// ── Phase D1: Temporal (absolute-minute) model ───────────────────
//
// These types define a parallel kernel path introduced in Phase D1.
// The active production path remains the slot kernel (calculate_schedule).
// The worker does NOT use these types yet.

/// Temporal task input for the parallel absolute-minute kernel path.
///
/// `calendar_id` is stored per-task for future multi-calendar scheduling.
/// In Phase D1, the engine ignores per-task calendar_id and uses only
/// the project calendar from `TemporalScheduleRequest::project_calendar_id`.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporalTaskInput {
    pub id: String,
    pub duration_minutes: i64,
    pub min_early_start_minutes: i64,
    pub calendar_id: String,
    pub parent_id: Option<String>,
    pub is_summary: bool,
    pub constraint_type: ConstraintType,
    pub constraint_date_minutes: Option<i64>,
}

/// Temporal dependency input for the parallel absolute-minute kernel path.
///
/// `lag_calendar_id` is stored per-relation for future multi-calendar lag
/// resolution. In Phase D1, the engine ignores lag_calendar_id and applies
/// all lag using the project calendar.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporalRelationInput {
    pub pred_id: String,
    pub succ_id: String,
    pub dep_type: DepType,
    pub lag_minutes: i64,
    pub lag_calendar_id: String,
}

/// Compiled calendar: sorted, non-overlapping half-open working intervals
/// `[start_minute, end_minute)`. Worker compiles these from CalendarConfig.
///
/// Phase D1 requires exactly one calendar (the project calendar).
#[derive(Debug, Clone, PartialEq)]
pub struct TemporalCalendar {
    pub id: String,
    pub intervals: Vec<(i64, i64)>,
}

/// Request for the temporal scheduling engine (parallel path, not yet
/// wired to the worker). Phase D1 uses `project_calendar_id` only;
/// per-task and per-lag calendar IDs are stored but not differentiated.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporalScheduleRequest {
    pub tasks: Vec<TemporalTaskInput>,
    pub relations: Vec<TemporalRelationInput>,
    pub calendars: Vec<TemporalCalendar>,
    pub project_calendar_id: String,
    pub data_date_minute: i64,
}

/// Per-task result from the temporal scheduling engine (parallel path).
/// All values are absolute minutes (i64), timezone-agnostic.
#[derive(Debug, Clone, PartialEq)]
pub struct TemporalScheduleResult {
    pub task_id: String,
    pub early_start_minute: i64,
    pub early_finish_minute: i64,
    pub late_start_minute: i64,
    pub late_finish_minute: i64,
    pub total_float_minutes: i64,
    pub free_float_minutes: i64,
    pub is_critical: bool,
}

// ── AI-FPA.3A: Float Path Analysis types ────────────────────────
//
// These types are consumed by `float_path::analyze_float_paths`.
// They are pure data — no scheduling math, no WASM, no Worker.

/// Input to the float path analysis function.
/// `schedule_results` must be the already-computed CPM results (ES/EF/LS/LF/TF).
/// The algorithm does NOT reschedule.
#[derive(Debug, Clone)]
pub struct FloatPathAnalysisInput {
    pub schedule_results: Vec<ScheduleResult>,
    pub dependencies: Vec<RawDependency>,
    pub target_task_id: String,
    pub max_paths: u32,
    pub near_critical_threshold_minutes: i32,
}

/// One activity entry within an ordered float path.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatPathActivity {
    /// 1-based position in the ordered activity sequence.
    pub sequence: u32,
    pub task_id: String,
    /// True if this activity is on the driving chain (i.e., all its
    /// outgoing relationships in this path are driving).
    /// The final (target) activity is always marked driving.
    pub is_driving: bool,
    pub total_float_minutes: i32,
}

/// One relationship entry within an ordered float path.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatPathRelationship {
    /// 1-based position in the ordered relationship sequence.
    pub sequence: u32,
    pub pred_task_id: String,
    pub succ_task_id: String,
    pub dep_type: DepType,
    /// Lag in the same integer day-offset unit used by the slot kernel.
    pub lag_minutes: i32,
    /// True when this relationship is the active schedule driver:
    /// the predecessor's anchor + lag equals the successor's constrained date.
    pub is_driving: bool,
}

/// One ranked path from a predecessor chain to the target task.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatPath {
    /// "P1", "P2", etc.
    pub path_id: String,
    /// 1-based rank (1 = most critical / lowest float).
    pub float_path_number: u32,
    /// Same value as `float_path_number` for MVP-v1 (contiguous sequence).
    pub float_path_order: u32,
    /// True only for the rank-1 path.
    pub is_primary_driving_path: bool,
    /// True when `path_total_float_minutes <= near_critical_threshold_minutes`.
    pub is_near_critical: bool,
    /// min(total_float) across all activities on this path.
    pub path_total_float_minutes: i32,
    /// Activities listed from chain-source to target, 1-based sequence.
    pub ordered_activities: Vec<FloatPathActivity>,
    /// Relationships listed from chain-source to target, 1-based sequence.
    /// Length = ordered_activities.len() - 1  (or 0 for single-task paths).
    pub ordered_relationships: Vec<FloatPathRelationship>,
}

/// Non-fatal warning codes emitted alongside a successful response.
#[derive(Debug, Clone, PartialEq)]
pub enum FloatPathWarningCode {
    TargetUnscheduled,
    NoPathsToTarget,
    MaxPathsClamped,
    SearchCapped,
    NearCriticalThresholdClamped,
}

/// A non-fatal warning in the float path response.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatPathWarning {
    pub code: FloatPathWarningCode,
    pub message: String,
}

/// Successful result of float path analysis.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatPathAnalysisResponse {
    pub paths: Vec<FloatPath>,
    pub warnings: Vec<FloatPathWarning>,
}

/// Fatal error from float path analysis.
#[derive(Debug, Clone, PartialEq)]
pub enum FloatPathAnalysisError {
    /// The requested target task ID was not found in `schedule_results`.
    TargetNotFound(String),
    /// An internal computation failure occurred (should not happen in normal use).
    ComputationFailed(String),
}
