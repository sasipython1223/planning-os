use std::collections::HashSet;
use crate::graph::CpmGraph;
use crate::models::{CpmError, RawDependency, RawTask, ScheduleResult};

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
                return d + 1; // finish = day after last working day
            }
        }
        d += 1;
    }
}

/// Snap a day backward to the previous working day.
#[allow(dead_code)]
fn snap_backward(day: u32, blocked: &HashSet<u32>) -> u32 {
    let mut d = day;
    while d > 0 && blocked.contains(&d) {
        d -= 1;
    }
    d
}

/// Count working days in the half-open interval [from, to).
fn count_working_days(from: u32, to: u32, blocked: &HashSet<u32>) -> u32 {
    if to <= from {
        return 0;
    }
    let mut count = 0;
    for d in from..to {
        if !blocked.contains(&d) {
            count += 1;
        }
    }
    count
}

/// Retreat by `duration` working days ending at `finish` (exclusive upper bound).
/// Returns the late-start offset.
fn retreat_working(finish: u32, duration: u32, blocked: &HashSet<u32>) -> u32 {
    if duration == 0 {
        return finish;
    }
    let mut remaining = duration;
    let mut d = if finish > 0 { finish - 1 } else { 0 };
    // snap to a working day first
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

pub fn calculate_schedule(
    tasks: &[RawTask],
    deps: &[RawDependency],
    non_working_days: &[u32],
) -> Result<Vec<ScheduleResult>, CpmError> {
    // Build graph
    let graph = CpmGraph::build(tasks, deps)?;

    // Build blocked-day set
    let blocked: HashSet<u32> = non_working_days.iter().copied().collect();

    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    // Topological sort
    let topo_order = graph.topological_sort()?;

    let n = graph.node_to_id.len();

    // Forward pass: compute early start and early finish
    let mut early_start: Vec<u32> = vec![0; n];
    let mut early_finish: Vec<u32> = vec![0; n];

    for &node in &topo_order {
        // Skip summary tasks in normal forward pass — they get dates from children
        if graph.is_summary[node] {
            continue;
        }
        // ES = max(EF of all predecessors)
        let mut max_pred_ef = 0;
        for &pred in &graph.predecessors[node] {
            if early_finish[pred] > max_pred_ef {
                max_pred_ef = early_finish[pred];
            }
        }

        let raw_es = std::cmp::max(max_pred_ef, graph.min_early_start[node]);
        // Snap to next working day if raw ES lands on a blocked day
        early_start[node] = snap_forward(raw_es, &blocked);
        // Advance by duration working days
        early_finish[node] = advance_working(early_start[node], graph.durations[node], &blocked);
    }

    // Bottom-up summary rollup: summary ES = min(child ES), summary EF = max(child EF)
    // Process in reverse topo order so nested summaries roll up correctly
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

    // Compute project duration (max early finish)
    let project_duration = early_finish.iter().copied().max().unwrap_or(0);

    // Backward pass: compute late start and late finish
    let mut late_start: Vec<u32> = vec![0; n];
    let mut late_finish: Vec<u32> = vec![project_duration; n];

    // Traverse in reverse topological order
    for &node in topo_order.iter().rev() {
        // For nodes with successors, LF = min(LS of all successors)
        // For leaf nodes (no successors), LF is already initialized to project_duration
        if !graph.successors[node].is_empty() {
            let mut min_succ_ls = u32::MAX;

            for &succ in &graph.successors[node] {
                if late_start[succ] < min_succ_ls {
                    min_succ_ls = late_start[succ];
                }
            }

            late_finish[node] = min_succ_ls;
        }

        // Calendar-aware backward: retreat by working-day duration
        late_start[node] = retreat_working(late_finish[node], graph.durations[node], &blocked);
    }

    // Calculate total float and determine critical path
    let mut results: Vec<ScheduleResult> = Vec::with_capacity(n);
    for i in 0..n {
        let total_float = count_working_days(early_finish[i], late_finish[i], &blocked);
        let is_critical = total_float == 0;

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
