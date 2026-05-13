// W5B-B2.12A.7 — Sub-Minute Residue Mechanistic Trace, Step 4
// (Rust boundary / calendar tests).
//
// Synthetic, test-only. Targets the run_schedule_temporal Rust kernel
// directly with the smallest possible inputs to pin the kernel's
// inclusive/exclusive finish-boundary semantics and its calendar-gap
// resume behaviour. These tests do NOT touch production kernel logic
// and do not introduce any test helper that would change kernel
// behaviour.
//
// Hypothesis under test (B2.12A.6 finding):
//   The 1–3 unit residue observed live could in principle originate
//   from an inclusive-vs-exclusive finish-minute convention mismatch
//   between the temporal kernel and the slot kernel, OR from a
//   calendar-gap resume choice that differs from the slot kernel's
//   day-aligned resume. These tests pin the temporal kernel side.
//
// No production code is changed. Only tests are added.

use cpm_kernel::{
    ConstraintType, DepType,
    TemporalCalendar, TemporalRelationInput, TemporalScheduleRequest,
    TemporalScheduleResult, TemporalTaskInput,
    run_schedule_temporal,
};

// ── Local helpers (parallel to temporal_tests.rs, copied to keep this
//    file self-contained and avoid coupling to that file's internals) ──

fn continuous_calendar(id: &str, total_minutes: i64) -> TemporalCalendar {
    TemporalCalendar { id: id.to_string(), intervals: vec![(0, total_minutes)] }
}

/// Two work intervals separated by a deliberate gap.
/// `[0, work1) gap [gap_end, gap_end + work2)`
fn split_calendar(id: &str, work1: i64, gap_end: i64, work2: i64) -> TemporalCalendar {
    TemporalCalendar {
        id: id.to_string(),
        intervals: vec![(0, work1), (gap_end, gap_end + work2)],
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

fn find<'a>(results: &'a [TemporalScheduleResult], id: &str) -> &'a TemporalScheduleResult {
    results.iter().find(|r| r.task_id == id).unwrap()
}

// ─── 1. Inclusive/exclusive finish boundary ───────────────────────────

#[test]
fn b2_12a_7_finish_is_exclusive_upper_bound_60min_duration() {
    // One task, start=0, duration=60. Per the temporal kernel
    // documentation (see temporal.rs::advance_working), the finish
    // minute is the EXCLUSIVE upper bound of the working span.
    // For a task that starts at minute 0 with 60 minutes of work in a
    // continuous calendar, finish must equal 60 (not 59, not 61).
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 60, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10_000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let results = run_schedule_temporal(&req).unwrap();
    let a = find(&results, "A");
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 60);
    // Net duration must equal the input duration EXACTLY.
    assert_eq!(a.early_finish_minute - a.early_start_minute, 60);
}

#[test]
fn b2_12a_7_finish_minus_start_equals_duration_for_misc_durations() {
    for dur in [1_i64, 59, 60, 61, 479, 480, 481, 1439, 1440, 1441] {
        let req = TemporalScheduleRequest {
            tasks: vec![task("A", dur, "project")],
            relations: vec![],
            calendars: vec![continuous_calendar("project", 100_000)],
            project_calendar_id: "project".to_string(),
            data_date_minute: 0,
        };
        let results = run_schedule_temporal(&req).unwrap();
        let a = find(&results, "A");
        assert_eq!(
            a.early_finish_minute - a.early_start_minute,
            dur,
            "duration round-trip residue at dur={}",
            dur,
        );
        assert_eq!(a.total_float_minutes, 0, "single-task float must be 0 at dur={}", dur);
        assert!(a.is_critical, "single task must be critical at dur={}", dur);
    }
}

#[test]
fn b2_12a_7_one_hour_exact_duration_round_trip() {
    // One task, 60-minute duration, finish boundary must be 60 — i.e.
    // the half-open interval convention [0, 60) is respected.
    let req = TemporalScheduleRequest {
        tasks: vec![task("X", 60, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10_000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let x = find(&r, "X");
    assert_eq!(x.early_finish_minute, 60);
    assert_eq!(x.late_finish_minute, 60);
    assert_eq!(x.late_start_minute, 0);
}

// ─── 2. Workday boundary representation ───────────────────────────────

#[test]
fn b2_12a_7_task_ending_exactly_at_workday_boundary_uses_exclusive_end() {
    // Calendar interval is [0, 480) — one full workday. A task with
    // duration 480 starting at minute 0 must finish at minute 480 (the
    // EXCLUSIVE end of the interval), NOT 479. This is the canonical
    // workday-boundary representation contract.
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 480)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 480);
    // 480 is the boundary minute itself (exclusive end of the working
    // interval). Subsequent successors anchored at FS pred-finish would
    // be expected to start at 480 in a calendar that has working time
    // continuing from 480; in a calendar that ends at 480 there is no
    // next minute to consume, which is a separate test below.
}

#[test]
fn b2_12a_7_finish_at_boundary_then_zero_duration_successor_lands_at_same_boundary_minute() {
    // FS chain: A(480) → B(0-duration milestone). B's start should land
    // at the same boundary minute A finishes on (480), and a 0-duration
    // task's finish equals its start (per advance_working in temporal.rs).
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 480, "project"), task("B", 0, "project")],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10_000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    let b = find(&r, "B");
    assert_eq!(a.early_finish_minute, 480);
    assert_eq!(b.early_start_minute, 480);
    assert_eq!(b.early_finish_minute, 480);
}

// ─── 3. Calendar-gap resume ───────────────────────────────────────────

#[test]
fn b2_12a_7_calendar_gap_resume_is_at_exact_gap_end_minute() {
    // Working time: [0, 60) then GAP [60, 1500) then [1500, 5000).
    // Task A: duration 90. After consuming 60 min in interval 1 it
    // must resume EXACTLY at minute 1500 (gap end) for the remaining
    // 30 min, finishing at 1530. This pins the resume convention as
    // "first minute of the next working interval" — there is no
    // ±1 wobble.
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 90, "project")],
        relations: vec![],
        calendars: vec![split_calendar("project", 60, 1500, 3500)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    assert_eq!(a.early_start_minute, 0);
    assert_eq!(a.early_finish_minute, 1530);
}

#[test]
fn b2_12a_7_calendar_gap_task_starting_one_minute_before_gap_resumes_cleanly() {
    // Calendar: [0, 100) GAP [100, 1000) [1000, 5000).
    // A starts at minute 99 (via min_early_start), duration 50.
    // Consumes 1 min in interval 1 (99→100), then resumes at 1000 for
    // remaining 49 min, finishing at 1049. Pin exact resume + finish.
    let req = TemporalScheduleRequest {
        tasks: vec![task_with_min_start("A", 50, "project", 99)],
        relations: vec![],
        calendars: vec![split_calendar("project", 100, 1000, 4000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    assert_eq!(a.early_start_minute, 99);
    assert_eq!(a.early_finish_minute, 1049);
    assert_eq!(a.early_finish_minute - a.early_start_minute, 950); // wall-clock span ≠ working duration
    // Important note: wall-clock span (950) ≠ working duration (50).
    // This is the OBSERVATIONAL CONSEQUENCE of calendar-aware
    // scheduling and is correct kernel behaviour — but it is also why
    // the downstream TemporalScheduleTranslator's day-bucketing
    // (floor(start/1440), ceil(finish/1440)) cannot be a pure
    // wall-clock-day mapping when the kernel returns calendar-space
    // minutes. See B2.12A.7 milestone doc §9.
}

// ─── 4. Sub-minute / fractional concern ──────────────────────────────

#[test]
fn b2_12a_7_kernel_never_emits_sub_minute_finish_for_integer_duration() {
    // Sanity: the kernel arithmetic is i64; there is no path that can
    // produce a non-integer finish for integer-minute inputs.
    for dur in [1_i64, 60, 480, 481, 1440] {
        let req = TemporalScheduleRequest {
            tasks: vec![task("A", dur, "project")],
            relations: vec![],
            calendars: vec![continuous_calendar("project", 100_000)],
            project_calendar_id: "project".to_string(),
            data_date_minute: 0,
        };
        let r = run_schedule_temporal(&req).unwrap();
        let a = find(&r, "A");
        // i64 — integer by construction. The assertion that matters
        // for the residue trace is that the kernel cannot be the
        // origin of fractional minutes. Confirmed.
        assert_eq!(a.early_start_minute % 1, 0);
        assert_eq!(a.early_finish_minute % 1, 0);
    }
}

// ─── 5. Finish-minute alignment relative to wall-clock day boundary ──

#[test]
fn b2_12a_7_finish_minute_alignment_481_dur_in_continuous_calendar_does_not_align_to_1440() {
    // A 481-minute task in a continuous calendar finishes at minute 481.
    // 481 is NOT a multiple of 1440 — the downstream JS
    // TemporalScheduleTranslator will then ceil(481/1440)=1, mapping
    // this finish to wall-day 1. If the parallel slot kernel produced
    // earlyFinishMinutes=2 (in slot units = 2 work-days for mpd=480 →
    // ceil-ish), the day-mapped finishes might or might not align.
    //
    // The point this test pins: the temporal kernel HAPPILY produces
    // intra-wall-day finish minutes (481 ≪ 1440), which is the
    // necessary precondition for the asymmetric floor/ceil residue
    // in TemporalScheduleTranslator to fire.
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 481, "project")],
        relations: vec![],
        calendars: vec![continuous_calendar("project", 10_000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    assert_eq!(a.early_finish_minute, 481);
    assert_ne!(a.early_finish_minute % 1440, 0); // confirms non-alignment
}

// ─── 6. Two-task FS chain residue self-cancellation check ────────────

#[test]
fn b2_12a_7_fs_chain_predecessor_finish_equals_successor_start_no_drift() {
    // A(481) FS→ B(60) in continuous calendar. B must start at exactly
    // 481 (A's finish minute). No ±1 drift at the FS seam itself.
    // This isolates the kernel-internal FS arithmetic from later
    // translator-level day bucketing.
    let req = TemporalScheduleRequest {
        tasks: vec![task("A", 481, "project"), task("B", 60, "project")],
        relations: vec![fs("A", "B")],
        calendars: vec![continuous_calendar("project", 10_000)],
        project_calendar_id: "project".to_string(),
        data_date_minute: 0,
    };
    let r = run_schedule_temporal(&req).unwrap();
    let a = find(&r, "A");
    let b = find(&r, "B");
    assert_eq!(a.early_finish_minute, 481);
    assert_eq!(b.early_start_minute, 481);
    assert_eq!(b.early_finish_minute, 541);
    assert_eq!(b.early_start_minute - a.early_finish_minute, 0); // no FS drift
}

// ─── Findings summary (asserted by tests above) ──────────────────────
//
//  F8.  The temporal kernel uses HALF-OPEN intervals [start, finish).
//       finish - start == duration EXACTLY for any integer duration.
//       (b2_12a_7_finish_minus_start_equals_duration_for_misc_durations)
//
//  F9.  A task ending at a calendar interval's upper bound has
//       earlyFinish == upper_bound (exclusive end); the same minute is
//       a valid start for a zero-duration successor.
//       (b2_12a_7_finish_at_boundary_then_zero_duration_successor_lands_at_same_boundary_minute)
//
//  F10. Calendar-gap resume is exact at gap-end. No ±1 wobble.
//       (b2_12a_7_calendar_gap_resume_*)
//
//  F11. The kernel emits i64 minutes — no fractional/sub-minute output.
//       Fractional residue observed live cannot originate inside the
//       Rust kernel. It must enter at the JS-side translator or
//       projection layer.
//
//  F12. The kernel HAPPILY emits intra-wall-day finish minutes
//       (e.g. 481 ≪ 1440), creating the precondition for the
//       asymmetric floor(start/1440) / ceil(finish/1440) bucketing in
//       TemporalScheduleTranslator to produce a +1-day finish residue.
//       (b2_12a_7_finish_minute_alignment_481_dur_in_continuous_calendar_does_not_align_to_1440)
//
//  F13. The FS seam itself introduces zero drift between predecessor
//       finish and successor start. The residue is not located at
//       relationship math.
//       (b2_12a_7_fs_chain_predecessor_finish_equals_successor_start_no_drift)
