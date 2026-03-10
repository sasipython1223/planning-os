use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DepType {
    FS,
    SS,
    FF,
    SF,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawTask {
    pub id: String,
    pub duration: u32,
    pub min_early_start: u32,
    pub parent_id: Option<String>,
    pub is_summary: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawDependency {
    pub pred_id: String,
    pub succ_id: String,
    pub dep_type: DepType,
    pub lag: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleResult {
    pub task_id: String,
    pub early_start: u32,
    pub early_finish: u32,
    pub late_start: u32,
    pub late_finish: u32,
    pub total_float: i32,
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
