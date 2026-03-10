use std::collections::HashSet;
use crate::graph::CpmGraph;
use crate::models::{CpmError, DepType, RawDependency, RawTask, ScheduleResult};

// ── Calendar-aware helpers ───────────────────────────────────────

/// Snap a day forward to the next working day.
fn snap_forward(day: u32, blocked: &HashSet<u32>) -> u32 {
    let mut d = day;
    while blocked.contains(&d) {
        d += 1;
    }
    d
}

/// Advance by `duration` working days from `start` (which must already be a working day).
/// Returns the finish offset (the day *after* the last working day consumed).
fn advance_working(start: u32, duration: u32, blocked: &HashSet<u32>) -> u32 {
    if duration == 0 {
        return start;
    }
    let mut remaining = duration;
    let mut d = start;
    loop {
        if !blocked.contains(&d) {
            remaining -= 1;
            if remaining == 0 {
                return d + 1;
            }
        }
        d += 1;
    }
}

/// Snap a day backward to the previous working day.
fn snap_backward(day: u32, blocked: &HashSet<u32>) -> u32 {
    let mut d = day;
    while d > 0 && blocked.contains(&d) {
        d -= 1;
    }
    d
}

/// Retreat by `duration` working days ending at `finish` (exclusive upper bound).
/// Returns the late-start offset.
fn retreat_working(finish: u32, duration: u32, blocked: &HashSet<u32>) -> u32 {
    if duration == 0 {
        return finish;
    }
    let mut remaining = duration;
    let mut d = if finish > 0 { finish - 1 } else { 0 };
    while blocked.contains(&d) && d > 0 {
        d -= 1;
    }
    loop {
        if !blocked.contains(&d) {
            remaining -= 1;
            if remaining == 0 {
                return d;
            }
        }
        if d == 0 {
            break;
        }
        d -= 1;
    }
    d
}

/// Step forward by `lag` working days from `anchor`.
/// Positive lag: advance. Zero: identity. Negative: retreat (clamped to 0).
fn step_forward_lag(anchor: u32, lag: i32, blocked: &HashSet<u32>) -> u32 {
    if lag == 0 {
        return anchor;
    }
    if lag > 0 {
        let mut remaining = lag as u32;
        let mut d = anchor;
        while remaining > 0 {
            if !blocked.contains(&d) {
                remaining -= 1;
                if remaining == 0 {
                    return d + 1;
                }
            }
            d += 1;
        }
        d
    } else {
        let abs_lag = (-lag) as u32;
        let mut remaining = abs_lag;
        if anchor == 0 {
            return 0;
        }
        let mut d = anchor - 1;
        loop {
            if !blocked.contains(&d) {
                remaining -= 1;
                if remaining == 0 {
                    return d;
                }
            }
            if d == 0 {
                return 0;
            }
            d -= 1;
        }
    }
}

/// Step backward by `lag` working days from `anchor`.
/// Positive lag: retreat. Zero: identity. Negative: advance.
fn step_backward_lag(anchor: u32, lag: i32, blocked: &HashSet<u32>) -> u32 {
    if lag == 0 {
        return anchor;
    }
    if lag > 0 {
        let abs_lag = lag as u32;
        let mut remaining = abs_lag;
        if anchor == 0 {
            return 0;
        }
        let mut d = anchor - 1;
        loop {
            if !blocked.contains(&d) {
                remaining -= 1;
                if remaining == 0 {
                    return d;
                }
            }
            if d == 0 {
                return 0;
            }
            d -= 1;
        }
    } else {
        let abs_lag = (-lag) as u32;
        let mut remaining = abs_lag;
        let mut d = anchor;
        while remaining > 0 {
            if !blocked.contains(&d) {
                remaining -= 1;
                if remaining == 0 {
                    return d + 1;
                }
            }
            d += 1;
        }
        d
    }
}

// ── Normalized constraint helpers ────────────────────────────────

/// Predecessor anchor for a dependency in the forward pass.
fn pred_anchor_forward(dep_type: DepType, pred_es: u32, pred_ef: u32) -> u32 {
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

/// Working-day float: signed count of working days from `from` to `to`.
fn count_working_days_signed(from: u32, to: u32, blocked: &HashSet<u32>) -> i32 {
    if to >= from {
        let mut count: i32 = 0;
        for d in from..to {
            if !blocked.contains(&d) {
                count += 1;
            }
        }
        count
    } else {
        let mut count: i32 = 0;
        for d in to..from {
            if !blocked.contains(&d) {
                count += 1;
            }
        }
        -count
    }
}

// ── Main scheduling function ─────────────────────────────────────

pub fn calculate_schedule(
    tasks: &[RawTask],
    deps: &[RawDependency],
    non_working_days: &[u32],
) -> Result<Vec<ScheduleResult>, CpmError> {
    let graph = CpmGraph::build(tasks, deps)?;
    let blocked: HashSet<u32> = non_working_days.iter().copied().collect();

    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    let topo_order = graph.topological_sort()?;
    let n = graph.node_to_id.len();

    // ── Forward pass ─────────────────────────────────────────────
    let mut early_start: Vec<u32> = vec![0; n];
    let mut early_finish: Vec<u32> = vec![0; n];

    for &node in &topo_order {
        if graph.is_summary[node] {
            continue;
        }

        let mut max_constrained_es: u32 = 0;
        let mut max_constrained_ef: u32 = 0;
        let mut has_ef_constraint = false;

        for &(pred, ref edge) in &graph.predecessors[node] {
            let anchor = pred_anchor_forward(edge.dep_type, early_start[pred], early_finish[pred]);
            let constrained = step_forward_lag(anchor, edge.lag, &blocked);

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

        let raw_es = std::cmp::max(max_constrained_es, graph.min_early_start[node]);

        if has_ef_constraint {
            // Derive ES from the EF constraint
            let ef_derived_es = retreat_working(max_constrained_ef, graph.durations[node], &blocked);
            let es = snap_forward(std::cmp::max(raw_es, ef_derived_es), &blocked);
            early_start[node] = es;
            let ef = advance_working(es, graph.durations[node], &blocked);
            early_finish[node] = std::cmp::max(ef, max_constrained_ef);
        } else {
            early_start[node] = snap_forward(raw_es, &blocked);
            early_finish[node] = advance_working(early_start[node], graph.durations[node], &blocked);
        }
    }

    // ── Bottom-up summary rollup ─────────────────────────────────
    for &node in topo_order.iter().rev() {
        if !graph.is_summary[node] || graph.children[node].is_empty() {
            continue;
        }
        let mut min_es = u32::MAX;
        let mut max_ef = 0u32;
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
    let project_duration = early_finish.iter().copied().max().unwrap_or(0);

    // ── Backward pass ────────────────────────────────────────────
    let mut late_start: Vec<u32> = vec![0; n];
    let mut late_finish: Vec<u32> = vec![project_duration; n];

    for &node in topo_order.iter().rev() {
        if graph.is_summary[node] {
            // Summary backward dates are set by Worker rollup
            late_start[node] = early_start[node];
            late_finish[node] = early_finish[node];
            continue;
        }

        if !graph.successors[node].is_empty() {
            let mut min_constrained_lf = u32::MAX;
            let mut min_constrained_ls = u32::MAX;
            let mut has_ls_constraint = false;

            for &(succ, ref edge) in &graph.successors[node] {
                if constrains_succ_start(edge.dep_type) {
                    // FS or SS: constrains successor start → backward from succ late_start
                    let succ_late_boundary = late_start[succ];
                    let anchor = step_backward_lag(succ_late_boundary, edge.lag, &blocked);

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
                    // FF or SF: constrains successor finish → backward from succ late_finish
                    let succ_late_boundary = late_finish[succ];
                    let anchor = step_backward_lag(succ_late_boundary, edge.lag, &blocked);

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

            // Apply LF constraint from FS/FF edges
            if min_constrained_lf < u32::MAX {
                late_finish[node] = min_constrained_lf;
            }

            // Derive LS from LF
            late_start[node] = retreat_working(late_finish[node], graph.durations[node], &blocked);

            // If there's also an LS constraint from SS/SF edges, apply minimum
            if has_ls_constraint && min_constrained_ls < late_start[node] {
                late_start[node] = snap_backward(min_constrained_ls, &blocked);
                // Recompute LF to preserve task duration (avoid elastic late dates)
                late_finish[node] = advance_working(late_start[node], graph.durations[node], &blocked);
            }
        } else {
            late_start[node] = retreat_working(late_finish[node], graph.durations[node], &blocked);
        }
    }

    // ── Calculate total float and critical path ──────────────────
    let mut results: Vec<ScheduleResult> = Vec::with_capacity(n);
    for i in 0..n {
        let total_float = count_working_days_signed(early_start[i], late_start[i], &blocked);
        let is_critical = total_float <= 0;

        results.push(ScheduleResult {
            task_id: graph.node_to_id[i].clone(),
            early_start: early_start[i],
            early_finish: early_finish[i],
            late_start: late_start[i],
            late_finish: late_finish[i],
            total_float,
            is_critical,
        });
    }

    Ok(results)
}
