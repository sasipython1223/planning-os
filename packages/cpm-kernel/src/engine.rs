use crate::graph::CpmGraph;
use crate::models::{CpmError, RawDependency, RawTask, ScheduleResult};

pub fn calculate_schedule(
    tasks: &[RawTask],
    deps: &[RawDependency],
) -> Result<Vec<ScheduleResult>, CpmError> {
    // Build graph
    let graph = CpmGraph::build(tasks, deps)?;

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

        early_start[node] = std::cmp::max(max_pred_ef, graph.min_early_start[node]);
        early_finish[node] = early_start[node] + graph.durations[node];
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
        
        late_start[node] = late_finish[node].saturating_sub(graph.durations[node]);
    }

    // Calculate total float and determine critical path
    let mut results: Vec<ScheduleResult> = Vec::with_capacity(n);
    for i in 0..n {
        let total_float = late_finish[i].saturating_sub(early_finish[i]);
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
