# Track-A Milestone Note - D8 Minute-Authoritative Cutover Plan

## Status
D8 is planning/design only.

No authoritative boundary cutover is executed in this note.

## Purpose
Define the implementation-ready, architecture-safe cutover plan to migrate production scheduling authority from slot-scaled boundary semantics to minute-native boundary semantics.

This plan is atomic at the boundary level: no fake partial seam, no mixed-unit authority.

## D8 authority target
After D8 cutover, the production authoritative boundary must be minute-native end to end:
- TypeScript protocol request/result contract
- Worker authoritative request builder and engine adapter
- WASM boundary structs and entrypoint contract
- Rust authoritative request/result models
- Rust authoritative scheduling math
- Worker projection/result decoding seam

Task calendar activation remains NO-GO.
Resource calendar activation remains NO-GO.

## 1) Exact authoritative boundary fields that must migrate together

### Request fields (must migrate as one unit)
Current slot-era authoritative fields:
- ScheduleTask.durationWorkMinutes
- ScheduleTask.minEarlyStartMinutes
- ScheduleTask.constraintDateMinutes
- ScheduleDependency.lagWorkMinutes
- ScheduleRequest.nonWorkingDays

Target minute-authoritative fields:
- ScheduleTask.durationMinutes
- ScheduleTask.minEarlyStartMinutes (minute-native value)
- ScheduleTask.constraintDateMinute
- ScheduleDependency.lagMinutes
- ScheduleRequest.calendars (compiled working intervals)
- ScheduleRequest.projectCalendarId
- ScheduleRequest.dataDateMinute

Rule: duration, minEarlyStart, constraintDate, lag, and calendar skip semantics must switch together.

### Result fields (must migrate as one unit)
Current slot-era authoritative fields:
- ScheduleTaskResult.earlyStartMinutes (day-offset semantic)
- ScheduleTaskResult.earlyFinishMinutes (day-offset semantic)
- ScheduleTaskResult.lateStartMinutes (day-offset semantic)
- ScheduleTaskResult.lateFinishMinutes (day-offset semantic)
- ScheduleTaskResult.totalFloatMinutes (day-offset semantic)

Target minute-authoritative fields:
- ScheduleTaskResult.earlyStartMinute
- ScheduleTaskResult.earlyFinishMinute
- ScheduleTaskResult.lateStartMinute
- ScheduleTaskResult.lateFinishMinute
- ScheduleTaskResult.totalFloatMinutes (minute semantic)
- ScheduleTaskResult.freeFloatMinutes (minute semantic)

Rule: result decode/projection must switch in the same release as request and engine units.

## 2) Exact TypeScript protocol changes required

File family: packages/protocol/src/kernel.ts and dependent exports.

### Contract update
- Replace slot-era request types with minute-authoritative request types:
	- ScheduleTask.durationWorkMinutes -> durationMinutes
	- ScheduleTask.constraintDateMinutes -> constraintDateMinute
	- ScheduleDependency.lagWorkMinutes -> lagMinutes
	- ScheduleRequest.nonWorkingDays -> calendars + projectCalendarId + dataDateMinute
- Keep ScheduleTask.minEarlyStartMinutes name only if value semantics are explicitly minute-native and documented.
- Add request-level compiled-calendar transport type:
	- CalendarBoundary { id, intervals }
- Add per-task/per-dependency calendar IDs in authoritative request where required by kernel contract:
	- task.calendarId
	- dependency.lagCalendarId

### Response update
- Replace day-offset field names with minute-native names:
	- earlyStartMinutes -> earlyStartMinute
	- earlyFinishMinutes -> earlyFinishMinute
	- lateStartMinutes -> lateStartMinute
	- lateFinishMinutes -> lateFinishMinute
- Keep totalFloatMinutes as minute-native and add freeFloatMinutes where missing.

### ABI update
- Bump ENGINE_ABI_VERSION from 1 to 2.
- Hard-fail on mismatched abiVersion at runtime (existing gate behavior retained).

## 3) Exact Worker request-builder / translator changes required

Files impacted:
- packages/worker/src/schedule/buildScheduleRequest.ts
- packages/worker/src/schedule/SlotCoordinateTranslator.ts
- packages/worker/src/schedule/SlotEngineAdapter.ts
- packages/worker/src/schedule/MinuteEngineAdapter.ts
- packages/worker/src/temporal/temporalRequestBuilder.ts (or successor authoritative builder)

### Authoritative builder change
- Stop emitting slot-era request shape.
- Emit minute-authoritative request shape only:
	- durationMinutes
	- minEarlyStartMinutes (minute)
	- constraintDateMinute
	- lagMinutes
	- calendars
	- projectCalendarId
	- dataDateMinute

### Translator change
- Retire day-slot conversion for authoritative path.
- Authoritative translator returns minute-native values without day-slot rounding.
- Constraint-date conversion remains project-calendar-aware and minute-precise.

### Adapter change
- Switch authoritative engine adapter input path from slot request builder to minute request builder.
- Shadow comparison remains active until parity gate passes (see section 8).

## 4) Exact WASM signature changes required

File impacted: packages/cpm-wasm/src/lib.rs.

### Authoritative boundary structs
- Replace authoritative ScheduleTask boundary fields:
	- duration_work_minutes: u32 -> duration_minutes: i64
	- constraint_date_minutes: Option<i32> -> constraint_date_minute: Option<i64>
- Replace authoritative ScheduleDependency boundary fields:
	- lag_work_minutes: i32 -> lag_minutes: i64
- Replace request-level calendar skip field:
	- non_working_days: Vec<u32> -> calendars: Vec<TemporalCalendarBoundary>
	- add project_calendar_id: String
	- add data_date_minute: i64

### Authoritative response struct
- Replace day-offset names with minute-native names:
	- early_start_minutes -> early_start_minute
	- early_finish_minutes -> early_finish_minute
	- late_start_minutes -> late_start_minute
	- late_finish_minutes -> late_finish_minute
- Include free_float_minutes.

### Entrypoint contract
- Keep calculate_schedule as authoritative entrypoint name, but move it to minute-native payload contract at ABI v2.
- Keep strict abiVersion gate.

## 5) Exact Rust model/engine unit changes required

Files impacted:
- packages/cpm-kernel/src/models.rs
- packages/cpm-kernel/src/engine.rs
- packages/cpm-kernel/src/graph.rs

### Model changes
- Replace authoritative slot-era structs with minute-native authoritative structs:
	- duration_work_minutes: u32 -> duration_minutes: i64
	- lag_work_minutes: i32 -> lag_minutes: i64
	- constraint_date_minutes: Option<i32> -> Option<i64>
	- early/late start/finish fields -> i64 minute-native fields
- Align authoritative structs with temporal absolute-minute model.

### Engine math changes
- Remove day-step/non_working_days authoritative math from production path.
- Authoritative solver must run minute-native interval traversal:
	- forward snap by interval calendar
	- backward snap by interval calendar
	- advance/retreat by working minutes
	- lag application in minute units
	- float math in minute units

### Kernel invariants to preserve
- integer-only arithmetic
- no UI/domain-layer leakage
- calendar-blind at architecture boundary level (kernel consumes compiled intervals, not UI-level calendar concepts)

## 6) Exact projection/result decoding changes required

Files impacted:
- packages/worker/src/schedule/SlotScheduleTranslator.ts
- packages/worker/src/schedule/ProjectionAdapter.ts
- packages/worker/src/schedule/TemporalScheduleTranslator.ts (authoritative or merged path)

### Decode changes
- Stop decoding authoritative result coordinates as day offsets.
- Decode authoritative early/late fields as absolute-minute values.

### Projection changes
- Replace day-offset conversion path:
	- remove (dateMs - startMs) / MS_PER_DAY decode assumptions for authoritative results
	- remove float / minutesPerDay back-conversion assumptions for authoritative results
- Project minute-authoritative facts directly into downstream schedule facts/result map contract.

### Compatibility requirement
- If downstream consumers still require day-bucketed display, bucket at projection/view layer only, not at authoritative kernel boundary.

## 7) Legacy day-slot/scalar bridge components to delete after cutover

Delete after D8 cutover is stable and rollback window closes:
- packages/worker/src/schedule/SlotCoordinateTranslator.ts
- packages/worker/src/schedule/SlotEngineAdapter.ts
- packages/worker/src/schedule/SlotScheduleTranslator.ts
- packages/worker/src/schedule/buildScheduleRequest.ts (slot-era shape)
- packages/worker/src/schedule/ProjectionAdapter.ts day-offset reconversion path
- Slot-era protocol fields in packages/protocol/src/kernel.ts:
	- durationWorkMinutes
	- lagWorkMinutes
	- constraintDateMinutes
	- nonWorkingDays
	- earlyStartMinutes/earlyFinishMinutes/lateStartMinutes/lateFinishMinutes (day-offset semantics)
- Slot-era WASM boundary structs in packages/cpm-wasm/src/lib.rs
- Slot-era authoritative models/math in packages/cpm-kernel/src/models.rs and packages/cpm-kernel/src/engine.rs

Do not delete shadow/parity instrumentation until parity gate and rollback window are both complete.

## 8) Parity/shadow gate required before authority switch

Authority switch precondition: minute path must pass a formal shadow gate while slot remains primary.

### Gate mechanics
- Keep dual-run facade active:
	- primary: slot authoritative (current)
	- shadow: minute candidate
- Compare normalized schedule facts for each run.

### Required pass criteria
- Zero mismatches on critical fields for the supported D8 scope:
	- early start/finish date
	- late start/finish date
	- total float
	- critical flag
- No increase in schedule error classes (cycle, duplicate ID, missing task) vs baseline.
- Performance envelope within agreed budget:
	- p95 scheduling latency regression <= 10%
	- peak memory regression <= 15%
- Full CI green for worker, protocol, wasm, kernel test suites and typecheck.

### Scope rule
- Gate scope is project-calendar authoritative behavior only.
- Task/resource calendar semantics remain inactive and out of scope.

## 9) Rollback conditions if parity fails

Immediately block authority switch (or revert if already flipped) when any condition is true:
- Any critical-field parity mismatch appears in required gate scenarios.
- Error rate increase or new authoritative error class appears.
- ABI v2 request/response incompatibility is detected in production boundary checks.
- Latency or memory regressions exceed gate budgets.
- Data integrity anomalies appear in projection outputs (invalid ordering, negative durations where disallowed, malformed facts).

### Rollback action
- Re-enable slot path as authoritative primary.
- Keep minute path shadow-only for diagnostics.
- Preserve mismatch logs and failing fixtures as blockers for next cutover attempt.

## 10) Explicit activation no-go until post-D8 stabilization

Task calendar activation: NO-GO.

Resource calendar activation: NO-GO.

These remain blocked until:
- D8 cutover is complete,
- parity gate has passed,
- rollback window has closed,
- and a dedicated post-D8 stabilization milestone explicitly re-opens activation.

## Cutover sequence (implementation-ready)

1. Introduce ABI v2 minute-native protocol types and boundary structs (still shadow).
2. Implement minute-native authoritative builder/adapter path in worker (shadow).
3. Implement WASM + Rust authoritative minute-native contract and math behind shadow gate.
4. Run and pass parity/shadow gate criteria.
5. Flip authority: minute path primary, slot path shadow fallback.
6. Hold rollback window; monitor parity/performance/error budgets.
7. Remove slot/day-slot bridge components after stabilization.
8. Keep task/resource activation blocked until next explicit milestone.
