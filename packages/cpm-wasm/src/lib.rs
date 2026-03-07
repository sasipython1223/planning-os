use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Boundary structs matching TypeScript protocol contract

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTask {
    id: String,
    duration: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleDependency {
    pred_id: String,
    succ_id: String,
}

#[derive(Debug, Deserialize)]
struct ScheduleRequest {
    tasks: Vec<ScheduleTask>,
    dependencies: Vec<ScheduleDependency>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleTaskResult {
    task_id: String,
    early_start: u32,
    early_finish: u32,
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

/// Convert boundary ScheduleTask to kernel RawTask
fn to_raw_task(task: &ScheduleTask) -> cpm_kernel::RawTask {
    cpm_kernel::RawTask {
        id: task.id.clone(),
        duration: task.duration,
    }
}

/// Convert boundary ScheduleDependency to kernel RawDependency
fn to_raw_dependency(dep: &ScheduleDependency) -> cpm_kernel::RawDependency {
    cpm_kernel::RawDependency {
        pred_id: dep.pred_id.clone(),
        succ_id: dep.succ_id.clone(),
    }
}

/// Convert kernel ScheduleResult to boundary ScheduleTaskResult
fn from_kernel_result(result: &cpm_kernel::ScheduleResult) -> ScheduleTaskResult {
    ScheduleTaskResult {
        task_id: result.task_id.clone(),
        early_start: result.early_start,
        early_finish: result.early_finish,
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
///
/// Accepts a JS ScheduleRequest object, calls the CPM kernel,
/// and returns either a ScheduleResponse or ScheduleError.
#[wasm_bindgen]
pub fn calculate_schedule(request: JsValue) -> Result<JsValue, JsValue> {
    // Deserialize request from JS
    let request: ScheduleRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize request: {}", e)))?;

    // Convert boundary types to kernel types
    let tasks: Vec<cpm_kernel::RawTask> = request.tasks.iter().map(to_raw_task).collect();
    let deps: Vec<cpm_kernel::RawDependency> =
        request.dependencies.iter().map(to_raw_dependency).collect();

    // Call kernel
    match cpm_kernel::calculate_schedule(&tasks, &deps) {
        Ok(results) => {
            // Success: convert kernel results to boundary response
            let response = ScheduleResponse {
                schedule_version: 1,
                results: results.iter().map(from_kernel_result).collect(),
            };
            serde_wasm_bindgen::to_value(&response)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {}", e)))
        }
        Err(err) => {
            // Error: convert kernel error to boundary error
            let error = from_kernel_error(err);
            serde_wasm_bindgen::to_value(&error)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize error: {}", e)))
        }
    }
}
