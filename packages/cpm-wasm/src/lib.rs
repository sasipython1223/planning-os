use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// ABI version this engine expects. Must match ENGINE_ABI_VERSION in protocol/kernel.ts.
const EXPECTED_ABI_VERSION: u32 = 1;

/// Boundary structs matching TypeScript protocol contract

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTask {
    id: String,
    duration_work_minutes: u32,
    #[serde(default)]
    min_early_start_minutes: u32,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    is_summary: bool,
    #[serde(default = "default_constraint_type")]
    constraint_type: String,
    #[serde(default)]
    constraint_date_minutes: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleDependency {
    pred_id: String,
    succ_id: String,
    #[serde(default = "default_dep_type")]
    dep_type: String,
    #[serde(default)]
    lag_work_minutes: i32,
}

fn default_constraint_type() -> String {
    "ASAP".to_string()
}

fn default_dep_type() -> String {
    "FS".to_string()
}

#[derive(Debug, Deserialize)]
struct ScheduleRequest {
    #[serde(default, rename = "abiVersion")]
    abi_version: Option<u32>,
    tasks: Vec<ScheduleTask>,
    dependencies: Vec<ScheduleDependency>,
    #[serde(default, rename = "nonWorkingDays")]
    non_working_days: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTaskResult {
    task_id: String,
    early_start_minutes: u32,
    early_finish_minutes: u32,
    late_start_minutes: u32,
    late_finish_minutes: u32,
    total_float_minutes: i32,
    is_critical: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleResponse {
    schedule_version: u32,
    results: Vec<ScheduleTaskResult>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[allow(non_snake_case)]
enum ScheduleError {
    DuplicateTaskId { taskId: String, message: String },
    SelfDependency { taskId: String, message: String },
    TaskNotFound { taskId: String, message: String },
    CycleDetected { message: String },
}

/// Parse constraint type string to kernel ConstraintType
fn parse_constraint_type(s: &str) -> cpm_kernel::ConstraintType {
    match s {
        "ALAP" => cpm_kernel::ConstraintType::ALAP,
        "SNET" => cpm_kernel::ConstraintType::SNET,
        "FNLT" => cpm_kernel::ConstraintType::FNLT,
        "MSO" => cpm_kernel::ConstraintType::MSO,
        "MFO" => cpm_kernel::ConstraintType::MFO,
        _ => cpm_kernel::ConstraintType::ASAP,
    }
}

/// Convert boundary ScheduleTask to kernel RawTask
fn to_raw_task(task: &ScheduleTask) -> cpm_kernel::RawTask {
    cpm_kernel::RawTask {
        id: task.id.clone(),
        duration_work_minutes: task.duration_work_minutes,
        min_early_start_minutes: task.min_early_start_minutes,
        parent_id: task.parent_id.clone(),
        is_summary: task.is_summary,
        constraint_type: parse_constraint_type(&task.constraint_type),
        constraint_date_minutes: task.constraint_date_minutes,
    }
}

/// Parse dependency type string to kernel DepType
fn parse_dep_type(s: &str) -> cpm_kernel::DepType {
    match s {
        "SS" => cpm_kernel::DepType::SS,
        "FF" => cpm_kernel::DepType::FF,
        "SF" => cpm_kernel::DepType::SF,
        _ => cpm_kernel::DepType::FS,
    }
}

/// Convert boundary ScheduleDependency to kernel RawDependency
fn to_raw_dependency(dep: &ScheduleDependency) -> cpm_kernel::RawDependency {
    cpm_kernel::RawDependency {
        pred_id: dep.pred_id.clone(),
        succ_id: dep.succ_id.clone(),
        dep_type: parse_dep_type(&dep.dep_type),
        lag_work_minutes: dep.lag_work_minutes,
    }
}

/// Convert kernel ScheduleResult to boundary ScheduleTaskResult
fn from_kernel_result(result: &cpm_kernel::ScheduleResult) -> ScheduleTaskResult {
    ScheduleTaskResult {
        task_id: result.task_id.clone(),
        early_start_minutes: result.early_start_minutes,
        early_finish_minutes: result.early_finish_minutes,
        late_start_minutes: result.late_start_minutes,
        late_finish_minutes: result.late_finish_minutes,
        total_float_minutes: result.total_float_minutes,
        is_critical: result.is_critical,
    }
}

/// Convert kernel CpmError to boundary ScheduleError
fn from_kernel_error(err: cpm_kernel::CpmError) -> ScheduleError {
    match err {
        cpm_kernel::CpmError::DuplicateTaskId(task_id) => ScheduleError::DuplicateTaskId {
            taskId: task_id.clone(),
            message: format!("Duplicate task ID: {}", task_id),
        },
        cpm_kernel::CpmError::SelfDependency(task_id) => ScheduleError::SelfDependency {
            taskId: task_id.clone(),
            message: format!("Self-dependency detected for task: {}", task_id),
        },
        cpm_kernel::CpmError::TaskNotFound(task_id) => ScheduleError::TaskNotFound {
            taskId: task_id.clone(),
            message: format!("Task not found: {}", task_id),
        },
        cpm_kernel::CpmError::CycleDetected => ScheduleError::CycleDetected {
            message: "Cycle detected in dependency graph".to_string(),
        },
    }
}

/// Convert boundary TemporalTaskBoundary to kernel TemporalTaskInput (D8b)
fn to_temporal_task_input(task: &TemporalTaskBoundary) -> cpm_kernel::TemporalTaskInput {
    cpm_kernel::TemporalTaskInput {
        id: task.id.clone(),
        duration_minutes: task.duration_minutes,
        min_early_start_minutes: task.min_early_start_minutes,
        calendar_id: task.calendar_id.clone(),
        parent_id: task.parent_id.clone(),
        is_summary: task.is_summary,
        constraint_type: parse_constraint_type(&task.constraint_type),
        constraint_date_minutes: task.constraint_date_minute,
    }
}

/// Convert boundary TemporalRelationBoundary to kernel TemporalRelationInput (D8b)
fn to_temporal_relation_input(dep: &TemporalRelationBoundary) -> cpm_kernel::TemporalRelationInput {
    cpm_kernel::TemporalRelationInput {
        pred_id: dep.pred_id.clone(),
        succ_id: dep.succ_id.clone(),
        dep_type: parse_dep_type(&dep.dep_type),
        lag_minutes: dep.lag_minutes,
        lag_calendar_id: dep.lag_calendar_id.clone(),
    }
}

/// Convert boundary TemporalCalendarBoundary to kernel TemporalCalendar (D8b)
fn to_temporal_calendar(cal: &TemporalCalendarBoundary) -> cpm_kernel::TemporalCalendar {
    cpm_kernel::TemporalCalendar {
        id: cal.id.clone(),
        intervals: cal.intervals.clone(),
    }
}

/// Convert kernel TemporalScheduleResult to boundary TemporalTaskResultBoundary (D8b)
fn from_temporal_kernel_result(result: &cpm_kernel::TemporalScheduleResult) -> TemporalTaskResultBoundary {
    TemporalTaskResultBoundary {
        task_id: result.task_id.clone(),
        early_start_minute: result.early_start_minute,
        early_finish_minute: result.early_finish_minute,
        late_start_minute: result.late_start_minute,
        late_finish_minute: result.late_finish_minute,
        total_float_minutes: result.total_float_minutes,
        free_float_minutes: result.free_float_minutes,
        is_critical: result.is_critical,
    }
}

/// WASM entry point for schedule calculation (ABI v1, authoritative slot path)
#[wasm_bindgen]
pub fn calculate_schedule(request: JsValue) -> Result<JsValue, JsValue> {
    let request: ScheduleRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize request: {}", e)))?;

    // ABI version gate — fail fast on stale worker/wasm pairing
    match request.abi_version {
        None => {
            return Err(JsValue::from_str(
                &format!("ABI version mismatch: worker sent no abiVersion, wasm expects v{}. Hard refresh may be required.", EXPECTED_ABI_VERSION)
            ));
        }
        Some(v) if v != EXPECTED_ABI_VERSION => {
            return Err(JsValue::from_str(
                &format!("ABI version mismatch: worker sent v{}, wasm expects v{}. Hard refresh may be required.", v, EXPECTED_ABI_VERSION)
            ));
        }
        Some(_) => { /* version matches, proceed */ }
    }

    let tasks: Vec<cpm_kernel::RawTask> = request.tasks.iter().map(to_raw_task).collect();
    let deps: Vec<cpm_kernel::RawDependency> =
        request.dependencies.iter().map(to_raw_dependency).collect();

    match cpm_kernel::calculate_schedule(&tasks, &deps, &request.non_working_days) {
        Ok(results) => {
            let response = ScheduleResponse {
                schedule_version: 1,
                results: results.iter().map(from_kernel_result).collect(),
            };
            serde_wasm_bindgen::to_value(&response)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {}", e)))
        }
        Err(err) => {
            let error = from_kernel_error(err);
            serde_wasm_bindgen::to_value(&error)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize error: {}", e)))
        }
    }
}

/// WASM entry point for minute-native schedule calculation (ABI v2, non-authoritative shadow path)
/// 
/// D8b: Non-authoritative acceptance path for MinuteScheduleRequest.
/// Routes to temporal kernel (run_schedule_temporal).
/// Worker does NOT call this entrypoint yet; slot path (calculate_schedule) remains authoritative.
/// Results are shadow/diagnostic only.
#[wasm_bindgen]
pub fn calculate_schedule_minute(request: JsValue) -> Result<JsValue, JsValue> {
    let request: TemporalScheduleRequestBoundary = serde_wasm_bindgen::from_value(request)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize minute request: {}", e)))?;

    // ABI v2 gate — accept only minute-native ABI version
    match request.abi_version {
        None => {
            return Err(JsValue::from_str(
                "ABI version mismatch: minute request must have abiVersion = 2"
            ));
        }
        Some(2) => { /* v2 expected, proceed */ }
        Some(v) => {
            return Err(JsValue::from_str(
                &format!("ABI version mismatch: minute request sent v{}, wasm minute path expects v2", v)
            ));
        }
    }

    // Convert boundary structs to kernel input types
    let tasks: Vec<cpm_kernel::TemporalTaskInput> =
        request.tasks.iter().map(to_temporal_task_input).collect();
    let relations: Vec<cpm_kernel::TemporalRelationInput> =
        request.dependencies.iter().map(to_temporal_relation_input).collect();
    let calendars: Vec<cpm_kernel::TemporalCalendar> =
        request.calendars.iter().map(to_temporal_calendar).collect();

    let kernel_request = cpm_kernel::TemporalScheduleRequest {
        tasks,
        relations,
        calendars,
        project_calendar_id: request.project_calendar_id,
        data_date_minute: request.data_date_minute,
    };

    // Call temporal kernel (non-authoritative path)
    match cpm_kernel::run_schedule_temporal(&kernel_request) {
        Ok(results) => {
            let response = TemporalScheduleResponseBoundary {
                schedule_version: 1,
                results: results.iter().map(from_temporal_kernel_result).collect(),
            };
            serde_wasm_bindgen::to_value(&response)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize minute response: {}", e)))
        }
        Err(err) => {
            let error = from_kernel_error(err);
            serde_wasm_bindgen::to_value(&error)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize error: {}", e)))
        }
    }
}

// ── Phase D1: Temporal scheduling WASM boundary ──────────────
//
// Parallel temporal kernel entry point. NOT used by the worker yet.
// The worker continues to call calculate_schedule (slot kernel).
// These boundary structs exist only for the temporal kernel path.
//
// D8b: Added non-authoritative calculate_schedule_minute entrypoint (ABI v2)
// to accept MinuteScheduleRequest and route to temporal kernel. Slot path
// (calculate_schedule, ABI v1) remains the sole authoritative entrypoint.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalTaskBoundary {
    id: String,
    duration_minutes: i64,
    #[serde(default)]
    min_early_start_minutes: i64,
    #[serde(default)]
    calendar_id: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    is_summary: bool,
    #[serde(default = "default_constraint_type")]
    constraint_type: String,
    #[serde(default)]
    constraint_date_minute: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalRelationBoundary {
    pred_id: String,
    succ_id: String,
    #[serde(default = "default_dep_type")]
    dep_type: String,
    #[serde(default)]
    lag_minutes: i64,
    #[serde(default)]
    lag_calendar_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalCalendarBoundary {
    id: String,
    intervals: Vec<(i64, i64)>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalScheduleRequestBoundary {
    #[serde(default, rename = "abiVersion")]
    abi_version: Option<u32>,
    tasks: Vec<TemporalTaskBoundary>,
    dependencies: Vec<TemporalRelationBoundary>,
    calendars: Vec<TemporalCalendarBoundary>,
    project_calendar_id: String,
    #[serde(default)]
    data_date_minute: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TemporalTaskResultBoundary {
    task_id: String,
    early_start_minute: i64,
    early_finish_minute: i64,
    late_start_minute: i64,
    late_finish_minute: i64,
    total_float_minutes: i64,
    free_float_minutes: i64,
    is_critical: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TemporalScheduleResponseBoundary {
    schedule_version: u32,
    results: Vec<TemporalTaskResultBoundary>,
}

// ── D8b: Old D1 temporal WASM entrypoint removed ──────────────
// Phase D1's run_schedule_temporal() WASM export is superseded by
// the official D8b calculate_schedule_minute() non-authoritative path.
// The timeline kernel path uses the same temporal boundary structs but
// is accessed through calculate_schedule_minute (ABI v2) only.

// ── AI-FPA.3C: Float Path Analysis WASM boundary ──────────────
//
// Exposes cpm_kernel::analyze_float_paths through the WASM boundary.
// The kernel is not modified. The worker does NOT call this yet.
// No protocol changes. No worker orchestration. No UI.

/// Schedule result passed in with the float path analysis request.
/// Shape mirrors the output of calculate_schedule (ScheduleTaskResult)
/// so the worker can pass its cached results directly without reshaping.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathScheduleResultBoundary {
    task_id: String,
    early_start_minutes: u32,
    early_finish_minutes: u32,
    late_start_minutes: u32,
    late_finish_minutes: u32,
    total_float_minutes: i32,
    is_critical: bool,
}

/// Top-level request for float path analysis.
/// Bundles analysis parameters with the already-computed schedule results
/// and dependencies. The kernel does NOT reschedule.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathRequestBoundary {
    #[serde(default, rename = "analysisVersion")]
    analysis_version: Option<u32>,
    #[serde(default)]
    schedule_version: u32,
    target_task_id: String,
    max_paths: u32,
    near_critical_threshold_minutes: i32,
    /// Already-computed CPM results from calculate_schedule.
    schedule_results: Vec<FloatPathScheduleResultBoundary>,
    /// Same dependency list used for schedule calculation.
    dependencies: Vec<ScheduleDependency>,
}

/// Activity entry within an ordered float path.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathActivityBoundary {
    sequence: u32,
    task_id: String,
    is_driving: bool,
    total_float_minutes: i32,
}

/// Relationship entry within an ordered float path.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathRelationshipBoundary {
    sequence: u32,
    pred_task_id: String,
    succ_task_id: String,
    dep_type: String,
    lag_minutes: i32,
    is_driving: bool,
}

/// One ranked path in the float path response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathPathBoundary {
    path_id: String,
    float_path_number: u32,
    float_path_order: u32,
    is_primary_driving_path: bool,
    is_near_critical: bool,
    path_total_float_minutes: i32,
    ordered_activities: Vec<FloatPathActivityBoundary>,
    ordered_relationships: Vec<FloatPathRelationshipBoundary>,
}

/// Target task identification in the float path response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathTargetBoundary {
    task_id: String,
}

/// Aggregate summary computed at the WASM boundary from the returned paths.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathSummaryBoundary {
    primary_path_id: Option<String>,
    returned_path_count: usize,
    requested_path_count: u32,
    near_critical_path_count: usize,
}

/// Non-fatal warning in the float path response.
/// Matches FloatPathMvpWarning from protocol/src/kernel.ts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathWarningBoundary {
    code: String,
    message: String,
    severity: String,
}

/// Top-level successful float path analysis response.
/// Field names match FloatPathMvpResponse from protocol/src/kernel.ts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathResponseBoundary {
    analysis_version: u32,
    schedule_version: u32,
    mode: String,
    target: FloatPathTargetBoundary,
    summary: FloatPathSummaryBoundary,
    paths: Vec<FloatPathPathBoundary>,
    warnings: Vec<FloatPathWarningBoundary>,
}

/// Error response for float path analysis.
/// Matches FloatPathMvpError from protocol/src/kernel.ts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatPathErrorBoundary {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

/// Convert kernel DepType to protocol string.
fn dep_type_to_str(dt: &cpm_kernel::DepType) -> String {
    match dt {
        cpm_kernel::DepType::FS => "FS".to_string(),
        cpm_kernel::DepType::SS => "SS".to_string(),
        cpm_kernel::DepType::FF => "FF".to_string(),
        cpm_kernel::DepType::SF => "SF".to_string(),
    }
}

/// Convert kernel FloatPathWarningCode to protocol code string and severity.
fn warning_code_to_str_and_severity(
    code: &cpm_kernel::FloatPathWarningCode,
) -> (&'static str, &'static str) {
    match code {
        cpm_kernel::FloatPathWarningCode::TargetUnscheduled =>
            ("TARGET_UNSCHEDULED", "warning"),
        cpm_kernel::FloatPathWarningCode::NoPathsToTarget =>
            ("NO_PATHS_TO_TARGET", "warning"),
        cpm_kernel::FloatPathWarningCode::MaxPathsClamped =>
            ("MAX_PATHS_CLAMPED", "warning"),
        cpm_kernel::FloatPathWarningCode::SearchCapped =>
            ("SEARCH_CAPPED", "warning"),
        cpm_kernel::FloatPathWarningCode::NearCriticalThresholdClamped =>
            ("NEAR_CRITICAL_THRESHOLD_CLAMPED", "info"),
    }
}

/// Convert boundary FloatPathScheduleResultBoundary to kernel ScheduleResult.
fn to_kernel_schedule_result(r: &FloatPathScheduleResultBoundary) -> cpm_kernel::ScheduleResult {
    cpm_kernel::ScheduleResult {
        task_id: r.task_id.clone(),
        early_start_minutes: r.early_start_minutes,
        early_finish_minutes: r.early_finish_minutes,
        late_start_minutes: r.late_start_minutes,
        late_finish_minutes: r.late_finish_minutes,
        total_float_minutes: r.total_float_minutes,
        is_critical: r.is_critical,
    }
}

/// Convert kernel FloatPath to boundary FloatPathPathBoundary.
fn from_kernel_float_path(path: &cpm_kernel::FloatPath) -> FloatPathPathBoundary {
    FloatPathPathBoundary {
        path_id: path.path_id.clone(),
        float_path_number: path.float_path_number,
        float_path_order: path.float_path_order,
        is_primary_driving_path: path.is_primary_driving_path,
        is_near_critical: path.is_near_critical,
        path_total_float_minutes: path.path_total_float_minutes,
        ordered_activities: path
            .ordered_activities
            .iter()
            .map(|a| FloatPathActivityBoundary {
                sequence: a.sequence,
                task_id: a.task_id.clone(),
                is_driving: a.is_driving,
                total_float_minutes: a.total_float_minutes,
            })
            .collect(),
        ordered_relationships: path
            .ordered_relationships
            .iter()
            .map(|r| FloatPathRelationshipBoundary {
                sequence: r.sequence,
                pred_task_id: r.pred_task_id.clone(),
                succ_task_id: r.succ_task_id.clone(),
                dep_type: dep_type_to_str(&r.dep_type),
                lag_minutes: r.lag_minutes,
                is_driving: r.is_driving,
            })
            .collect(),
    }
}

/// WASM entry point for float path analysis (AI-FPA.3C).
///
/// Accepts solved schedule results and dependencies; does NOT reschedule.
/// Returns deterministic ranked float paths from predecessors to the target.
///
/// The worker does NOT call this yet. Wire-up is deferred to AI-FPA.3D.
#[wasm_bindgen]
pub fn analyze_float_paths(request: JsValue) -> Result<JsValue, JsValue> {
    let request: FloatPathRequestBoundary = serde_wasm_bindgen::from_value(request)
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to deserialize float path request: {}",
                e
            ))
        })?;

    // Analysis version gate — MVP-v1 accepts only analysisVersion: 1
    match request.analysis_version {
        None => {
            return Err(JsValue::from_str(
                "Float path analysis request must include analysisVersion: 1",
            ));
        }
        Some(1) => { /* expected, proceed */ }
        Some(v) => {
            return Err(JsValue::from_str(&format!(
                "Float path analysis version mismatch: got {}, expected 1",
                v
            )));
        }
    }

    let schedule_results: Vec<cpm_kernel::ScheduleResult> = request
        .schedule_results
        .iter()
        .map(to_kernel_schedule_result)
        .collect();
    let dependencies: Vec<cpm_kernel::RawDependency> = request
        .dependencies
        .iter()
        .map(to_raw_dependency)
        .collect();

    let kernel_input = cpm_kernel::FloatPathAnalysisInput {
        schedule_results,
        dependencies,
        target_task_id: request.target_task_id.clone(),
        max_paths: request.max_paths,
        near_critical_threshold_minutes: request.near_critical_threshold_minutes,
    };

    match cpm_kernel::analyze_float_paths(kernel_input) {
        Ok(resp) => {
            let paths: Vec<FloatPathPathBoundary> =
                resp.paths.iter().map(from_kernel_float_path).collect();
            let warnings: Vec<FloatPathWarningBoundary> = resp
                .warnings
                .iter()
                .map(|w| {
                    let (code, severity) = warning_code_to_str_and_severity(&w.code);
                    FloatPathWarningBoundary {
                        code: code.to_string(),
                        message: w.message.clone(),
                        severity: severity.to_string(),
                    }
                })
                .collect();
            let near_critical_count = paths.iter().filter(|p| p.is_near_critical).count();
            let primary_path_id = paths.first().map(|p| p.path_id.clone());
            let response = FloatPathResponseBoundary {
                analysis_version: 1,
                schedule_version: request.schedule_version,
                mode: "total_float".to_string(),
                target: FloatPathTargetBoundary {
                    task_id: request.target_task_id,
                },
                summary: FloatPathSummaryBoundary {
                    primary_path_id,
                    returned_path_count: paths.len(),
                    requested_path_count: request.max_paths,
                    near_critical_path_count: near_critical_count,
                },
                paths,
                warnings,
            };
            serde_wasm_bindgen::to_value(&response)
                .map_err(|e| JsValue::from_str(&format!(
                    "Failed to serialize float path response: {}",
                    e
                )))
        }
        Err(cpm_kernel::FloatPathAnalysisError::TargetNotFound(id)) => {
            let error = FloatPathErrorBoundary {
                error_type: "TargetNotFound".to_string(),
                message: format!("Target task not found in schedule results: {}", id),
            };
            serde_wasm_bindgen::to_value(&error)
                .map_err(|e| JsValue::from_str(&format!(
                    "Failed to serialize float path error: {}",
                    e
                )))
        }
        Err(cpm_kernel::FloatPathAnalysisError::ComputationFailed(msg)) => {
            let error = FloatPathErrorBoundary {
                error_type: "ComputationFailed".to_string(),
                message: msg,
            };
            serde_wasm_bindgen::to_value(&error)
                .map_err(|e| JsValue::from_str(&format!(
                    "Failed to serialize float path error: {}",
                    e
                )))
        }
    }
}

