//! Phase D1: Temporal scheduling engine — parallel kernel path.
//!
//! This module implements a CPM engine that operates on absolute minutes (i64)
//! with interval-based calendar awareness. It exists in parallel with the
//! slot-based `engine::calculate_schedule`, which remains the active
//! production path used by the worker.
//!
//! W5B-B1 constraints:
//! - Task date math uses each task calendar_id when present/valid.
//! - Missing/invalid task calendar_id deterministically falls back to project.
//! - Lag calendar_id remains deferred; lag uses project calendar only.
//! - Resource calendars are not active in this path.
//! - The worker uses this engine in shadow mode only (slot remains authoritative).

use std::collections::HashMap;
use crate::models::{
    ConstraintType, CpmError, DepType,
    TemporalScheduleRequest, TemporalScheduleResult,
};
use crate::temporal_graph::TemporalCpmGraph;

// ── Calendar-aware helpers (interval-based) ──────────────────────

/// Snap forward to the first working minute >= `minute`.
/// Intervals are sorted, non-overlapping half-open [start, end).
fn snap_forward(minute: i64, intervals: &[(i64, i64)]) -> i64 {
    // Find the first interval where end > minute
    let pos = intervals.partition_point(|&(_, e)| e <= minute);
    if pos < intervals.len() {
        let (s, _) = intervals[pos];
        if minute >= s { minute } else { s }
    } else {
        minute // past all intervals — fallback
    }
}

/// Advance by `duration` working minutes from `start`.
/// `start` should be a working minute. Returns the exclusive end minute.
fn advance_working(start: i64, duration: i64, intervals: &[(i64, i64)]) -> i64 {
    if duration == 0 {
        return start;
    }
    let idx = intervals.partition_point(|&(_, e)| e <= start);
    let mut remaining = duration;
    for i in idx..intervals.len() {
        let (s, e) = intervals[i];
        let begin = if i == idx { start.max(s) } else { s };
        let available = e - begin;
        if available <= 0 {
            continue;
        }
        if remaining <= available {
            return begin + remaining;
        }
        remaining -= available;
    }
    // Fallback: not enough working time in calendar
    start + duration
}

/// Snap backward to the last working minute <= `minute`.
fn snap_backward(minute: i64, intervals: &[(i64, i64)]) -> i64 {
    // Find the last interval where start <= minute
    let pos = intervals.partition_point(|&(s, _)| s <= minute);
    if pos == 0 {
        return minute; // before all intervals — fallback
    }
    let (_, e) = intervals[pos - 1];
    if minute < e {
        minute // inside interval
    } else {
        e - 1 // end of previous interval (last working minute)
    }
}

/// Retreat by `duration` working minutes ending at `finish` (exclusive upper bound).
/// Returns the start minute.
fn retreat_working(finish: i64, duration: i64, intervals: &[(i64, i64)]) -> i64 {
    if duration == 0 {
        return finish;
    }
    // Find intervals with start < finish (those that may contribute working time)
    let pos = intervals.partition_point(|&(s, _)| s < finish);
    let mut remaining = duration;
    for i in (0..pos).rev() {
        let (s, e) = intervals[i];
        let effective_end = finish.min(e);
        let available = effective_end - s;
        if available <= 0 {
            continue;
        }
        if remaining <= available {
            return effective_end - remaining;
        }
        remaining -= available;
    }
    // Fallback: not enough working time before finish
    (finish - duration).max(0)
}

/// Step forward by `lag` working minutes from `anchor`.
/// Positive lag: advance. Zero: identity. Negative: retreat.
fn step_forward_lag(anchor: i64, lag: i64, intervals: &[(i64, i64)]) -> i64 {
    if lag == 0 {
        return anchor;
    }
    if lag > 0 {
        let snapped = snap_forward(anchor, intervals);
        advance_working(snapped, lag, intervals)
    } else {
        retreat_working(anchor, -lag, intervals)
    }
}

/// Step backward by `lag` working minutes from `anchor`.
/// Positive lag: retreat. Zero: identity. Negative: advance.
fn step_backward_lag(anchor: i64, lag: i64, intervals: &[(i64, i64)]) -> i64 {
    if lag == 0 {
        return anchor;
    }
    if lag > 0 {
        retreat_working(anchor, lag, intervals)
    } else {
        let snapped = snap_forward(anchor, intervals);
        advance_working(snapped, -lag, intervals)
    }
}

// ── Dependency helpers ───────────────────────────────────────────

/// Predecessor anchor for a dependency in the forward pass.
fn pred_anchor_forward(dep_type: DepType, pred_es: i64, pred_ef: i64) -> i64 {
    match dep_type {
        DepType::FS | DepType::FF => pred_ef,
        DepType::SS | DepType::SF => pred_es,
    }
}

/// Does this dependency type constrain the successor's start (true) or finish (false)?
fn constrains_succ_start(dep_type: DepType) -> bool {
    match dep_type {
        DepType::FS | DepType::SS => true,
        DepType::FF | DepType::SF => false,
    }
}

/// Count working minutes between `from` and `to`, signed.
fn count_working_minutes_signed(from: i64, to: i64, intervals: &[(i64, i64)]) -> i64 {
    if to >= from {
        let mut count: i64 = 0;
        for &(s, e) in intervals {
            let overlap_start = from.max(s);
            let overlap_end = to.min(e);
            if overlap_start < overlap_end {
                count += overlap_end - overlap_start;
            }
        }
        count
    } else {
        let mut count: i64 = 0;
        for &(s, e) in intervals {
            let overlap_start = to.max(s);
            let overlap_end = from.min(e);
            if overlap_start < overlap_end {
                count += overlap_end - overlap_start;
            }
        }
        -count
    }
}

// ── Main temporal scheduling function ────────────────────────────
/// Run a CPM forward/backward pass on absolute-minute timeline.
///
/// This is the **parallel temporal kernel path** introduced in Phase D1.
/// It is NOT the active production scheduler — the worker still uses
/// `calculate_schedule` (slot kernel).
///
/// W5B-B1: task calendars are active for task math on the temporal shadow path.
/// Missing/invalid task calendar IDs fall back to `project_calendar_id`.
/// Lag calendars remain deferred: lag calculations continue to use project
/// calendar intervals for deterministic conservative behavior.
pub fn run_schedule_temporal(
    request: &TemporalScheduleRequest,
) -> Result<Vec<TemporalScheduleResult>, CpmError> {
    // Build calendar lookup
    let calendar_map: HashMap<&str, &[(i64, i64)]> = request
        .calendars
        .iter()
        .map(|c| (c.id.as_str(), c.intervals.as_slice()))
        .collect();

    // Project calendar remains the fallback for invalid task calendars and
    // the lag calendar source in W5B-B1.
    let project_intervals: &[(i64, i64)] = calendar_map
        .get(request.project_calendar_id.as_str())
        .copied()
        .unwrap_or(&[]);

    let graph = TemporalCpmGraph::build(&request.tasks, &request.relations)?;

    let task_intervals_for = |node: usize| {
        let task_calendar_id = graph.calendar_id[node].as_str();
        calendar_map
            .get(task_calendar_id)
            .copied()
            .unwrap_or(project_intervals)
    };

    // W5B-B1 conservative rule: lag calendar parity is deferred.
    let lag_intervals = project_intervals;

    if request.tasks.is_empty() {
        return Ok(Vec::new());
    }

    let topo_order = graph.topological_sort()?;
    let n = graph.node_to_id.len();
    let data_date = request.data_date_minute;

    // ── Forward pass ─────────────────────────────────────────────
    let mut early_start: Vec<i64> = vec![0; n];
    let mut early_finish: Vec<i64> = vec![0; n];

    for &node in &topo_order {
        if graph.is_summary[node] {
            continue;
        }
        let node_cal = task_intervals_for(node);

        let mut max_constrained_es: i64 = 0;
        let mut max_constrained_ef: i64 = 0;
        let mut has_ef_constraint = false;

        for &(pred, ref edge) in &graph.predecessors[node] {
            let anchor = pred_anchor_forward(edge.dep_type, early_start[pred], early_finish[pred]);
            let constrained = step_forward_lag(anchor, edge.lag_minutes, lag_intervals);

            if constrains_succ_start(edge.dep_type) {
                if constrained > max_constrained_es {
                    max_constrained_es = constrained;
                }
            } else {
                has_ef_constraint = true;
                if constrained > max_constrained_ef {
                    max_constrained_ef = constrained;
                }
            }
        }

        let raw_es = std::cmp::max(
            max_constrained_es,
            std::cmp::max(data_date, graph.min_early_start_minutes[node]),
        );

        if has_ef_constraint {
            let ef_derived_es = retreat_working(max_constrained_ef, graph.duration_minutes[node], node_cal);
            let es = snap_forward(std::cmp::max(raw_es, ef_derived_es), node_cal);
            early_start[node] = es;
            let ef = advance_working(es, graph.duration_minutes[node], node_cal);
            early_finish[node] = std::cmp::max(ef, max_constrained_ef);
        } else {
            early_start[node] = snap_forward(raw_es, node_cal);
            early_finish[node] = advance_working(early_start[node], graph.duration_minutes[node], node_cal);
        }

        // ── Apply forward-driving constraints ────────────────────
        match graph.constraint_type[node] {
            ConstraintType::SNET => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    if cd > early_start[node] {
                        early_start[node] = snap_forward(cd, node_cal);
                        early_finish[node] = advance_working(early_start[node], graph.duration_minutes[node], node_cal);
                    }
                }
            }
            ConstraintType::MSO => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    early_start[node] = snap_forward(cd, node_cal);
                    early_finish[node] = advance_working(early_start[node], graph.duration_minutes[node], node_cal);
                }
            }
            ConstraintType::MFO => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    early_finish[node] = cd;
                    early_start[node] = retreat_working(early_finish[node], graph.duration_minutes[node], node_cal);
                }
            }
            _ => {} // ASAP, ALAP, FNLT: no forward-pass change
        }
    }

    // ── Bottom-up summary rollup ─────────────────────────────────
    for &node in topo_order.iter().rev() {
        if !graph.is_summary[node] || graph.children[node].is_empty() {
            continue;
        }
        let mut min_es = i64::MAX;
        let mut max_ef = i64::MIN;
        for &child in &graph.children[node] {
            if early_start[child] < min_es {
                min_es = early_start[child];
            }
            if early_finish[child] > max_ef {
                max_ef = early_finish[child];
            }
        }
        early_start[node] = min_es;
        early_finish[node] = max_ef;
    }

    // ── Compute project duration ─────────────────────────────────
    let project_finish = early_finish.iter().copied().max().unwrap_or(0);

    // ── Backward pass ────────────────────────────────────────────
    let mut late_start: Vec<i64> = vec![0; n];
    let mut late_finish: Vec<i64> = vec![project_finish; n];

    for &node in topo_order.iter().rev() {
        if graph.is_summary[node] {
            late_start[node] = early_start[node];
            late_finish[node] = early_finish[node];
            continue;
        }
        let node_cal = task_intervals_for(node);

        if !graph.successors[node].is_empty() {
            let mut min_constrained_lf = i64::MAX;
            let mut min_constrained_ls = i64::MAX;
            let mut has_ls_constraint = false;

            for &(succ, ref edge) in &graph.successors[node] {
                if constrains_succ_start(edge.dep_type) {
                    let succ_late_boundary = late_start[succ];
                    let anchor = step_backward_lag(succ_late_boundary, edge.lag_minutes, lag_intervals);

                    match edge.dep_type {
                        DepType::FS => {
                            if anchor < min_constrained_lf {
                                min_constrained_lf = anchor;
                            }
                        }
                        DepType::SS => {
                            has_ls_constraint = true;
                            if anchor < min_constrained_ls {
                                min_constrained_ls = anchor;
                            }
                        }
                        _ => {}
                    }
                } else {
                    let succ_late_boundary = late_finish[succ];
                    let anchor = step_backward_lag(succ_late_boundary, edge.lag_minutes, lag_intervals);

                    match edge.dep_type {
                        DepType::FF => {
                            if anchor < min_constrained_lf {
                                min_constrained_lf = anchor;
                            }
                        }
                        DepType::SF => {
                            has_ls_constraint = true;
                            if anchor < min_constrained_ls {
                                min_constrained_ls = anchor;
                            }
                        }
                        _ => {}
                    }
                }
            }

            if min_constrained_lf < i64::MAX {
                late_finish[node] = min_constrained_lf;
            }

            late_start[node] = retreat_working(late_finish[node], graph.duration_minutes[node], node_cal);

            if has_ls_constraint && min_constrained_ls < late_start[node] {
                late_start[node] = snap_backward(min_constrained_ls, node_cal);
                late_finish[node] = advance_working(late_start[node], graph.duration_minutes[node], node_cal);
            }
        } else {
            late_start[node] = retreat_working(late_finish[node], graph.duration_minutes[node], node_cal);
        }

        // ── Apply backward-driving constraints ───────────────────
        match graph.constraint_type[node] {
            ConstraintType::FNLT => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    if cd < late_finish[node] {
                        late_finish[node] = cd;
                        late_start[node] = retreat_working(late_finish[node], graph.duration_minutes[node], node_cal);
                    }
                }
            }
            ConstraintType::MFO => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    late_finish[node] = cd;
                    late_start[node] = retreat_working(late_finish[node], graph.duration_minutes[node], node_cal);
                }
            }
            ConstraintType::MSO => {
                if let Some(cd) = graph.constraint_date_minutes[node] {
                    late_start[node] = snap_forward(cd, node_cal);
                    late_finish[node] = advance_working(late_start[node], graph.duration_minutes[node], node_cal);
                }
            }
            _ => {} // ASAP, ALAP, SNET: no backward-pass change
        }
    }

    // ── ALAP post-processing ─────────────────────────────────────
    for &node in &topo_order {
        if graph.is_summary[node] {
            continue;
        }
        if graph.constraint_type[node] == ConstraintType::ALAP {
            early_start[node] = late_start[node];
            early_finish[node] = late_finish[node];
        }
    }

    // ── Calculate float and criticality ──────────────────────────
    let mut results: Vec<TemporalScheduleResult> = Vec::with_capacity(n);
    for i in 0..n {
        let task_cal = task_intervals_for(i);
        let total_float = count_working_minutes_signed(early_finish[i], late_finish[i], task_cal);

        // Free float: minimum slack against any successor's early date
        let free_float = if graph.successors[i].is_empty() {
            total_float
        } else {
            let mut min_gap = i64::MAX;
            for &(succ, ref edge) in &graph.successors[i] {
                let pred_anchor = match edge.dep_type {
                    DepType::FS | DepType::FF => early_finish[i],
                    DepType::SS | DepType::SF => early_start[i],
                };
                let succ_boundary = if constrains_succ_start(edge.dep_type) {
                    early_start[succ]
                } else {
                    early_finish[succ]
                };
                let constrained = step_forward_lag(pred_anchor, edge.lag_minutes, lag_intervals);
                let gap = count_working_minutes_signed(constrained, succ_boundary, task_cal);
                if gap < min_gap {
                    min_gap = gap;
                }
            }
            min_gap
        };

        let is_critical = total_float <= 0;

        results.push(TemporalScheduleResult {
            task_id: graph.node_to_id[i].clone(),
            early_start_minute: early_start[i],
            early_finish_minute: early_finish[i],
            late_start_minute: late_start[i],
            late_finish_minute: late_finish[i],
            total_float_minutes: total_float,
            free_float_minutes: free_float,
            is_critical,
        });
    }

    Ok(results)
}
