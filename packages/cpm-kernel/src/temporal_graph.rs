//! Phase D1: Temporal graph data structure — parallel kernel path.
//!
//! Mirrors `graph::CpmGraph` with i64-typed fields for absolute-minute
//! scheduling. Used only by `temporal::run_schedule_temporal`.
//! Not referenced by the worker or any active production code path.

use crate::models::{ConstraintType, CpmError, DepType, TemporalRelationInput, TemporalTaskInput};
use std::collections::HashMap;

/// Per-edge metadata for the temporal graph.
/// `lag_calendar_id` is stored for future multi-calendar lag resolution.
/// W5B-B1 keeps conservative lag handling: all lag uses project calendar.
#[derive(Debug, Clone)]
pub struct TemporalEdgeInfo {
    pub dep_type: DepType,
    pub lag_minutes: i64,
    pub lag_calendar_id: String,
}

/// Temporal graph: mirrors CpmGraph with i64-typed duration/date fields.
/// `calendar_id` per node is consumed by the temporal engine in W5B-B1.
/// Missing/invalid IDs fall back to project calendar deterministically.
pub struct TemporalCpmGraph {
    pub node_to_id: Vec<String>,
    pub duration_minutes: Vec<i64>,
    pub min_early_start_minutes: Vec<i64>,
    pub calendar_id: Vec<String>,
    pub successors: Vec<Vec<(usize, TemporalEdgeInfo)>>,
    pub predecessors: Vec<Vec<(usize, TemporalEdgeInfo)>>,
    pub in_degree: Vec<usize>,
    pub parent: Vec<Option<usize>>,
    pub children: Vec<Vec<usize>>,
    pub is_summary: Vec<bool>,
    pub constraint_type: Vec<ConstraintType>,
    pub constraint_date_minutes: Vec<Option<i64>>,
}

impl TemporalCpmGraph {
    pub fn build(
        tasks: &[TemporalTaskInput],
        relations: &[TemporalRelationInput],
    ) -> Result<Self, CpmError> {
        if tasks.is_empty() {
            return Ok(Self {
                node_to_id: Vec::new(),
                duration_minutes: Vec::new(),
                min_early_start_minutes: Vec::new(),
                calendar_id: Vec::new(),
                successors: Vec::new(),
                predecessors: Vec::new(),
                in_degree: Vec::new(),
                parent: Vec::new(),
                children: Vec::new(),
                is_summary: Vec::new(),
                constraint_type: Vec::new(),
                constraint_date_minutes: Vec::new(),
            });
        }

        let mut id_to_index: HashMap<String, usize> = HashMap::new();
        let mut node_to_id: Vec<String> = Vec::new();
        let mut duration_minutes: Vec<i64> = Vec::new();
        let mut min_early_start_minutes_vec: Vec<i64> = Vec::new();
        let mut calendar_id_vec: Vec<String> = Vec::new();
        let mut constraint_type_vec: Vec<ConstraintType> = Vec::new();
        let mut constraint_date_vec: Vec<Option<i64>> = Vec::new();

        for task in tasks {
            if id_to_index.contains_key(&task.id) {
                return Err(CpmError::DuplicateTaskId(task.id.clone()));
            }

            let index = node_to_id.len();
            id_to_index.insert(task.id.clone(), index);
            node_to_id.push(task.id.clone());
            duration_minutes.push(task.duration_minutes);
            min_early_start_minutes_vec.push(task.min_early_start_minutes);
            calendar_id_vec.push(task.calendar_id.clone());
            constraint_type_vec.push(task.constraint_type);
            constraint_date_vec.push(task.constraint_date_minutes);
        }

        let n = node_to_id.len();

        let mut successors: Vec<Vec<(usize, TemporalEdgeInfo)>> = vec![Vec::new(); n];
        let mut predecessors: Vec<Vec<(usize, TemporalEdgeInfo)>> = vec![Vec::new(); n];
        let mut in_degree: Vec<usize> = vec![0; n];

        for rel in relations {
            if rel.pred_id == rel.succ_id {
                return Err(CpmError::SelfDependency(rel.pred_id.clone()));
            }

            let pred_idx = id_to_index
                .get(&rel.pred_id)
                .ok_or_else(|| CpmError::TaskNotFound(rel.pred_id.clone()))?;

            let succ_idx = id_to_index
                .get(&rel.succ_id)
                .ok_or_else(|| CpmError::TaskNotFound(rel.succ_id.clone()))?;

            let edge = TemporalEdgeInfo {
                dep_type: rel.dep_type,
                lag_minutes: rel.lag_minutes,
                lag_calendar_id: rel.lag_calendar_id.clone(),
            };

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
            duration_minutes,
            min_early_start_minutes: min_early_start_minutes_vec,
            calendar_id: calendar_id_vec,
            successors,
            predecessors,
            in_degree,
            parent,
            children,
            is_summary,
            constraint_type: constraint_type_vec,
            constraint_date_minutes: constraint_date_vec,
        })
    }

    pub fn topological_sort(&self) -> Result<Vec<usize>, CpmError> {
        let n = self.node_to_id.len();
        if n == 0 {
            return Ok(Vec::new());
        }

        let mut in_degree = self.in_degree.clone();
        let mut queue: Vec<usize> = Vec::new();

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

        if sorted.len() != n {
            return Err(CpmError::CycleDetected);
        }

        Ok(sorted)
    }
}
