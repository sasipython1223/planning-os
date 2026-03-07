use crate::models::{CpmError, RawDependency, RawTask};
use std::collections::HashMap;

pub struct CpmGraph {
    pub node_to_id: Vec<String>,
    pub durations: Vec<u32>,
    pub successors: Vec<Vec<usize>>,
    pub predecessors: Vec<Vec<usize>>,
    pub in_degree: Vec<usize>,
}

impl CpmGraph {
    pub fn build(tasks: &[RawTask], deps: &[RawDependency]) -> Result<Self, CpmError> {
        if tasks.is_empty() {
            return Ok(Self {
                node_to_id: Vec::new(),
                durations: Vec::new(),
                successors: Vec::new(),
                predecessors: Vec::new(),
                in_degree: Vec::new(),
            });
        }

        // Load tasks and build ID-to-index mapping
        let mut id_to_index: HashMap<String, usize> = HashMap::new();
        let mut node_to_id: Vec<String> = Vec::new();
        let mut durations: Vec<u32> = Vec::new();

        for task in tasks {
            // Reject duplicate task IDs
            if id_to_index.contains_key(&task.id) {
                return Err(CpmError::DuplicateTaskId(task.id.clone()));
            }

            let index = node_to_id.len();
            id_to_index.insert(task.id.clone(), index);
            node_to_id.push(task.id.clone());
            durations.push(task.duration);
        }

        let n = node_to_id.len();

        // Initialize adjacency structures
        let mut successors: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut predecessors: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut in_degree: Vec<usize> = vec![0; n];

        // Validate and add each dependency
        for dep in deps {
            // Explicitly reject self-dependencies
            if dep.pred_id == dep.succ_id {
                return Err(CpmError::SelfDependency(dep.pred_id.clone()));
            }

            // Reject missing predecessor
            let pred_idx = id_to_index
                .get(&dep.pred_id)
                .ok_or_else(|| CpmError::TaskNotFound(dep.pred_id.clone()))?;

            // Reject missing successor
            let succ_idx = id_to_index
                .get(&dep.succ_id)
                .ok_or_else(|| CpmError::TaskNotFound(dep.succ_id.clone()))?;

            // Build graph edges
            successors[*pred_idx].push(*succ_idx);
            predecessors[*succ_idx].push(*pred_idx);
            in_degree[*succ_idx] += 1;
        }

        Ok(Self {
            node_to_id,
            durations,
            successors,
            predecessors,
            in_degree,
        })
    }

    pub fn topological_sort(&self) -> Result<Vec<usize>, CpmError> {
        let n = self.node_to_id.len();
        if n == 0 {
            return Ok(Vec::new());
        }

        // Kahn's algorithm
        let mut in_degree = self.in_degree.clone();
        let mut queue: Vec<usize> = Vec::new();

        // Initialize queue with nodes that have no incoming edges
        for (i, &degree) in in_degree.iter().enumerate().take(n) {
            if degree == 0 {
                queue.push(i);
            }
        }

        let mut sorted: Vec<usize> = Vec::new();
        let mut queue_idx = 0;

        while queue_idx < queue.len() {
            let node = queue[queue_idx];
            queue_idx += 1;
            sorted.push(node);

            for &succ in &self.successors[node] {
                in_degree[succ] -= 1;
                if in_degree[succ] == 0 {
                    queue.push(succ);
                }
            }
        }

        // If not all nodes were sorted, there's a cycle
        if sorted.len() != n {
            return Err(CpmError::CycleDetected);
        }

        Ok(sorted)
    }
}
