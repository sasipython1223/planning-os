// Phase D1: Temporal kernel path validation tests.
//
// These tests validate the PARALLEL temporal scheduling engine
// (run_schedule_temporal) which operates on absolute minutes with
// interval-based calendars. This is NOT the active production scheduler.
// The worker still uses calculate_schedule (slot kernel).
//
// W5B-B1 scope:
// - task calendar_id is active for task date math on temporal shadow path.
// - missing/invalid task calendar_id falls back to project calendar.
// - lag_calendar_id remains deferred and uses project calendar behavior.

use cpm_kernel::{
    ConstraintType, DepType,
    TemporalCalendar, TemporalRelationInput, TemporalScheduleRequest,
    TemporalScheduleResult, TemporalTaskInput,
    run_schedule_temporal,
};

// ── Helpers ──────────────────────────────────────────────────────

/// Build a standard Mon-Fri calendar with 480-minute working days.
/// Each working day is a contiguous 480-minute interval.
/// Weekend days (day 5, 6 in each 7-day cycle) are gaps.
fn mon_fri_calendar(id: &str, num_weeks: usize) -> TemporalCalendar {
    let mut intervals: Vec<(i64, i64)> = Vec::new();
    let day_minutes: i64 = 480;
    for week in 0..num_weeks {
        for day in 0..5 {
            let week_start = (week as i64) * 7 * day_minutes;
            let day_start = week_start + (day as i64) * day_minutes;
            intervals.push((day_start, day_start + day_minutes));
        }
    }
    TemporalCalendar { id: id.to_string(), intervals }
}

/// Build a Mon-Sat calendar with 480-minute working days.
/// Sunday (day 6 in each 7-day cycle) is a gap.
fn mon_sat_calendar(id: &str, num_weeks: usize) -> TemporalCalendar {
    let mut intervals: Vec<(i64, i64)> = Vec::new();
    let day_minutes: i64 = 480;
    for week in 0..num_weeks {
        for day in 0..6 {
            let week_start = (week as i64) * 7 * day_minutes;
            let day_start = week_start + (day as i64) * day_minutes;
            intervals.push((day_start, day_start + day_minutes));
        }
    }
    TemporalCalendar { id: id.to_string(), intervals }
}

/// Build an all-days calendar with 480-minute working days.
fn all_days_calendar(id: &str, num_weeks: usize) -> TemporalCalendar {
    let mut intervals: Vec<(i64, i64)> = Vec::new();
    let day_minutes: i64 = 480;
    for week in 0..num_weeks {
        for day in 0..7 {
            let week_start = (week as i64) * 7 * day_minutes;
            let day_start = week_start + (day as i64) * day_minutes;
            intervals.push((day_start, day_start + day_minutes));
        }
    }
    TemporalCalendar { id: id.to_string(), intervals }
}

/// Build a "no blocked days" calendar — continuous working time.
fn continuous_calendar(id: &str, total_minutes: i64) -> TemporalCalendar {
    TemporalCalendar {
        id: id.to_string(),
        intervals: vec![(0, total_minutes)],
    }
}

fn task(id: &str, duration: i64, cal: &str) -> TemporalTaskInput {
    TemporalTaskInput {
        id: id.to_string(),
        duration_minutes: duration,
        min_early_start_minutes: 0,
        calendar_id: cal.to_string(),
        parent_id: None,
        is_summary: false,
        constraint_type: ConstraintType::ASAP,
        constraint_date_minutes: None,
    }
}

fn constrained_task(id: &str, duration: i64, cal: &str, ct: ConstraintType, cd: i64) -> TemporalTaskInput {
    TemporalTaskInput {
        id: id.to_string(),
        duration_minutes: duration,
        min_early_start_minutes: 0,
        calendar_id: cal.to_string(),
        parent_id: None,
        is_summary: false,
        constraint_type: ct,
        constraint_date_minutes: Some(cd),
    }
}

fn summary_task(id: &str, cal: &str) -> TemporalTaskInput {
    TemporalTaskInput {
        id: id.to_string(),
        duration_minutes: 0,
        min_early_start_minutes: 0,
        calendar_id: cal.to_string(),
        parent_id: None,
        is_summary: true,
        constraint_type: ConstraintType::ASAP,
        constraint_date_minutes: None,
    }
}

fn child_task(id: &str, duration: i64, cal: &str, parent: &str) -> TemporalTaskInput {
    TemporalTaskInput {
        id: id.to_string(),
        duration_minutes: duration,
        min_early_start_minutes: 0,
        calendar_id: cal.to_string(),
        parent_id: Some(parent.to_string()),
        is_summary: false,
        constraint_type: ConstraintType::ASAP,
        constraint_date_minutes: None,
    }
}

fn task_with_min_start(id: &str, duration: i64, cal: &str, min_start: i64) -> TemporalTaskInput {
    TemporalTaskInput {
        id: id.to_string(),
        duration_minutes: duration,
        min_early_start_minutes: min_start,
        calendar_id: cal.to_string(),
        parent_id: None,
        is_summary: false,
        constraint_type: ConstraintType::ASAP,
        constraint_date_minutes: None,
    }
}

fn fs(pred: &str, succ: &str) -> TemporalRelationInput {
    TemporalRelationInput {
        pred_id: pred.to_string(),
        succ_id: succ.to_string(),
        dep_type: DepType::FS,
        lag_minutes: 0,
        lag_calendar_id: "project".to_string(),
    }
}

fn fs_lag(pred: &str, succ: &str, lag: i64) -> TemporalRelationInput {
    TemporalRelationInput {
        pred_id: pred.to_string(),
        succ_id: succ.to_string(),
        dep_type: DepType::FS,
        lag_minutes: lag,
        lag_calendar_id: "project".to_string(),
    }
}

fn dep(pred: &str, succ: &str, dt: DepType, lag: i64) -> TemporalRelationInput {
    TemporalRelationInput {
        pred_id: pred.to_string(),
        succ_id: succ.to_string(),
        dep_type: dt,
        lag_minutes: lag,
        lag_calendar_id: "project".to_string(),
    }
}

fn find<'a>(results: &'a [TemporalScheduleResult], id: &str) -> &'a TemporalScheduleResult {
    results.iter().find(|r| r.task_id == id).unwrap()
}

// ── Basic scheduling ─────────────────────────────────────────────

#[test]
fn test_temporal_empty() {
    let req = TemporalScheduleRequest {
        tasks: vec![],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    assert!(results.is_empty());
}

#[test]
fn test_temporal_single_task() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    assert_eq!(results.len(), 1);
    let a = find(&results, "A");
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 480);
    assert_eq!(a.late_start_minute, 0);
    assert_eq!(a.late_finish_minute, 480);
    assert_eq!(a.total_float_minutes, 0);
    assert!(a.is_critical);
}

#[test]
fn test_temporal_min_early_start_applies_forward_lower_bound() {
    let req = TemporalScheduleRequest {
        tasks: vec![task_with_min_start("A", 480, "project", 120)],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    assert_eq!(a.early_start_minute, 120);
    assert_eq!(a.early_finish_minute, 600);
}

#[test]
fn test_temporal_simple_chain() {
    // A(480) → B(960) → C(480) in continuous calendar
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 960, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![fs("A", "B"), fs("B", "C")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");
    let c = find(&results, "C");

    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 480);
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 1440);
    assert_eq!(c.early_start_minute, 1440);
    assert_eq!(c.early_finish_minute, 1920);

    // All critical
    assert!(a.is_critical);
    assert!(b.is_critical);
    assert!(c.is_critical);
    assert_eq!(a.total_float_minutes, 0);
    assert_eq!(b.total_float_minutes, 0);
    assert_eq!(c.total_float_minutes, 0);
}

#[test]
fn test_temporal_parallel_paths_with_float() {
    // Critical: B(1440)
    // Non-critical: A(480) → C(480)
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 1440, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![fs("A", "C")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");
    let c = find(&results, "C");

    // B is critical
    assert_eq!(b.early_start_minute, 0);
    assert_eq!(b.early_finish_minute, 1440);
    assert!(b.is_critical);
    assert_eq!(b.total_float_minutes, 0);

    // A and C have float
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 480);
    assert_eq!(a.total_float_minutes, 480); // 1440 - 960 = 480 working minutes of float
    assert!(!a.is_critical);

    assert_eq!(c.early_start_minute, 480);
    assert_eq!(c.early_finish_minute, 960);
    assert_eq!(c.total_float_minutes, 480);
    assert!(!c.is_critical);
}

// ── Calendar-aware scheduling (Mon-Fri) ──────────────────────────

#[test]
fn test_temporal_calendar_skips_weekend() {
    // Mon-Fri calendar: days are 480min each, weekends are gaps
    // Task A: 6 working days = 2880 minutes
    // Should span Mon-Fri (5 days) + skip weekend + Mon (1 day)
    let cal = mon_fri_calendar("project", 4);
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 2880, "project")],
        relations: vec![],
        calendars: vec![cal],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    // 5 days = [0,480),[480,960),[960,1440),[1440,1920),[1920,2400) = 2400 minutes consumed
    // Need 480 more → next interval is [3360,3840) (Mon of week 2)
    // Finish at 3360 + 480 = 3840
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 3840);
    assert!(a.is_critical);
}

#[test]
fn test_temporal_calendar_chain_crosses_weekend() {
    // A(5 days=2400) → B(2 days=960)
    // A finishes at end of Fri (2400), B starts Mon (3360)
    let cal = mon_fri_calendar("project", 4);
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2400, "project"),
            task("B", 960, "project"),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![cal],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 2400);
    // B starts at snap_forward(2400) = 3360 (Mon of week 2)
    assert_eq!(b.early_start_minute, 3360);
    assert_eq!(b.early_finish_minute, 3360 + 960);
}

#[test]
fn test_temporal_calendar_float_counts_working_minutes() {
    // Critical: B(5 days=2400)
    // Non-critical: A(3 days=1440) → C(1 day=480)
    // Total critical path = 2400. Non-critical = 1920. Float = 480 working minutes.
    let cal = mon_fri_calendar("project", 4);
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 1440, "project"),
            task("B", 2400, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![fs("A", "C")],
        calendars: vec![cal],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");
    let c = find(&results, "C");

    assert!(b.is_critical);
    assert!(!a.is_critical);
    assert!(!c.is_critical);

    // Float should be 480 working minutes (1 working day)
    assert_eq!(a.total_float_minutes, 480);
    assert_eq!(c.total_float_minutes, 480);
}

#[test]
fn test_temporal_task_calendar_5day_skips_weekend() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 2880, "five-day")],
        relations: vec![],
        calendars: vec![mon_fri_calendar("project", 4), mon_fri_calendar("five-day", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    // 6 working days on 5-day calendar crosses weekend.
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 3840);
}

#[test]
fn test_temporal_task_calendar_6day_allows_saturday() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 2880, "six-day")],
        relations: vec![],
        calendars: vec![mon_fri_calendar("project", 4), mon_sat_calendar("six-day", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    // 6 working days on 6-day calendar ends Saturday, no weekend skip required.
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 2880);
}

#[test]
fn test_temporal_task_calendar_7day_allows_sunday() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 3360, "seven-day")],
        relations: vec![],
        calendars: vec![mon_fri_calendar("project", 4), all_days_calendar("seven-day", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    // 7 working days on 7-day calendar includes Sunday in the first week.
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 3360);
}

#[test]
fn test_temporal_invalid_task_calendar_falls_back_to_project() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 2880, "invalid-cal")],
        relations: vec![],
        calendars: vec![mon_fri_calendar("project", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    // Falls back to project 5-day calendar behavior deterministically.
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 3840);
}

#[test]
fn test_temporal_cross_calendar_fs_5day_pred_to_7day_succ_can_start_saturday() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2400, "five-day"),
            task("B", 480, "seven-day"),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![
            mon_fri_calendar("project", 4),
            mon_fri_calendar("five-day", 4),
            all_days_calendar("seven-day", 4),
        ],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.early_finish_minute, 2400);
    assert_eq!(b.early_start_minute, 2400);
    assert_eq!(b.early_finish_minute, 2880);
}

#[test]
fn test_temporal_cross_calendar_fs_7day_pred_to_5day_succ_snaps_to_monday() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2880, "seven-day"),
            task("B", 480, "five-day"),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![
            mon_fri_calendar("project", 4),
            all_days_calendar("seven-day", 4),
            mon_fri_calendar("five-day", 4),
        ],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.early_finish_minute, 2880);
    // Saturday anchor snaps to Monday on the successor 5-day calendar.
    assert_eq!(b.early_start_minute, 3360);
    assert_eq!(b.early_finish_minute, 3840);
}

#[test]
fn test_temporal_single_calendar_behavior_matches_project_calendar_baseline() {
    let baseline_req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2400, "project"),
            task("B", 960, "project"),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![mon_fri_calendar("project", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let fallback_req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2400, "missing-cal"),
            task("B", 960, "missing-cal"),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![mon_fri_calendar("project", 4)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };

    let baseline = run_schedule_temporal(&baseline_req).unwrap();
    let fallback = run_schedule_temporal(&fallback_req).unwrap();

    assert_eq!(baseline, fallback);
}

// ── Dependency types ─────────────────────────────────────────────

#[test]
fn test_temporal_ss_zero_lag() {
    // SS: B starts when A starts
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![dep("A", "B", DepType::SS, 0)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.early_start_minute, 0);
    assert_eq!(b.early_start_minute, 0);
    assert_eq!(b.early_finish_minute, 480);
}

#[test]
fn test_temporal_ss_positive_lag() {
    // SS+480: B starts 480 working minutes after A starts
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![dep("A", "B", DepType::SS, 480)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
}

#[test]
fn test_temporal_ff_zero_lag() {
    // FF: B finishes when A finishes
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![dep("A", "B", DepType::FF, 0)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.early_finish_minute, 960);
    // B finish >= A finish, and B duration=480, so B start = retreat(960,480) = 480
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
}

#[test]
fn test_temporal_sf_zero_lag() {
    // SF: B finishes when A starts
    // B.EF >= A.ES + lag = 0
    // Since B.EF must be >= 0 and B duration=480, B can start at -480 which is impossible.
    // With data_date=0, B.EF = max(0) = 0... actually let me think.
    // SF constrains B's finish >= A's start. A.ES = 0. So B.EF >= 0.
    // B has duration 480. Since has_ef_constraint and max_constrained_ef=0,
    // ef_derived_es = retreat(0, 480) = can't retreat → fallback to 0.
    // B.ES = snap_forward(max(0, 0)) = 0, B.EF = advance(0, 480) = 480.
    // B.EF = max(480, 0) = 480. 
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![dep("A", "B", DepType::SF, 0)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    assert_eq!(b.early_start_minute, 0);
    assert_eq!(b.early_finish_minute, 480);
}

#[test]
fn test_temporal_fs_positive_lag() {
    // FS+480: B starts 480 minutes after A finishes
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![fs_lag("A", "B", 480)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // A finishes at 480, lag=480 → B starts at 960
    assert_eq!(b.early_start_minute, 960);
    assert_eq!(b.early_finish_minute, 1440);
}

#[test]
fn test_temporal_fs_negative_lag_lead() {
    // FS-480: B can start 480 minutes before A finishes
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![fs_lag("A", "B", -480)],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // A finishes at 960, lag=-480 → retreat 480 from 960 = 480
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
}

#[test]
fn test_temporal_fs_lag_crossing_weekend() {
    // A(1 day) → FS+480 → B(1 day). A finishes Fri end. Lag skips weekend.
    let cal = mon_fri_calendar("project", 4);
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 2400, "project"),  // 5 days, finishes end of Fri
            task("B", 480, "project"),   // 1 day
        ],
        relations: vec![fs_lag("A", "B", 480)],
        calendars: vec![cal],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // A finishes at 2400 (end of Fri). Lag 480 from 2400:
    // snap_forward(2400) = 3360 (Mon), advance 480 from 3360 = 3840
    // So B.ES = snap_forward(3840) = 3840, B.EF = 3840+480 = 4320
    // Wait, step_forward_lag returns 3840 (the exclusive end after lag).
    // B.ES = snap_forward(3840) = 3840 (which is start of Tue in week 2)
    assert_eq!(b.early_start_minute, 3840);
    assert_eq!(b.early_finish_minute, 4320);
}

// ── Constraints ──────────────────────────────────────────────────

#[test]
fn test_temporal_snet_pushes_start() {
    // SNET at 960: task should start at 960 instead of 0
    let req = TemporalScheduleRequest {
        tasks: vec![constrained_task("A", 480, "project", ConstraintType::SNET, 960)],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    assert_eq!(a.early_start_minute, 960);
    assert_eq!(a.early_finish_minute, 1440);
}

#[test]
fn test_temporal_snet_no_effect_when_dep_later() {
    // SNET at 480 on B, but A→B pushes B to 960 which is later
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            constrained_task("B", 480, "project", ConstraintType::SNET, 480),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // Dependency puts B at 960, SNET 480 doesn't override
    assert_eq!(b.early_start_minute, 960);
    assert_eq!(b.early_finish_minute, 1440);
}

#[test]
fn test_temporal_fnlt_clamps_late_finish() {
    // FNLT at 960 on B in chain A→B where project finishes at 1440
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            constrained_task("B", 480, "project", ConstraintType::FNLT, 960),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // Early: A[0,480) → B[480,960). Late: FNLT clamps B.LF to 960
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
    assert_eq!(b.late_finish_minute, 960);
    assert_eq!(b.late_start_minute, 480);
    assert_eq!(b.total_float_minutes, 0);
}

#[test]
fn test_temporal_mso_pins_start() {
    // MSO at 960: overrides dependency-driven start
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            constrained_task("B", 480, "project", ConstraintType::MSO, 960),
        ],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    assert_eq!(b.early_start_minute, 960);
    assert_eq!(b.early_finish_minute, 1440);
}

#[test]
fn test_temporal_mfo_pins_finish() {
    let req = TemporalScheduleRequest {
        tasks: vec![constrained_task("A", 480, "project", ConstraintType::MFO, 960)],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    assert_eq!(a.early_finish_minute, 960);
    assert_eq!(a.early_start_minute, 480);
}

#[test]
fn test_temporal_alap_shifts_to_late() {
    // ALAP task with parallel critical path
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),       // critical: 960
            {
                let mut t = task("B", 480, "project");
                t.constraint_type = ConstraintType::ALAP;
                t
            },
        ],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let b = find(&results, "B");

    // ALAP shifts B to late dates: LS=480, LF=960
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
}

// ── Validation ───────────────────────────────────────────────────

#[test]
fn test_temporal_cycle_detection() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 480, "project"),
        ],
        relations: vec![fs("A", "B"), fs("B", "A")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let err = run_schedule_temporal(&req).unwrap_err();
    assert_eq!(err, cpm_kernel::CpmError::CycleDetected);
}

#[test]
fn test_temporal_duplicate_task() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("A", 960, "project"),
        ],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let err = run_schedule_temporal(&req).unwrap_err();
    assert_eq!(err, cpm_kernel::CpmError::DuplicateTaskId("A".to_string()));
}

#[test]
fn test_temporal_self_dependency() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project")],
        relations: vec![fs("A", "A")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let err = run_schedule_temporal(&req).unwrap_err();
    assert_eq!(err, cpm_kernel::CpmError::SelfDependency("A".to_string()));
}

#[test]
fn test_temporal_missing_task() {
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project")],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let err = run_schedule_temporal(&req).unwrap_err();
    assert_eq!(err, cpm_kernel::CpmError::TaskNotFound("B".to_string()));
}

// ── Summary rollup ───────────────────────────────────────────────

#[test]
fn test_temporal_summary_rollup() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            summary_task("S", "project"),
            child_task("A", 480, "project", "S"),
            child_task("B", 960, "project", "S"),
        ],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let s = find(&results, "S");

    // Summary rolls up to min(ES) and max(EF) of children
    assert_eq!(s.early_start_minute, 0);
    assert_eq!(s.early_finish_minute, 960);
}

// ── Free float ───────────────────────────────────────────────────

#[test]
fn test_temporal_free_float_chain() {
    // A→B→C: all critical, free float = 0 for A and B
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 480, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![fs("A", "B"), fs("B", "C")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");
    let c = find(&results, "C");

    assert_eq!(a.free_float_minutes, 0);
    assert_eq!(b.free_float_minutes, 0);
    // C has no successors, free float = total float
    assert_eq!(c.free_float_minutes, 0);
}

#[test]
fn test_temporal_free_float_merge() {
    // A(480) → C(480), B(960) → C
    // B is on critical path. A has float.
    // A.EF=480, C.ES=960 → A free float = 480 working minutes
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("B", 960, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![fs("A", "C"), fs("B", "C")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");

    assert_eq!(a.free_float_minutes, 480);
    assert_eq!(b.free_float_minutes, 0);
}

// ── Data date ────────────────────────────────────────────────────

#[test]
fn test_temporal_data_date_shifts_start() {
    // data_date_minute = 480: tasks can't start before minute 480
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 480,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");

    assert_eq!(a.early_start_minute, 480);
    assert_eq!(a.early_finish_minute, 960);
}

// ── Zero-duration milestone ──────────────────────────────────────

#[test]
fn test_temporal_zero_duration_milestone() {
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 480, "project"),
            task("M", 0, "project"),
        ],
        relations: vec![fs("A", "M")],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let m = find(&results, "M");

    assert_eq!(m.early_start_minute, 480);
    assert_eq!(m.early_finish_minute, 480);
    assert!(m.is_critical);
}

// ── Mixed dependency network ─────────────────────────────────────

#[test]
fn test_temporal_mixed_fs_ss_ff() {
    // A(960) —FS→ C(480)
    // A(960) —SS+480→ B(480)
    // B(480) —FF→ C(480)
    let req = TemporalScheduleRequest {
        tasks: vec![
            task("A", 960, "project"),
            task("B", 480, "project"),
            task("C", 480, "project"),
        ],
        relations: vec![
            fs("A", "C"),
            dep("A", "B", DepType::SS, 480),
            dep("B", "C", DepType::FF, 0),
        ],
        calendars: vec![continuous_calendar("project", 10000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    let b = find(&results, "B");
    let c = find(&results, "C");

    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 960);
    // B: SS+480 from A.ES=0 → B.ES=480, B.EF=960
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 960);
    // C: FS from A.EF=960 → C.ES >= 960
    //    FF from B.EF=960 → C.EF >= 960, C.ES = retreat(960,480)=480
    //    max(960, 480) = 960 → C.ES=960, C.EF=1440
    assert_eq!(c.early_start_minute, 960);
    assert_eq!(c.early_finish_minute, 1440);
}
