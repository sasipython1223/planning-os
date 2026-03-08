use cpm_kernel::{calculate_schedule, CpmError, RawDependency, RawTask};

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
        },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
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
        },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
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
        },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
        },
        RawDependency {
            pred_id: "C".to_string(),
            succ_id: "A".to_string(),
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
        },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
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
        },
        RawDependency {
            pred_id: "B".to_string(),
            succ_id: "C".to_string(),
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
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() }];
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
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() }];
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
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() }];
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
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() }];
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
    let deps = vec![RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() }];
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "C".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
        RawDependency { pred_id: "B".to_string(), succ_id: "C".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "C".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
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
        RawDependency { pred_id: "A".to_string(), succ_id: "B".to_string() },
    ];
    let blocked = vec![5, 6];
    let result = calculate_schedule(&tasks, &deps, &blocked).unwrap();
    let a = result.iter().find(|r| r.task_id == "A").unwrap();
    let b = result.iter().find(|r| r.task_id == "B").unwrap();

    assert!(a.is_critical);
    assert!(b.is_critical);
    // Summary rollup tested at Worker layer (rollupSummarySchedules propagates isCritical from children)
}
