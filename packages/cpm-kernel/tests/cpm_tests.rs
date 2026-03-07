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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps);

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

    let result = calculate_schedule(&tasks, &deps);

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

    let result = calculate_schedule(&tasks, &deps);

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

    let result = calculate_schedule(&tasks, &deps);

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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

    let result = calculate_schedule(&tasks, &deps).unwrap();

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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
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
    let result = calculate_schedule(&tasks, &deps).unwrap();
    let summary = result.iter().find(|r| r.task_id == "S").unwrap();
    assert_eq!(summary.early_start, 5);
    assert_eq!(summary.early_finish, 8);
}
