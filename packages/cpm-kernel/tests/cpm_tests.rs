use cpm_kernel::{calculate_schedule, CpmError, RawDependency, RawTask};

#[test]
fn test_simple_chain() {
    let tasks = vec![
        RawTask {
            id: "A".to_string(),
            duration: 3,
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
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
        },
        RawTask {
            id: "B".to_string(),
            duration: 3,
        },
        RawTask {
            id: "C".to_string(),
            duration: 4,
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
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
        },
        RawTask {
            id: "C".to_string(),
            duration: 2,
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
        },
        RawTask {
            id: "B".to_string(),
            duration: 1,
        },
        RawTask {
            id: "C".to_string(),
            duration: 1,
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
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
        },
        RawTask {
            id: "A".to_string(),
            duration: 2,
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
        },
        RawTask {
            id: "B".to_string(),
            duration: 5,
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
    }];

    let deps = vec![];

    let result = calculate_schedule(&tasks, &deps).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].task_id, "A");
    assert_eq!(result[0].early_start, 0);
    assert_eq!(result[0].early_finish, 5);
}
