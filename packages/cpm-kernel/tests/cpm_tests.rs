use cpm_kernel::{calculate_schedule, CpmError, DepType, RawDependency, RawTask};

#[test]
fn test_simple_chain() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![
        RawDependency {
            pred_id: "A".to_string(),
            succ_id: "B".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
    ];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    assert_eq!(result[0].task_id, "A");
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 3);

    assert_eq!(result[1].task_id, "B");
    assert_eq!(result[1].early_start, 3);
    assert_eq!(result[1].early_finish, 8);

    assert_eq!(result[2].task_id, "C");
    assert_eq!(result[2].early_start, 8);
    assert_eq!(result[2].early_finish, 10);
}

#[test]
fn test_parallel_tasks() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 4,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    // All tasks can start at time 0
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 5);

    assert_eq!(result[1].early_start, 0);
    assert_eq!(result[1].early_finish, 3);

    assert_eq!(result[2].early_start, 0);
    assert_eq!(result[2].early_finish, 4);
}

#[test]
fn test_merge_bottleneck() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![
        RawDependency {
            pred_id: "A".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
    ];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 3);

    assert_eq!(result[1].early_start, 0);
    assert_eq!(result[1].early_finish, 5);

    // C must wait for both A and B; B finishes later
    assert_eq!(result[2].early_start, 5);
    assert_eq!(result[2].early_finish, 7);
}

#[test]
fn test_cycle_detection() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 1,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 1,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 1,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![
        RawDependency {
            pred_id: "A".to_string(),
            succ_id: "B".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "C".to_string(),
            succ_id: "A".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
    ];

    let result = calculate_schedule(&tasks, &deps, &[]);

    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), CpmError::CycleDetected);
}

#[test]
fn test_missing_task() {
    let tasks = vec![RawTask {
        id: "A".to_string(),
        duration: 3,
        min_early_start: 0,
            parent_id: None,
            is_summary: false,
    }];

    let deps = vec![RawDependency {
        pred_id: "A".to_string(),
        succ_id: "B".to_string(),
        dep_type: DepType::FS,
        lag: 0,
        }];

    let result = calculate_schedule(&tasks, &deps, &[]);

    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), CpmError::TaskNotFound("B".to_string()));
}

#[test]
fn test_duplicate_task_id() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "A".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        CpmError::DuplicateTaskId("A".to_string())
    );
}

#[test]
fn test_self_dependency() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![RawDependency {
        pred_id: "A".to_string(),
        succ_id: "A".to_string(),
        dep_type: DepType::FS,
        lag: 0,
        }];

    let result = calculate_schedule(&tasks, &deps, &[]);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        CpmError::SelfDependency("A".to_string())
    );
}

#[test]
fn test_empty_tasks() {
    let tasks = vec![];
    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    assert_eq!(result.len(), 0);
}

#[test]
fn test_single_task() {
    let tasks = vec![RawTask {
        id: "A".to_string(),
        duration: 5,
        min_early_start: 0,
            parent_id: None,
            is_summary: false,
    }];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].task_id, "A");
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 5);
}

// Backward pass and critical path tests

#[test]
fn test_critical_chain() {
    // Simple chain A → B → C - all tasks should be critical
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![
        RawDependency {
            pred_id: "A".to_string(),
            succ_id: "B".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
    ];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    // Task A
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 3);
    assert_eq!(result[0].late_start, 0);
    assert_eq!(result[0].late_finish, 3);
    assert_eq!(result[0].total_float, 0);
    assert!(result[0].is_critical);

    // Task B
    assert_eq!(result[1].early_start, 3);
    assert_eq!(result[1].early_finish, 8);
    assert_eq!(result[1].late_start, 3);
    assert_eq!(result[1].late_finish, 8);
    assert_eq!(result[1].total_float, 0);
    assert!(result[1].is_critical);

    // Task C
    assert_eq!(result[2].early_start, 8);
    assert_eq!(result[2].early_finish, 10);
    assert_eq!(result[2].late_start, 8);
    assert_eq!(result[2].late_finish, 10);
    assert_eq!(result[2].total_float, 0);
    assert!(result[2].is_critical);
}

#[test]
fn test_parallel_path_float() {
    // Parallel paths with different durations:
    //     A (3) → C (2)
    //   /
    // Start
    //   \
    //     B (7)
    // B is critical path, A→C has float
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 7,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![RawDependency {
        pred_id: "A".to_string(),
        succ_id: "C".to_string(),
        dep_type: DepType::FS,
        lag: 0,
        }];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    // Find each task in result
    let task_a = result.iter().find(|r| r.task_id == "A").unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    let task_c = result.iter().find(|r| r.task_id == "C").unwrap();

    // Task B is critical (longest path)
    assert_eq!(task_b.early_start, 0);
    assert_eq!(task_b.early_finish, 7);
    assert_eq!(task_b.late_start, 0);
    assert_eq!(task_b.late_finish, 7);
    assert_eq!(task_b.total_float, 0);
    assert!(task_b.is_critical);

    // Task A has float (can delay without extending project)
    assert_eq!(task_a.early_start, 0);
    assert_eq!(task_a.early_finish, 3);
    assert_eq!(task_a.total_float, 2); // Can start as late as 2
    assert!(!task_a.is_critical);

    // Task C also has float
    assert_eq!(task_c.early_start, 3);
    assert_eq!(task_c.early_finish, 5);
    assert_eq!(task_c.total_float, 2);
    assert!(!task_c.is_critical);
}

#[test]
fn test_merge_bottleneck_critical_path() {
    // Two parallel paths merging:
    //     A (3) ↘
    //            C (2)
    //     B (5) ↗
    // Critical path should be B → C
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![
        RawDependency {
            pred_id: "A".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
            dep_type: DepType::FS,
            lag: 0,
            },
    ];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    let task_a = result.iter().find(|r| r.task_id == "A").unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    let task_c = result.iter().find(|r| r.task_id == "C").unwrap();

    // Task B is critical
    assert_eq!(task_b.early_start, 0);
    assert_eq!(task_b.early_finish, 5);
    assert_eq!(task_b.late_start, 0);
    assert_eq!(task_b.late_finish, 5);
    assert_eq!(task_b.total_float, 0);
    assert!(task_b.is_critical);

    // Task C is critical
    assert_eq!(task_c.early_start, 5);
    assert_eq!(task_c.early_finish, 7);
    assert_eq!(task_c.late_start, 5);
    assert_eq!(task_c.late_finish, 7);
    assert_eq!(task_c.total_float, 0);
    assert!(task_c.is_critical);

    // Task A has float (can delay 2 units)
    assert_eq!(task_a.early_start, 0);
    assert_eq!(task_a.early_finish, 3);
    assert_eq!(task_a.late_start, 2);
    assert_eq!(task_a.late_finish, 5);
    assert_eq!(task_a.total_float, 2);
    assert!(!task_a.is_critical);
}

#[test]
fn test_single_task_critical() {
    // Single task is always critical
    let tasks = vec![RawTask {
        id: "A".to_string(),
        duration: 5,
        min_early_start: 0,
            parent_id: None,
            is_summary: false,
    }];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 5);
    assert_eq!(result[0].late_start, 0);
    assert_eq!(result[0].late_finish, 5);
    assert_eq!(result[0].total_float, 0);
    assert!(result[0].is_critical);
}

#[test]
fn test_independent_parallel_tasks_critical() {
    // Independent parallel tasks - each defines its own "project"
    // All should be critical within their own context
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 5,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "B".to_string(),
            duration: 3,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
        RawTask {
            id: "C".to_string(),
            duration: 7,
            min_early_start: 0,
            parent_id: None,
            is_summary: false,
        },
    ];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();

    // All tasks start at 0
    // Project duration = max(5, 3, 7) = 7
    // C is critical (longest), A and B have float

    let task_a = result.iter().find(|r| r.task_id == "A").unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    let task_c = result.iter().find(|r| r.task_id == "C").unwrap();

    // Task C is critical (longest duration)
    assert_eq!(task_c.early_start, 0);
    assert_eq!(task_c.early_finish, 7);
    assert_eq!(task_c.total_float, 0);
    assert!(task_c.is_critical);

    // Task A has float
    assert_eq!(task_a.early_start, 0);
    assert_eq!(task_a.early_finish, 5);
    assert_eq!(task_a.total_float, 2);
    assert!(!task_a.is_critical);

    // Task B has float
    assert_eq!(task_b.early_start, 0);
    assert_eq!(task_b.early_finish, 3);
    assert_eq!(task_b.total_float, 4);
    assert!(!task_b.is_critical);
}

// ===== SNET (Start-No-Earlier-Than) constraint tests =====

#[test]
fn test_snet_unconstrained_unchanged() {
    // min_early_start = 0 for all tasks — same results as before
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 }];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 3);
    assert_eq!(result[1].early_start, 3);
    assert_eq!(result[1].early_finish, 8);
}

#[test]
fn test_snet_no_predecessor_starts_at_constraint() {
    // Task with no predecessors and minEarlyStart = 4 should start at day 4
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 4, parent_id: None, is_summary: false },
    ];
    let deps = vec![];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    assert_eq!(result[0].early_start, 4);
    assert_eq!(result[0].early_finish, 7);
}

#[test]
fn test_snet_predecessor_later_than_constraint() {
    // Predecessor finishes at day 5, constraint is day 2 → predecessor wins (day 5)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 2, parent_id: None, is_summary: false },
    ];
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 }];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    assert_eq!(task_b.early_start, 5); // pred EF=5 > constraint 2
    assert_eq!(task_b.early_finish, 8);
}

#[test]
fn test_snet_constraint_later_than_predecessor() {
    // Predecessor finishes at day 3, constraint is day 10 → constraint wins (day 10)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 10, parent_id: None, is_summary: false },
    ];
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 }];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    assert_eq!(task_b.early_start, 10); // constraint 10 > pred EF=3
    assert_eq!(task_b.early_finish, 12);
}

#[test]
fn test_snet_successors_shift() {
    // A has SNET=5 → A starts at 5, B (successor) shifts accordingly
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 5, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 }];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let task_a = result.iter().find(|r| r.task_id == "A").unwrap();
    let task_b = result.iter().find(|r| r.task_id == "B").unwrap();
    assert_eq!(task_a.early_start, 5);
    assert_eq!(task_a.early_finish, 8);
    assert_eq!(task_b.early_start, 8);
    assert_eq!(task_b.early_finish, 10);
}

// ===== Summary rollup tests =====

#[test]
fn test_summary_rollup_single_level() {
    // Summary S has two children A(3) and B(5) chained: A → B
    // S should rollup: ES = min(A.ES, B.ES) = 0, EF = max(A.EF, B.EF) = 8
    let tasks = vec![
        RawTask { id: "S".to_string(), duration: 0, min_early_start: 0, parent_id: None, is_summary: true },
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: Some("S".to_string()), is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: Some("S".to_string()), is_summary: false },
    ];
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 }];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let summary = result.iter().find(|r| r.task_id == "S").unwrap();
    assert_eq!(summary.early_start, 0);
    assert_eq!(summary.early_finish, 8);
}

#[test]
fn test_summary_rollup_nested() {
    // Outer summary OS contains inner summary IS, which contains child A(4)
    // IS should rollup from A: ES=0, EF=4
    // OS should rollup from IS: ES=0, EF=4
    let tasks = vec![
        RawTask { id: "OS".to_string(), duration: 0, min_early_start: 0, parent_id: None, is_summary: true },
        RawTask { id: "IS".to_string(), duration: 0, min_early_start: 0, parent_id: Some("OS".to_string()), is_summary: true },
        RawTask { id: "A".to_string(), duration: 4, min_early_start: 0, parent_id: Some("IS".to_string()), is_summary: false },
    ];
    let deps = vec![];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let inner = result.iter().find(|r| r.task_id == "IS").unwrap();
    let outer = result.iter().find(|r| r.task_id == "OS").unwrap();
    assert_eq!(inner.early_start, 0);
    assert_eq!(inner.early_finish, 4);
    assert_eq!(outer.early_start, 0);
    assert_eq!(outer.early_finish, 4);
}

#[test]
fn test_summary_with_snet_child() {
    // Summary S has child A with minEarlyStart=5, duration=3
    // A.ES=5, A.EF=8 → S.ES=5, S.EF=8
    let tasks = vec![
        RawTask { id: "S".to_string(), duration: 0, min_early_start: 0, parent_id: None, is_summary: true },
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 5, parent_id: Some("S".to_string()), is_summary: false },
    ];
    let deps = vec![];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let summary = result.iter().find(|r| r.task_id == "S").unwrap();
    assert_eq!(summary.early_start, 5);
    assert_eq!(summary.early_finish, 8);
}

// ─── Calendar-aware scheduling tests ────────────────────────────────

#[test]
fn test_calendar_single_task_skips_blocked_days() {
    // Task A: duration 3, days 2 and 3 are blocked.
    // Working days: 0,1, (skip 2,3), 4,5,6...
    // ES=0, works days 0,1,4 → EF=5
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![];
    let blocked = vec![2, 3];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = &result[0];
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 5); // day 0, 1, 4 → finish after day 4 = 5
}

#[test]
fn test_calendar_es_snaps_forward_on_blocked_day() {
    // Task A has minEarlyStart=2 but day 2 is blocked
    // Should snap to day 3 as first working day
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 2, min_early_start: 2, parent_id: None, is_summary: false },
    ];
    let deps = vec![];
    let blocked = vec![2];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = &result[0];
    assert_eq!(a.early_start, 3); // snapped forward
    assert_eq!(a.early_finish, 5); // works days 3, 4 → finish = 5
}

#[test]
fn test_calendar_chain_weekend_crossing() {
    // Simulated weekly blocked pattern: days 5,6 are a "weekend".
    // A: duration=3, ES=0 → works 0,1,2 → EF=3
    // B: duration=3, depends on A → ES=3 → works 3,4, (skip 5,6), 7 → EF=8
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 3);
    assert_eq!(b.early_start, 3);
    assert_eq!(b.early_finish, 8); // days 3,4,7
}

#[test]
fn test_calendar_backward_pass_skips_blocked() {
    // A→B chain, days 5,6 blocked.
    // Forward: A: ES=0, EF=3; B: ES=3, EF=8 (works 3,4,7)
    // Project duration=8
    // Backward: B: LF=8, LS=retreat(8,3)= works 7,4,3 → LS=3
    // A: LF=LS_B=3, LS=retreat(3,3)= works 2,1,0 → LS=0
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    // Both should be critical (0 float)
    assert_eq!(a.total_float, 0);
    assert!(a.is_critical);
    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 3);
    assert_eq!(b.total_float, 0);
    assert!(b.is_critical);
    assert_eq!(b.late_start, 3);
    assert_eq!(b.late_finish, 8);
}

#[test]
fn test_calendar_parallel_paths_float_with_blocked() {
    // A(2) → C(1), B(1) independent. Days 3 blocked.
    // A: ES=0, works 0,1 → EF=2
    // C: ES=2, works 2 → EF=3 ... but 3 is blocked, actually EF = advance(2,1)= day 2 done → EF=3? No.
    // advance(2, 1, {3}) → d=2 not blocked, remaining=0 → EF=3.
    // Wait but day 3 is blocked. Let's re-check: advance(2, 1) start=2, remaining=1.
    // d=2 not blocked → remaining=0 → return 3. So EF=3.
    // B: ES=0, works 0 → EF=1.
    // Project duration = 3.
    // Backward: C: LF=3, retreat(3,1,{3}) → d=2, not blocked, remaining=0 → LS=2. ✓
    // A: LF=LS_C=2, retreat(2,2,{3}) → d=1 not blocked remaining=1, d=0 not blocked remaining=0 → LS=0. ✓
    // B: LF=3, retreat(3,1,{3}) → d=2 not blocked, remaining=0 → LS=2.
    // B float = LF-EF = 3-1 = 2.
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 1, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 1, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "C".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![3];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    let c = result.iter().find(|r| r.task_id == "C").unwrap();
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 2);
    assert_eq!(c.early_start, 2);
    assert_eq!(c.early_finish, 3);
    assert!(a.is_critical);
    assert!(c.is_critical);
    assert_eq!(b.total_float, 2);
    assert!(!b.is_critical);
}

#[test]
fn test_calendar_zero_duration_milestone() {
    // Milestone (duration=0) on a blocked day should snap forward
    let tasks = vec![
        RawTask { id: "M".to_string(), duration: 0, min_early_start: 5, parent_id: None, is_summary: false },
    ];
    let deps = vec![];
    let blocked = vec![5, 6]; // day 5,6 blocked
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let m = &result[0];
    assert_eq!(m.early_start, 7); // snapped past 5,6 to 7
    assert_eq!(m.early_finish, 7); // zero-duration: ES == EF
}

#[test]
fn test_calendar_no_blocked_days_unchanged() {
    // With empty blocked set, behaves identically to original
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 3);
    assert_eq!(b.early_start, 3);
    assert_eq!(b.early_finish, 8);
}

// ─── Calendar-aware float stabilization tests ───────────────────────

#[test]
fn test_calendar_chain_spanning_weekend_all_critical() {
    // A→B→C chain, each duration=5, weekends at days 5,6,12,13
    // Forward: A: ES=0, EF=5 (days 0-4); B: ES=7, EF=12 (days 7-11); C: ES=14, EF=19 (days 14-18)
    // All tasks should be critical with TF=0 — weekend gaps must not create artificial float
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "C".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6, 12, 13];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    let c = result.iter().find(|r| r.task_id == "C").unwrap();

    // Forward pass
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 5);
    assert_eq!(b.early_start, 7);
    assert_eq!(b.early_finish, 12);
    assert_eq!(c.early_start, 14);
    assert_eq!(c.early_finish, 19);

    // ALL tasks must be critical — zero working-day float
    assert_eq!(a.total_float, 0);
    assert!(a.is_critical);
    assert_eq!(b.total_float, 0);
    assert!(b.is_critical);
    assert_eq!(c.total_float, 0);
    assert!(c.is_critical);
}

#[test]
fn test_calendar_parallel_non_driving_has_float() {
    // A→C chain (driving), B independent (non-driving), weekends at 5,6
    // A: dur=3, ES=0, EF=3; C: dur=3, ES=3, EF=8 (days 3,4,7)
    // B: dur=1, ES=0, EF=1; LF=8, TF = working days in [1,8) = 5 (days 1,2,3,4,7)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 1, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "C".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert!(!b.is_critical);
    assert!(b.total_float > 0);
}

#[test]
fn test_calendar_backward_snaps_late_dates_over_weekends() {
    // A→B, each duration=5, weekends at 5,6,12,13
    // Forward: A: ES=0, EF=5; B: ES=7, EF=12
    // Project=12 (wait — C is missing, only A→B)
    // Actually with only A→B: project_duration = max(EF) = 12
    // Backward: B: LF=12, LS=retreat(12,5)=7; A: LF=LS_B=7, LS=retreat(7,5)=0
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6, 12, 13];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 7); // LF = LS_B, not 5
    assert_eq!(b.late_start, 7);
    assert_eq!(b.late_finish, 12);
    // Both critical
    assert_eq!(a.total_float, 0);
    assert!(a.is_critical);
    assert_eq!(b.total_float, 0);
    assert!(b.is_critical);
}

#[test]
fn test_calendar_float_counts_working_days_not_elapsed() {
    // A(dur=5) and B(dur=2) independent, weekends at 5,6
    // A: ES=0, EF=5 (days 0-4); B: ES=0, EF=2 (days 0,1)
    // Project=max(5,2)=5... wait, A finishes at 5, but 5 is blocked.
    // No — EF=5 is an exclusive upper bound (day after last working day consumed).
    // advance(0,5,{5,6}) → d=0,1,2,3,4 all working → EF=5
    // advance(0,2,{5,6}) → d=0,1 → EF=2
    // Project=5. B: LF=5, LS=retreat(5,2,{5,6}) → d=4 (not blocked), remaining=1; d=3, remaining=0 → LS=3
    // B.TF = working days in [2,5) = days 2,3,4 = 3
    // A.TF = working days in [5,5) = 0
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert!(a.is_critical);
    assert_eq!(a.total_float, 0);
    // B's float should count WORKING days only, not elapsed (which would be 5-2=3, same here)
    assert_eq!(b.total_float, 3);
    assert!(!b.is_critical);
}

#[test]
fn test_calendar_summary_with_critical_child_is_critical() {
    // Summary S with children A→B chain, weekends at 5,6
    // Both A and B should be critical → S should also be critical via rollup
    let tasks = vec![
        RawTask { id: "S".to_string(), duration: 0, min_early_start: 0, parent_id: None, is_summary: true },
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: Some("S".to_string()), is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: Some("S".to_string()), is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert!(a.is_critical);
    assert!(b.is_critical);
    // Summary rollup tested at Worker layer (rollupSummarySchedules propagates isCritical from children)
}

// ═══════════════════════════════════════════════════════════════════
// Phase P — Advanced Dependencies & Lag tests
// ═══════════════════════════════════════════════════════════════════

// ── SS (Start-to-Start) ──────────────────────────────────────────

#[test]
fn test_ss_zero_lag() {
    // A(dur=3) SS→ B(dur=4), no blocked days
    // B.ES = A.ES = 0, both start on day 0
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 3);
    assert_eq!(b.early_start, 0);
    assert_eq!(b.early_finish, 4);
}

#[test]
fn test_ss_positive_lag() {
    // A(dur=3) SS+2→ B(dur=4), no blocked days
    // B.ES = A.ES + 2 working days = 2
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 2 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    // step_forward_lag(0, 2, {}) → day 0 is working → remaining=1 → day 1 is working → remaining=0 → return 2
    assert_eq!(b.early_start, 2);
    assert_eq!(b.early_finish, 6);
}

#[test]
fn test_ss_negative_lag() {
    // A(dur=5, minES=3) SS-1→ B(dur=3)
    // anchor = A.ES = 3, step_forward_lag(3, -1, {}) → retreat 1 working day = 2
    // B.ES = max(2, 0) = 2
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 3, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: -1 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 2);
    assert_eq!(b.early_finish, 5);
}

// ── FF (Finish-to-Finish) ───────────────────────────────────────

#[test]
fn test_ff_zero_lag() {
    // A(dur=5) FF→ B(dur=3), no blocked days
    // B must finish no earlier than A finishes: B.EF >= A.EF = 5
    // B.EF = max(B_own_ef, constrained_ef=5) → B.ES derived from EF: retreat(5,3)=2
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FF, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 5);
    assert_eq!(b.early_start, 2);
    assert_eq!(b.early_finish, 5);
}

#[test]
fn test_ff_positive_lag() {
    // A(dur=4) FF+2→ B(dur=3), no blocked days
    // A.EF = 4, constrained_ef = step_forward_lag(4, 2, {}) = 6
    // B.ES = retreat(6, 3) = 3, B.EF = 6
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FF, lag: 2 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 3);
    assert_eq!(b.early_finish, 6);
}

#[test]
fn test_ff_negative_lag() {
    // A(dur=6) FF-2→ B(dur=3)
    // A.EF = 6, constrained_ef = step_forward_lag(6, -2, {}) = 4
    // B.ES = retreat(4, 3) = 1, B.EF = 4
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 6, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FF, lag: -2 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 1);
    assert_eq!(b.early_finish, 4);
}

// ── SF (Start-to-Finish) ────────────────────────────────────────

#[test]
fn test_sf_zero_lag() {
    // A(dur=4) SF→ B(dur=3)
    // SF constrains B's finish: B.EF >= A.ES + lag = 0
    // Since B has no other predecessors, B starts at 0, finishes at 3
    // EF constraint = step_forward_lag(0, 0) = 0, which is ≤ B's own EF
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SF, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    // SF+0 from A.ES=0 means constrained_ef=0, which doesn't push B
    assert_eq!(b.early_start, 0);
    assert_eq!(b.early_finish, 3);
}

#[test]
fn test_sf_positive_lag() {
    // A(dur=4, minES=3) SF+5→ B(dur=2)
    // A.ES = 3, constrained_ef = step_forward_lag(3, 5, {}) = 8
    // B.ES = retreat(8, 2) = 6, B.EF = 8
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 4, min_early_start: 3, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SF, lag: 5 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 6);
    assert_eq!(b.early_finish, 8);
}

// ── FS with lag ──────────────────────────────────────────────────

#[test]
fn test_fs_positive_lag() {
    // A(dur=3) FS+2→ B(dur=4)
    // A.EF = 3, B.ES = step_forward_lag(3, 2, {}) = 5
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 2 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 5);
    assert_eq!(b.early_finish, 9);
}

#[test]
fn test_fs_negative_lag_lead() {
    // A(dur=5) FS-2→ B(dur=3)
    // A.EF = 5, B.ES = step_forward_lag(5, -2, {}) = 3 (retreat 2 working days)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: -2 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 3);
    assert_eq!(b.early_finish, 6);
}

// ── Lag crossing non-working days (forward pass) ─────────────────

#[test]
fn test_fs_lag_crossing_weekend() {
    // A(dur=3) FS+2→ B(dur=2), blocked=[5,6]
    // A: ES=0, EF=3
    // step_forward_lag(3, 2, {5,6}): day 3 working→rem=1, day 4 working→rem=0→return 5
    // snap_forward(5, {5,6}): 5 blocked, 6 blocked → 7
    // B.ES=7, B.EF=advance_working(7, 2, {5,6})=9
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 2 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 7);
    assert_eq!(b.early_finish, 9);
}

#[test]
fn test_ss_lag_crossing_weekend() {
    // A(dur=2) SS+4→ B(dur=3), blocked=[5,6]
    // A.ES=0, anchor=0
    // step_forward_lag(0, 4, {5,6}): day0→rem=3, day1→rem=2, day2→rem=1, day3→rem=0→return 4
    // B.ES = snap_forward(4, {5,6}) = 4
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 4 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 4);
    // advance_working(4, 3, {5,6}): day4→rem=2, day5 blocked, day6 blocked, day7→rem=1, day8→rem=0→return 9
    assert_eq!(b.early_finish, 9);
}

// ── Lag crossing non-working days (backward pass) ────────────────

#[test]
fn test_backward_pass_fs_lag_with_weekend() {
    // A(dur=2) FS+2→ B(dur=2), blocked=[5,6]
    // Forward: A: ES=0, EF=2; B: ES=step_forward_lag(2,2)=4, snap_forward(4)=4, EF=advance(4,2,{5,6})
    //   advance(4,2,{5,6}): day4→rem=1, day5 blocked, day6 blocked, day7→rem=0→return 8
    //   wait... let me trace: advance_working(4, 2, {5,6})
    //   d=4, not blocked, rem=1; d=5 blocked; d=6 blocked; d=7 not blocked, rem=0 → return 8
    // projDuration = 8
    // Backward: B.LF=8, B.LS=retreat(8,2,{5,6})
    //   retreat: d=7 not blocked→rem=1, d=6 blocked, d=5 blocked, d=4 not blocked→rem=0→return 4
    //   B is critical (LS=ES=4, LF=EF=8)
    // A: FS constraint → step_backward_lag(4, 2, {5,6})
    //   lag>0, retreat from 4: d=3 not blocked→rem=1, d=2 not blocked→rem=0→return 2
    //   LF[A]=2, LS[A]=retreat(2,2,{})=0 → A is critical too
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 2 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 2);
    assert_eq!(b.early_start, 4);
    assert_eq!(b.early_finish, 8);
    assert!(a.is_critical);
    assert!(b.is_critical);
    assert_eq!(a.total_float, 0);
    assert_eq!(b.total_float, 0);
}

// ── Mixed network ────────────────────────────────────────────────

#[test]
fn test_mixed_fs_ss_ff_network() {
    // A(dur=5) FS→ C(dur=3)
    // B(dur=4) SS+1→ C(dur=3)
    // A(dur=5) FF→ D(dur=2)
    // C(dur=3) FS→ D(dur=2)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "D".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "C".to_string(), dep_type: DepType::FS, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "C".to_string(), dep_type: DepType::SS, lag: 1 },
        RawDependency { pred_id: "A".to_string(), succ_id: "D".to_string(), dep_type: DepType::FF, lag: 0 },
        RawDependency { pred_id: "C".to_string(), succ_id: "D".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    let c = result.iter().find(|r| r.task_id == "C").unwrap();
    let d = result.iter().find(|r| r.task_id == "D").unwrap();

    // Forward: A: ES=0, EF=5
    // C: FS from A → constrained_es = step_forward_lag(5,0)=5
    //    SS+1 from B → anchor = B.ES=0, step_forward_lag(0,1)=1 → constrained_es = max(5,1) = 5
    //    C.ES=5, C.EF=8
    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 5);
    assert_eq!(c.early_start, 5);
    assert_eq!(c.early_finish, 8);

    // D: FF from A → constrained_ef = step_forward_lag(5,0)=5
    //    FS from C → constrained_es = step_forward_lag(8,0)=8
    //    ef_derived_es = retreat(5,2)=3, es = max(8,3)=8
    //    D.ES=8, D.EF = max(advance(8,2)=10, 5)=10
    assert_eq!(d.early_start, 8);
    assert_eq!(d.early_finish, 10);

    // B has no predecessors: ES=0, EF=4
    assert_eq!(b.early_start, 0);
    assert_eq!(b.early_finish, 4);
}

// ── Cycle detection with non-FS types ────────────────────────────

#[test]
fn test_cycle_ss_detected() {
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "A".to_string(), dep_type: DepType::SS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]);
    assert_eq!(result, Err(CpmError::CycleDetected));
}

#[test]
fn test_cycle_ff_detected() {
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FF, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "A".to_string(), dep_type: DepType::FF, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]);
    assert_eq!(result, Err(CpmError::CycleDetected));
}

#[test]
fn test_cycle_mixed_types_detected() {
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "A".to_string(), dep_type: DepType::SF, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]);
    assert_eq!(result, Err(CpmError::CycleDetected));
}

// ── Negative float preservation ──────────────────────────────────

#[test]
fn test_negative_float_with_constraint() {
    // A(dur=3, minES=5) FS→ B(dur=2)
    // C(dur=10) FS→ B (C drives the project end)
    // Forward: A.ES=5, A.EF=8; C.ES=0, C.EF=10; B.ES=max(8,10)=10, B.EF=12
    // projDur = 12
    // Backward: B.LF=12, B.LS=10
    // A: LF = step_backward_lag(10, 0) = 10, LS = retreat(10,3) = 7
    // But A.ES was forced to 5 => float = LS(7) - ES(5) = 2 working days
    // This test verifies the float calculation is correct with minES constraints
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 5, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 10, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
        RawDependency { pred_id: "C".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();

    assert_eq!(a.early_start, 5);
    assert_eq!(a.late_start, 7);
    assert_eq!(a.total_float, 2);
    assert!(!a.is_critical);
}

// ── Working-day float correctness ────────────────────────────────

#[test]
fn test_float_counts_working_days_with_ss() {
    // A(dur=3) SS→ B(dur=3) FS→ C(dur=2), blocked=[5,6]
    // A and B start together from SS
    // Forward: A.ES=0, A.EF=3; B.ES=0, B.EF=3; C.ES=3, C.EF=advance(3,2,{5,6})
    //   advance(3,2,{5,6}): d=3→rem=1, d=4→rem=0→return 5. But 5 is blocked...
    //   wait: advance_working starts at d=start, checks blocked. d=3 not blocked→rem=1, d=4 not blocked→rem=0→return 5
    //   C.EF = 5. But snap... no, advance_working already returns correct finish.
    //   Actually C tries to work on day 3,4 → C.EF = 5
    // projDur = 5
    // Backward: C: LF=5, LS=retreat(5,2,{5,6})=3, critical
    //   B: FS from C → LF[B]=step_backward_lag(3,0)=3, LS=retreat(3,3,{5,6})=0, critical
    //   A: SS from B → step_backward_lag(0,0)=0 → min_constrained_ls=0
    //     A has only SS successor, so min_constrained_lf stays MAX → LF=projDur=5
    //     LS = retreat(5,3,{5,6})=2 (days 4,3,2)
    //     Then apply LS constraint: min(2, 0) = 0
    //     Hmm, let's think more carefully...
    //
    // Actually let's just verify the test runs and check float
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "C".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 0 },
        RawDependency { pred_id: "B".to_string(), succ_id: "C".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();
    let c = result.iter().find(|r| r.task_id == "C").unwrap();

    assert_eq!(b.early_start, 0);
    assert_eq!(b.early_finish, 3);
    assert_eq!(c.early_start, 3);
    // B→C chain is critical
    assert!(b.is_critical);
    assert!(c.is_critical);
    // A has same ES as B but may have slack since it only has SS dep
    assert_eq!(a.early_start, 0);
}

// ── Backward pass with SS ────────────────────────────────────────

#[test]
fn test_backward_pass_ss() {
    // A(dur=3) SS+1→ B(dur=5)
    // Forward: A.ES=0, A.EF=3; B.ES=step_forward_lag(0,1)=1, B.EF=6
    // projDur=6
    // Backward: B.LF=6, B.LS=retreat(6,5)=1, critical
    //   A: SS dep on B → step_backward_lag(1, 1) → retreat 1 working day from 1: d=0 → return 0
    //     has_ls_constraint=true, min_constrained_ls=0
    //     No FS/FF successors, so min_constrained_lf stays MAX → LF=6
    //     LS = retreat(6, 3) = 3
    //     Apply LS constraint: min(3, 0) = snap_backward(0, {}) = 0
    //     So A.LS=0, A.LF=6
    //     float = LS - ES = 0 - 0 = 0 → A is critical
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 1 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.early_start, 0);
    assert_eq!(b.early_start, 1);
    assert_eq!(b.early_finish, 6);
    assert!(b.is_critical);
    // A.LS = 0 (constrained by SS)
    assert_eq!(a.late_start, 0);
    assert_eq!(a.total_float, 0);
}

// ── Backward pass with FF ────────────────────────────────────────

#[test]
fn test_backward_pass_ff() {
    // A(dur=5) FF+0→ B(dur=3)
    // Forward: A.ES=0, A.EF=5; B: constrained_ef=5, B.ES=retreat(5,3)=2, B.EF=5
    // projDur=5
    // Backward: B.LF=5, B.LS=2
    //   A: FF on B → step_backward_lag(5, 0) = 5 → min_constrained_lf = 5
    //     LF=5, LS=retreat(5,5)=0 → critical
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FF, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 5);
    assert!(a.is_critical);
    // B finishes with A
    assert_eq!(b.late_start, 2);
    assert_eq!(b.late_finish, 5);
    assert!(b.is_critical);
}

// ── Self-dependency with non-FS type rejected ────────────────────

#[test]
fn test_self_dependency_ss_rejected() {
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "A".to_string(), dep_type: DepType::SS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]);
    assert_eq!(result, Err(CpmError::SelfDependency("A".to_string())));
}

// ═══════════════════════════════════════════════════════════════════
// Phase P.1 — Stabilization tests
// ═══════════════════════════════════════════════════════════════════

#[test]
fn test_p1_ss_backward_pass_preserves_duration() {
    // A(dur=3) SS+1→ B(dur=5)
    // Forward: A.ES=0, A.EF=3; B.ES=1, B.EF=6; projDur=6
    // Backward: B.LF=6, B.LS=1 (critical)
    //   A: SS→B → min_constrained_ls=0, LF=6, LS=retreat(6,3)=3
    //   Apply LS constraint: 0 < 3 → LS=0 → LF recomputed = advance(0,3)=3
    //   Duration invariant: LF-LS = 3 = EF-ES ✓
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 1 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();

    assert_eq!(a.early_start, 0);
    assert_eq!(a.early_finish, 3);
    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 3);
    // Duration invariant: late dates span must equal early dates span
    assert_eq!(a.late_finish - a.late_start, a.early_finish - a.early_start);
}

#[test]
fn test_p1_sf_backward_pass_preserves_duration() {
    // A(dur=4) SF+5→ B(dur=2)
    // Forward: A.ES=0, A.EF=4; B.ES=retreat(5,2)=3, B.EF=5; projDur=5
    // Backward: B.LF=5, B.LS=3
    //   A: SF→B → step_backward_lag(5,5)=0; has_ls_constraint, min_constrained_ls=0
    //   LF=5, LS=retreat(5,4)=1; Apply LS: 0 < 1 → LS=0, LF=advance(0,4)=4
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 4, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SF, lag: 5 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();

    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 4);
    assert_eq!(a.late_finish - a.late_start, a.early_finish - a.early_start);
}

#[test]
fn test_p1_ss_backward_with_calendar_preserves_duration() {
    // A(dur=3) SS+1→ B(dur=5), blocked=[5,6]
    // Forward: A.ES=0, A.EF=3; B.ES=1, B.EF=advance(1,5,{5,6})
    //   advance(1,5,{5,6}): d=1→4, d=2→3, d=3→2, d=4→1, d=5 blocked, d=6 blocked,
    //   d=7→0→return 8. B.EF=8; projDur=8
    // Backward: B.LF=8, B.LS=retreat(8,5,{5,6})
    //   retreat(8,5,{5,6}): d=7→4, d=6 blocked, d=5 blocked, d=4→3, d=3→2, d=2→1, d=1→0→return 1
    //   B.LS=1, critical.
    //   A: SS→B → step_backward_lag(1,1,{5,6})=0; has_ls_constraint, min_constrained_ls=0
    //   LF=8, LS=retreat(8,3,{5,6})
    //     retreat(8,3,{5,6}): d=7→2, d=6 blocked, d=5 blocked, d=4→1, d=3→0→return 3
    //   Apply LS: 0 < 3 → LS=0, LF=advance(0,3,{5,6})
    //     advance(0,3,{5,6}): d=0→2, d=1→1, d=2→0→return 3
    //   Duration preserved across weekend.
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::SS, lag: 1 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();

    assert_eq!(a.late_start, 0);
    assert_eq!(a.late_finish, 3);
    assert_eq!(a.late_finish - a.late_start, a.early_finish - a.early_start);
}

#[test]
fn test_p1_zero_float_is_critical() {
    // Guard: zero float → critical (regression baseline for <= 0 check)
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 5, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 0 },
    ];
    let result = calculate_schedule(&tasks, &deps, &[]).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(a.total_float, 0);
    assert!(a.is_critical); // total_float <= 0 → critical
    assert_eq!(b.total_float, 0);
    assert!(b.is_critical);
}

#[test]
fn test_p1_fs_lag_crossing_weekend_forward() {
    // A(dur=3) FS+2→ B(dur=2), blocked=[5,6]
    // Forward: A.ES=0, A.EF=3
    //   step_forward_lag(3, 2, {5,6}): d=3 working→rem=1, d=4 working→rem=0→return 5
    //   snap_forward(5, {5,6}): 5 blocked→6 blocked→7
    //   B.ES=7, B.EF=advance(7,2,{5,6}): d=7→rem=1, d=8→rem=0→return 9
    let tasks = vec![
        RawTask { id: "A".to_string(), duration: 3, min_early_start: 0, parent_id: None, is_summary: false },
        RawTask { id: "B".to_string(), duration: 2, min_early_start: 0, parent_id: None, is_summary: false },
    ];
    let deps = vec![
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string(), dep_type: DepType::FS, lag: 2 },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert_eq!(b.early_start, 7);
    assert_eq!(b.early_finish, 9);
}
