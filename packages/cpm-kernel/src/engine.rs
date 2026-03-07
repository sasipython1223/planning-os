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
        // ES = max(EF of all predecessors)
        let mut max_pred_ef = 0;
        for &pred in &graph.predecessors[node] {
            if early_finish[pred] > max_pred_ef {
                max_pred_ef = early_finish[pred];
            }
        }

        early_start[node] = max_pred_ef;
        early_finish[node] = early_start[node] + graph.durations[node];
    }

    // Return results in original input order (stable order)
    let mut results: Vec<ScheduleResult> = Vec::with_capacity(n);
    for i in 0..n {
        results.push(ScheduleResult {
            task_id: graph.node_to_id[i].clone(),
            early_start: early_start[i],
            early_finish: early_finish[i],
        });
    }

    Ok(results)
}
