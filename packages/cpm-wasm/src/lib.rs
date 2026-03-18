use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Boundary structs matching TypeScript protocol contract

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTask {
    id: String,
    duration: u32,
    #[serde(default)]
    min_early_start: u32,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    is_summary: bool,
    #[serde(default = "default_constraint_type")]
    constraint_type: String,
    #[serde(default)]
    constraint_date: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleDependency {
    pred_id: String,
    succ_id: String,
    #[serde(default = "default_dep_type")]
    dep_type: String,
    #[serde(default)]
    lag: i32,
}

fn default_constraint_type() -> String {
    "ASAP".to_string()
}

fn default_dep_type() -> String {
    "FS".to_string()
}

#[derive(Debug, Deserialize)]
struct ScheduleRequest {
    tasks: Vec<ScheduleTask>,
    dependencies: Vec<ScheduleDependency>,
    #[serde(default, rename = "nonWorkingDays")]
    non_working_days: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTaskResult {
    task_id: String,
    early_start: u32,
    early_finish: u32,
    late_start: u32,
    late_finish: u32,
    total_float: i32,
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
        duration: task.duration,
        min_early_start: task.min_early_start,
        parent_id: task.parent_id.clone(),
        is_summary: task.is_summary,
        constraint_type: parse_constraint_type(&task.constraint_type),
        constraint_date: task.constraint_date,
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
        lag: dep.lag,
    }
}

/// Convert kernel ScheduleResult to boundary ScheduleTaskResult
fn from_kernel_result(result: &cpm_kernel::ScheduleResult) -> ScheduleTaskResult {
    ScheduleTaskResult {
        task_id: result.task_id.clone(),
        early_start: result.early_start,
        early_finish: result.early_finish,
        late_start: result.late_start,
        late_finish: result.late_finish,
        total_float: result.total_float,
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

/// WASM entry point for schedule calculation
#[wasm_bindgen]
pub fn calculate_schedule(request: JsValue) -> Result<JsValue, JsValue> {
    let request: ScheduleRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize request: {}", e)))?;

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
