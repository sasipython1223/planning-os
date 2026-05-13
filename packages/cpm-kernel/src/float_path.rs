//! AI-FPA.3A — Total-float path analysis (MVP-v1)
//!
//! Pure deterministic function. Consumes already-computed CPM `ScheduleResult`
//! values and a dependency list. Does NOT reschedule anything.
//!
//! # Algorithm overview
//!
//! 1. Build a lookup map: `task_id → ScheduleResult`.
//! 2. Validate the target: return `TargetNotFound` error if missing.
//! 3. Build a predecessor-adjacency map from `dependencies` (all deps, not
//!    only driving ones) so that every simple predecessor chain reaching the
//!    target can be enumerated.
//! 4. Run a depth-first enumeration backward from the target, collecting all
//!    simple (cycle-free) predecessor chains.
//! 5. For each chain, compute:
//!    - `path_total_float_minutes = min(TF)` over all activities in the chain
//!    - driving flag per relationship (active-constraint equality test)
//!    - driving flag per activity (all outgoing path-relationships driving)
//! 6. Sort chains by (path_float ASC, chain_length DESC, first_task_id ASC)
//!    for full determinism.
//! 7. Clamp to `max_paths`, emit warnings, assemble the response.

use std::collections::{HashMap, HashSet};

use crate::models::{
    DepType, FloatPath, FloatPathActivity, FloatPathAnalysisError, FloatPathAnalysisInput,
    FloatPathAnalysisResponse, FloatPathRelationship, FloatPathWarning, FloatPathWarningCode,
    RawDependency, ScheduleResult,
};

/// Hard guardrail: maximum number of candidate chains retained during search.
const MAX_CANDIDATE_PATHS: usize = 5_000;
/// Hard guardrail: maximum DFS frame expansions before early stop.
const MAX_EXPANSIONS: usize = 200_000;
/// Hard guardrail: maximum predecessor-depth explored for a single path.
const MAX_DEPTH: usize = 256;

// ─── Driving-relationship test ───────────────────────────────────────────────

/// Return true when the `pred → succ` dependency with the given lag is the
/// active schedule driver (i.e. the predecessor anchor + lag equals the
/// successor's constrained date in the slot kernel's integer day-offset unit).
///
/// All values are in the same unit as the slot kernel (integer day-offsets).
fn is_driving_rel(
    dep_type: DepType,
    pred: &ScheduleResult,
    succ: &ScheduleResult,
    lag: i32,
) -> bool {
    match dep_type {
        DepType::FS => {
            (pred.early_finish_minutes as i64 + lag as i64)
                == succ.early_start_minutes as i64
        }
        DepType::SS => {
            (pred.early_start_minutes as i64 + lag as i64)
                == succ.early_start_minutes as i64
        }
        DepType::FF => {
            (pred.early_finish_minutes as i64 + lag as i64)
                == succ.early_finish_minutes as i64
        }
        DepType::SF => {
            (pred.early_start_minutes as i64 + lag as i64)
                == succ.early_finish_minutes as i64
        }
    }
}

// ─── Internal chain representation ──────────────────────────────────────────

/// A candidate path stored as an ordered list of `(task_id, dep_to_succ)`
/// pairs.  The last element is `(target_id, None)`.
///
/// Chain is stored source-to-target (natural reading order).
struct CandidatePath {
    /// task IDs from source to target (inclusive).
    task_ids: Vec<String>,
    /// The predecessor dependency that connects `task_ids[i]` to
    /// `task_ids[i+1]`.  Length = task_ids.len() - 1.
    edges: Vec<RawDependency>,
}

struct SearchStats {
    hit_candidate_cap: bool,
    hit_expansion_cap: bool,
    hit_depth_cap: bool,
}

struct EnumerationOutput {
    candidates: Vec<CandidatePath>,
    stats: SearchStats,
}

impl CandidatePath {
    fn path_total_float(&self, result_map: &HashMap<&str, &ScheduleResult>) -> i32 {
        self.task_ids
            .iter()
            .filter_map(|id| result_map.get(id.as_str()).map(|r| r.total_float_minutes))
            .min()
            .unwrap_or(0)
    }
}

// ─── Backward DFS chain enumerator ──────────────────────────────────────────

/// Enumerate all simple predecessor chains ending at `target_id`.
///
/// `pred_map` maps `succ_id → Vec<RawDependency>` (edges pointing INTO each
/// task).  We walk backward, visiting predecessors of each node.
///
/// Chains are simple: a task may not appear twice in the same chain.
fn enumerate_chains(
    target_id: &str,
    pred_map: &HashMap<String, Vec<RawDependency>>,
    result_map: &HashMap<&str, &ScheduleResult>,
) -> EnumerationOutput {
    let mut results: Vec<CandidatePath> = Vec::new();
    let mut expansions: usize = 0;
    let mut stats = SearchStats {
        hit_candidate_cap: false,
        hit_expansion_cap: false,
        hit_depth_cap: false,
    };

    // DFS stack entry: (current_node, reversed_task_ids, reversed_edges, visited_set)
    // We build the chain in reverse and flip at the end.
    struct Frame {
        current: String,
        rev_tasks: Vec<String>,
        rev_edges: Vec<RawDependency>,
        visited: HashSet<String>,
    }

    let mut stack: Vec<Frame> = Vec::new();
    let mut init_visited = HashSet::new();
    init_visited.insert(target_id.to_string());
    stack.push(Frame {
        current: target_id.to_string(),
        rev_tasks: vec![target_id.to_string()],
        rev_edges: Vec::new(),
        visited: init_visited,
    });

    let mut push_candidate = |frame: &Frame| {
        if results.len() >= MAX_CANDIDATE_PATHS {
            stats.hit_candidate_cap = true;
            return false;
        }
        if frame.rev_tasks.is_empty() {
            return true;
        }
        let mut task_ids = frame.rev_tasks.clone();
        task_ids.reverse();
        let mut edges = frame.rev_edges.clone();
        edges.reverse();
        results.push(CandidatePath { task_ids, edges });
        true
    };

    while let Some(frame) = stack.pop() {
        if expansions >= MAX_EXPANSIONS {
            stats.hit_expansion_cap = true;
            break;
        }
        expansions += 1;

        if frame.rev_tasks.len() >= MAX_DEPTH {
            // Keep the deepest deterministic prefix found so far.
            stats.hit_depth_cap = true;
            if !push_candidate(&frame) {
                break;
            }
            continue;
        }

        let preds = pred_map.get(&frame.current);

        let mut eligible_preds: Vec<&RawDependency> = preds
            .map(|ps| {
                ps.iter()
                    .filter(|d| {
                        result_map.contains_key(d.pred_id.as_str())
                            && !frame.visited.contains(&d.pred_id)
                    })
                    .collect()
            })
            .unwrap_or_default();

        if eligible_preds.is_empty() {
            // This node is a source — emit the chain (source … target).
            if !push_candidate(&frame) {
                break;
            }
            continue;
        }

        // Deterministic exploration order biased toward lower predecessor float.
        eligible_preds.sort_by_key(|dep| {
            let pred_tf = result_map
                .get(dep.pred_id.as_str())
                .map(|r| r.total_float_minutes)
                .unwrap_or(i32::MAX);
            let dep_rank = match dep.dep_type {
                DepType::FS => 0,
                DepType::SS => 1,
                DepType::FF => 2,
                DepType::SF => 3,
            };
            (
                pred_tf,
                dep.pred_id.as_str(),
                dep.succ_id.as_str(),
                dep_rank,
                dep.lag_work_minutes,
            )
        });

        // Stack is LIFO: push reverse so smallest key is processed first.
        for dep in eligible_preds.into_iter().rev() {
            let mut new_visited = frame.visited.clone();
            new_visited.insert(dep.pred_id.clone());

            let mut new_rev_tasks = frame.rev_tasks.clone();
            new_rev_tasks.push(dep.pred_id.clone());

            let mut new_rev_edges = frame.rev_edges.clone();
            new_rev_edges.push(dep.clone());

            stack.push(Frame {
                current: dep.pred_id.clone(),
                rev_tasks: new_rev_tasks,
                rev_edges: new_rev_edges,
                visited: new_visited,
            });
        }

    }

    EnumerationOutput {
        candidates: results,
        stats,
    }
}

// ─── Tie-break sort key ──────────────────────────────────────────────────────

/// Deterministic sort key for a candidate path:
/// 1. path_float ASC
/// 2. chain_length DESC (longer = more detail = higher priority at equal float)
/// 3. first_task_id ASC (lexicographic tiebreaker)
fn sort_key(path: &CandidatePath, result_map: &HashMap<&str, &ScheduleResult>) -> impl Ord {
    let float = path.path_total_float(result_map);
    let len = path.task_ids.len() as i64;
    let first_id = path.task_ids.first().cloned().unwrap_or_default();
    (float, -len, first_id)
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Compute MVP-v1 total-float path analysis from already-computed CPM results.
///
/// # Errors
/// - `FloatPathAnalysisError::TargetNotFound` if `input.target_task_id` is not
///   present in `input.schedule_results`.
pub fn analyze_float_paths(
    input: FloatPathAnalysisInput,
) -> Result<FloatPathAnalysisResponse, FloatPathAnalysisError> {
    // ── 1. Build result lookup ────────────────────────────────────
    let result_map: HashMap<&str, &ScheduleResult> = input
        .schedule_results
        .iter()
        .map(|r| (r.task_id.as_str(), r))
        .collect();

    // ── 2. Validate target ────────────────────────────────────────
    if !result_map.contains_key(input.target_task_id.as_str()) {
        return Err(FloatPathAnalysisError::TargetNotFound(
            input.target_task_id.clone(),
        ));
    }

    let mut warnings: Vec<FloatPathWarning> = Vec::new();

    // ── 3. Build predecessor-adjacency map ────────────────────────
    // pred_map: succ_id → Vec<RawDependency pointing into succ>
    let mut pred_map: HashMap<String, Vec<RawDependency>> = HashMap::new();
    for dep in &input.dependencies {
        pred_map
            .entry(dep.succ_id.clone())
            .or_default()
            .push(dep.clone());
    }

    // ── 4. Enumerate all simple predecessor chains ────────────────
    let enumeration = enumerate_chains(&input.target_task_id, &pred_map, &result_map);
    let mut candidates = enumeration.candidates;

    if enumeration.stats.hit_candidate_cap
        || enumeration.stats.hit_expansion_cap
        || enumeration.stats.hit_depth_cap
    {
        let mut reasons: Vec<&str> = Vec::new();
        if enumeration.stats.hit_candidate_cap {
            reasons.push("candidate cap reached");
        }
        if enumeration.stats.hit_expansion_cap {
            reasons.push("expansion cap reached");
        }
        if enumeration.stats.hit_depth_cap {
            reasons.push("depth cap reached");
        }

        warnings.push(FloatPathWarning {
            code: FloatPathWarningCode::SearchCapped,
            message: format!(
                "Path search capped ({}). Returned best deterministic subset found so far.",
                reasons.join(", ")
            ),
        });
    }

    // ── 5. Sort deterministically ─────────────────────────────────
    candidates.sort_by_key(|p| sort_key(p, &result_map));

    // ── 6. Clamp to max_paths ─────────────────────────────────────
    let total_candidate_count = candidates.len();
    if total_candidate_count == 0 {
        warnings.push(FloatPathWarning {
            code: FloatPathWarningCode::NoPathsToTarget,
            message: "No converging predecessor paths could be identified for target.".to_string(),
        });
        return Ok(FloatPathAnalysisResponse {
            paths: Vec::new(),
            warnings,
        });
    }

    let clamped = if (input.max_paths as usize) < candidates.len() {
        warnings.push(FloatPathWarning {
            code: FloatPathWarningCode::MaxPathsClamped,
            message: format!(
                "Result set clamped to {} paths; {} candidate paths were found.",
                input.max_paths, total_candidate_count
            ),
        });
        candidates.truncate(input.max_paths as usize);
        &candidates[..]
    } else {
        &candidates[..]
    };

    // ── 7. Assemble FloatPath output ──────────────────────────────
    let mut paths: Vec<FloatPath> = Vec::with_capacity(clamped.len());

    for (rank_0, candidate) in clamped.iter().enumerate() {
        let rank = rank_0 + 1; // 1-based
        let path_float = candidate.path_total_float(&result_map);
        let is_near_critical = path_float <= input.near_critical_threshold_minutes;

        // Build ordered activities (source → target, 1-based sequence).
        let mut ordered_activities: Vec<FloatPathActivity> = Vec::new();
        for (i, task_id) in candidate.task_ids.iter().enumerate() {
            let sr = result_map[task_id.as_str()];

            // An activity is driving if the outgoing relationship from it
            // (within this path) is driving, OR it is the terminal (target).
            let is_driving = if i + 1 < candidate.task_ids.len() {
                // There is an outgoing edge from this activity in the chain.
                let dep = &candidate.edges[i];
                let succ_id = &candidate.task_ids[i + 1];
                let succ_sr = result_map[succ_id.as_str()];
                is_driving_rel(dep.dep_type, sr, succ_sr, dep.lag_work_minutes)
            } else {
                // Terminal (target) activity — always driving.
                true
            };

            ordered_activities.push(FloatPathActivity {
                sequence: (i + 1) as u32,
                task_id: task_id.clone(),
                is_driving,
                total_float_minutes: sr.total_float_minutes,
            });
        }

        // Build ordered relationships (source → target, 1-based sequence).
        let mut ordered_relationships: Vec<FloatPathRelationship> = Vec::new();
        for (i, dep) in candidate.edges.iter().enumerate() {
            let pred_sr = result_map[dep.pred_id.as_str()];
            let succ_sr = result_map[dep.succ_id.as_str()];
            let driving = is_driving_rel(dep.dep_type, pred_sr, succ_sr, dep.lag_work_minutes);

            ordered_relationships.push(FloatPathRelationship {
                sequence: (i + 1) as u32,
                pred_task_id: dep.pred_id.clone(),
                succ_task_id: dep.succ_id.clone(),
                dep_type: dep.dep_type,
                lag_minutes: dep.lag_work_minutes,
                is_driving: driving,
            });
        }

        paths.push(FloatPath {
            path_id: format!("P{}", rank),
            float_path_number: rank as u32,
            float_path_order: rank as u32,
            is_primary_driving_path: rank == 1,
            is_near_critical,
            path_total_float_minutes: path_float,
            ordered_activities,
            ordered_relationships,
        });
    }

    Ok(FloatPathAnalysisResponse { paths, warnings })
}
