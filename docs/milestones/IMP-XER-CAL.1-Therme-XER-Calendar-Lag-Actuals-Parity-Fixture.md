# IMP-XER-CAL.1 Therme XER Calendar/Lag/Actuals Parity Fixture Plan

## Purpose
Create a stable fixture definition for the XER file `20260506 Theme Adv work Proposed Baseline Program.xer` so future real Worker + real WASM parity work can validate calendar and lag fidelity without claiming full P6 equivalence.

## Known Fixture Facts
- Calendar ID: `6726`
- Calendar name: `TPID Calender _ 6 working days with PH`
- Working days: Monday-Saturday
- Sunday: non-working
- Working intervals: `08:00-12:00` and `13:00-17:00`
- Hours/day: `8`
- Hours/week: `48`
- Exception dates: preserved from source
- Activities with `TASK.clndr_id = 6726`: `67`
- `SCHEDOPTIONS.sched_calendar_on_relationship_lag = rcal_Predecessor`
- Data/recalc date: `01-Apr-2026 08:00`
- Project must-finish-by (`scd_end_date`): `30-Sep-2026 08:00`
- Relationship lags include positive and negative values (including `-40h`)
- Constraints include `CS_MEO` and `CS_MSOA`
- UDFs: preserved as custom fields

## Golden Test Plan (Design Only)
1. Parse calendar `6726` as Mon-Sat working.
2. Parse daily intervals `08:00-12:00` and `13:00-17:00`.
3. Parse preserved holiday/exception dates.
4. Validate calendar math: add `40h` from `01-Apr-2026 08:00` equals `07-Apr-2026 17:00`.
5. Validate calendar math: add `80h` from `01-Apr-2026 08:00` equals `13-Apr-2026 17:00`.
6. Preserve `TASK.clndr_id = 6726` on all expected activities.
7. Preserve `lag_hr_cnt` in minutes including `-40h = -2400` minutes.
8. Preserve lag calendar option `rcal_Predecessor` as metadata.
9. Preserve actuals and remaining duration metadata.
10. Preserve constraints as metadata-first (`CS_MEO`, `CS_MSOA`).
11. Preserve source early/late and float values separately from planner-calculated values.
12. Treat WBS rows as structural rollups, not TASK rows.

## Scope Boundaries
- This plan does not implement full engine parity tests yet.
- This plan does not enable lag calendar semantics in slot scheduling.
- This plan does not enable resource calendar scheduling parity.
- This plan does not claim P6-equivalent recalculation.

## Execution Sequencing (Future)
1. Parser and mapper fixture assertions.
2. View-model fidelity assertions.
3. Real Worker integration assertions.
4. Real WASM parity validation (separate W5B-B2.3 track).
