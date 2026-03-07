use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub struct RawTask {
    pub id: String,
    pub duration: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawDependency {
    pub pred_id: String,
    pub succ_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleResult {
    pub task_id: String,
    pub early_start: u32,
    pub early_finish: u32,
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
