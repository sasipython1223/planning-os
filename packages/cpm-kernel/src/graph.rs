use crate::models::{ConstraintType, CpmError, DepType, RawDependency, RawTask};
use std::collections::HashMap;

/// Stored per-edge metadata needed by the engine.
#[derive(Debug, Clone)]
pub struct EdgeInfo {
    pub dep_type: DepType,
    pub lag: i32,
}

pub struct CpmGraph {
    pub node_to_id: Vec<String>,
    pub durations: Vec<u32>,
    pub min_early_start: Vec<u32>,
    /// Successors of each node, with per-edge info.
    pub successors: Vec<Vec<(usize, EdgeInfo)>>,
    /// Predecessors of each node, with per-edge info.
    pub predecessors: Vec<Vec<(usize, EdgeInfo)>>,
    pub in_degree: Vec<usize>,
    pub parent: Vec<Option<usize>>,
    pub children: Vec<Vec<usize>>,
    pub is_summary: Vec<bool>,
    pub constraint_type: Vec<ConstraintType>,
    pub constraint_date: Vec<Option<i32>>,
}

impl CpmGraph {
    pub fn build(tasks: &[RawTask], deps: &[RawDependency]) -> Result<Self, CpmError> {
        if tasks.is_empty() {
            return Ok(Self {
                node_to_id: Vec::new(),
                durations: Vec::new(),
                min_early_start: Vec::new(),
                successors: Vec::new(),
                predecessors: Vec::new(),
                in_degree: Vec::new(),
                parent: Vec::new(),
                children: Vec::new(),
                is_summary: Vec::new(),
                constraint_type: Vec::new(),
                constraint_date: Vec::new(),
            });
        }

        // Load tasks and build ID-to-index mapping
        let mut id_to_index: HashMap<String, usize> = HashMap::new();
        let mut node_to_id: Vec<String> = Vec::new();
        let mut durations: Vec<u32> = Vec::new();
        let mut min_early_start: Vec<u32> = Vec::new();
        let mut constraint_type_vec: Vec<ConstraintType> = Vec::new();
        let mut constraint_date_vec: Vec<Option<i32>> = Vec::new();

        for task in tasks {
            // Reject duplicate task IDs
            if id_to_index.contains_key(&task.id) {
                return Err(CpmError::DuplicateTaskId(task.id.clone()));
            }

            let index = node_to_id.len();
            id_to_index.insert(task.id.clone(), index);
            node_to_id.push(task.id.clone());
            durations.push(task.duration);
            min_early_start.push(task.min_early_start);
            constraint_type_vec.push(task.constraint_type);
            constraint_date_vec.push(task.constraint_date);
        }

        let n = node_to_id.len();

        // Initialize adjacency structures
        let mut successors: Vec<Vec<(usize, EdgeInfo)>> = vec![Vec::new(); n];
        let mut predecessors: Vec<Vec<(usize, EdgeInfo)>> = vec![Vec::new(); n];
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

            let edge = EdgeInfo {
                dep_type: dep.dep_type,
                lag: dep.lag,
            };

            // Build graph edges — topological direction is always pred → succ
            successors[*pred_idx].push((*succ_idx, edge.clone()));
            predecessors[*succ_idx].push((*pred_idx, edge));
            in_degree[*succ_idx] += 1;
        }

        // Resolve parent ↔ children relationships
        let mut parent: Vec<Option<usize>> = vec![None; n];
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut is_summary: Vec<bool> = vec![false; n];

        for task in tasks {
            if let Some(ref pid) = task.parent_id {
                let child_idx = *id_to_index.get(&task.id).unwrap();
                let parent_idx = *id_to_index
                    .get(pid)
                    .ok_or_else(|| CpmError::TaskNotFound(pid.clone()))?;
                parent[child_idx] = Some(parent_idx);
                children[parent_idx].push(child_idx);
            }
        }
        for task in tasks {
            if task.is_summary {
                let idx = *id_to_index.get(&task.id).unwrap();
                is_summary[idx] = true;
            }
        }

        Ok(Self {
            node_to_id,
            durations,
            min_early_start,
            successors,
            predecessors,
            in_degree,
            parent,
            children,
            is_summary,
            constraint_type: constraint_type_vec,
            constraint_date: constraint_date_vec,
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

            for &(succ, _) in &self.successors[node] {
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
