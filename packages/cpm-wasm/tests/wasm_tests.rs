use serde::Serialize;
use wasm_bindgen_test::*;

// WASM boundary tests - run with: wasm-pack test --node

// Test helper structs matching the boundary contract
#[derive(Serialize)]
struct TestTask {
    id: String,
    duration: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestDependency {
    pred_id: String,
    succ_id: String,
}

#[derive(Serialize)]
struct TestRequest {
    tasks: Vec<TestTask>,
    dependencies: Vec<TestDependency>,
}

#[wasm_bindgen_test]
fn test_simple_chain() {
    use cpm_wasm::calculate_schedule;

    let request = TestRequest {
        tasks: vec![
            TestTask {
                id: "A".to_string(),
                duration: 3,
            },
            TestTask {
                id: "B".to_string(),
                duration: 5,
            },
            TestTask {
                id: "C".to_string(),
                duration: 2,
            },
        ],
        dependencies: vec![
            TestDependency {
                pred_id: "A".to_string(),
                succ_id: "B".to_string(),
            },
            TestDependency {
                pred_id: "B".to_string(),
                succ_id: "C".to_string(),
            },
        ],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let response: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(response["scheduleVersion"], 1);
    let results = response["results"].as_array().unwrap();
    assert_eq!(results.len(), 3);

    // Task A: starts at 0, finishes at 3 (critical)
    assert_eq!(results[0]["taskId"], "A");
    assert_eq!(results[0]["earlyStart"], 0);
    assert_eq!(results[0]["earlyFinish"], 3);
    assert_eq!(results[0]["lateStart"], 0);
    assert_eq!(results[0]["lateFinish"], 3);
    assert_eq!(results[0]["totalFloat"], 0);
    assert_eq!(results[0]["isCritical"], true);

    // Task B: starts at 3, finishes at 8 (critical)
    assert_eq!(results[1]["taskId"], "B");
    assert_eq!(results[1]["earlyStart"], 3);
    assert_eq!(results[1]["earlyFinish"], 8);
    assert_eq!(results[1]["lateStart"], 3);
    assert_eq!(results[1]["lateFinish"], 8);
    assert_eq!(results[1]["totalFloat"], 0);
    assert_eq!(results[1]["isCritical"], true);

    // Task C: starts at 8, finishes at 10 (critical)
    assert_eq!(results[2]["taskId"], "C");
    assert_eq!(results[2]["earlyStart"], 8);
    assert_eq!(results[2]["earlyFinish"], 10);
    assert_eq!(results[2]["lateStart"], 8);
    assert_eq!(results[2]["lateFinish"], 10);
    assert_eq!(results[2]["totalFloat"], 0);
    assert_eq!(results[2]["isCritical"], true);
}

#[wasm_bindgen_test]
fn test_cycle_detected() {
    use cpm_wasm::calculate_schedule;

    let request = TestRequest {
        tasks: vec![
            TestTask {
                id: "A".to_string(),
                duration: 1,
            },
            TestTask {
                id: "B".to_string(),
                duration: 1,
            },
            TestTask {
                id: "C".to_string(),
                duration: 1,
            },
        ],
        dependencies: vec![
            TestDependency {
                pred_id: "A".to_string(),
                succ_id: "B".to_string(),
            },
            TestDependency {
                pred_id: "B".to_string(),
                succ_id: "C".to_string(),
            },
            TestDependency {
                pred_id: "C".to_string(),
                succ_id: "A".to_string(),
            },
        ],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let error: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(error["type"], "CycleDetected");
    assert!(error["message"].as_str().unwrap().contains("Cycle detected"));
}

#[wasm_bindgen_test]
fn test_duplicate_task_id() {
    use cpm_wasm::calculate_schedule;

    let request = TestRequest {
        tasks: vec![
            TestTask {
                id: "A".to_string(),
                duration: 3,
            },
            TestTask {
                id: "B".to_string(),
                duration: 5,
            },
            TestTask {
                id: "A".to_string(),
                duration: 2,
            },
        ],
        dependencies: vec![],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let error: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(error["type"], "DuplicateTaskId");
    assert_eq!(error["taskId"], "A");
    assert!(error["message"].as_str().unwrap().contains("Duplicate task ID"));
}

#[wasm_bindgen_test]
fn test_self_dependency() {
    use cpm_wasm::calculate_schedule;

    let request = TestRequest {
        tasks: vec![
            TestTask {
                id: "A".to_string(),
                duration: 3,
            },
            TestTask {
                id: "B".to_string(),
                duration: 5,
            },
        ],
        dependencies: vec![TestDependency {
            pred_id: "A".to_string(),
            succ_id: "A".to_string(),
        }],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let error: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(error["type"], "SelfDependency");
    assert_eq!(error["taskId"], "A");
    assert!(error["message"]
        .as_str()
        .unwrap()
        .contains("Self-dependency"));
}

#[wasm_bindgen_test]
fn test_task_not_found() {
    use cpm_wasm::calculate_schedule;

    let request = TestRequest {
        tasks: vec![TestTask {
            id: "A".to_string(),
            duration: 3,
        }],
        dependencies: vec![TestDependency {
            pred_id: "A".to_string(),
            succ_id: "B".to_string(),
        }],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let error: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(error["type"], "TaskNotFound");
    assert_eq!(error["taskId"], "B");
    assert!(error["message"].as_str().unwrap().contains("Task not found"));
}

#[wasm_bindgen_test]
fn test_parallel_paths_with_float() {
    use cpm_wasm::calculate_schedule;

    // Parallel paths: A(3)→C(2) and B(7)
    // B is critical, A and C have float
    let request = TestRequest {
        tasks: vec![
            TestTask {
                id: "A".to_string(),
                duration: 3,
            },
            TestTask {
                id: "B".to_string(),
                duration: 7,
            },
            TestTask {
                id: "C".to_string(),
                duration: 2,
            },
        ],
        dependencies: vec![TestDependency {
            pred_id: "A".to_string(),
            succ_id: "C".to_string(),
        }],
    };
    let request_value = serde_wasm_bindgen::to_value(&request).unwrap();

    let result = calculate_schedule(request_value).unwrap();
    let response: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();

    assert_eq!(response["scheduleVersion"], 1);
    let results = response["results"].as_array().unwrap();

    // Find each task
    let task_a = results.iter().find(|r| r["taskId"] == "A").unwrap();
    let task_b = results.iter().find(|r| r["taskId"] == "B").unwrap();
    let task_c = results.iter().find(|r| r["taskId"] == "C").unwrap();

    // Task B is critical (longest path)
    assert_eq!(task_b["earlyStart"], 0);
    assert_eq!(task_b["earlyFinish"], 7);
    assert_eq!(task_b["lateStart"], 0);
    assert_eq!(task_b["lateFinish"], 7);
    assert_eq!(task_b["totalFloat"], 0);
    assert_eq!(task_b["isCritical"], true);

    // Task A has float
    assert_eq!(task_a["earlyStart"], 0);
    assert_eq!(task_a["earlyFinish"], 3);
    assert_eq!(task_a["totalFloat"], 2);
    assert_eq!(task_a["isCritical"], false);

    // Task C has float
    assert_eq!(task_c["earlyStart"], 3);
    assert_eq!(task_c["earlyFinish"], 5);
    assert_eq!(task_c["totalFloat"], 2);
    assert_eq!(task_c["isCritical"], false);
}
