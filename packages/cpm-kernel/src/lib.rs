mod engine;
mod float_path;
mod graph;
mod models;
mod temporal;
mod temporal_graph;

// ── Active production path (slot kernel) ─────────────────────────
pub use engine::calculate_schedule;
pub use models::{ConstraintType, CpmError, DepType, RawDependency, RawTask, ScheduleResult};

// ── Parallel temporal kernel path (Phase D1, not wired to worker) ─
pub use models::{
    TemporalCalendar, TemporalRelationInput, TemporalScheduleRequest,
    TemporalScheduleResult, TemporalTaskInput,
};
pub use temporal::run_schedule_temporal;

// ── AI-FPA.3A: Float path analysis (kernel-only, not wired to WASM/worker) ─
pub use float_path::analyze_float_paths;
pub use models::{
    FloatPath, FloatPathActivity, FloatPathAnalysisError, FloatPathAnalysisInput,
    FloatPathAnalysisResponse, FloatPathRelationship, FloatPathWarning, FloatPathWarningCode,
};
