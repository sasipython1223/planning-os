# Track-A Milestone Note — Minute-Authoritative Migration Package

## Status
D7d is documentation/design only.

No authoritative cutover was performed in D7c.

## Purpose
Document why D7c did not switch production scheduling from slot-scaled payload authority to minute-native payload authority, and define the full migration package required for a future safe transition.

## D7c conclusion
There is no small architecture-safe authoritative cutover seam today.

The current production path is still slot-authoritative end to end:
- Worker authority still executes through the slot engine facade path
- The TypeScript request contract still presents slot-shaped request/result fields
- The WASM slot boundary still deserializes day-slot-style values
- The Rust slot models still store day-slot-style scalar values
- The Rust slot engine still performs working-day stepping against `non_working_days`
- The output/projection seam still interprets slot results as day offsets rather than literal minutes

Because those layers still agree on day-slot semantics, changing only the request payload fields would create a mixed-unit authority boundary rather than a true cutover.

## Why D7c did not perform a cutover
D7c was constrained to the smallest architecture-safe change.

That standard could not be met because the current authoritative path still depends on a coherent day-slot contract across multiple layers. A request-only minute cutover would have produced all of the following risks:
- Worker request values expressed in minute-native units
- WASM and Rust slot types still named and typed for slot/day-style values
- Rust engine math still stepping by working-day offsets rather than minute intervals
- Projection still decoding results as day offsets and re-projecting them into day-based schedule facts
- ambiguous production authority, where input semantics and execution semantics no longer match

That would violate all of the following Track-A constraints:
- no fake cutover
- no mixed-unit authority
- smallest architecture-safe change only
- preserve kernel as integer-only and calendar-blind

## Exact blocker chain

### 1. TypeScript protocol boundary
The authoritative request contract still exposes the slot-era field group:
- `ScheduleTask.durationWorkMinutes`
- `ScheduleTask.minEarlyStartMinutes`
- `ScheduleTask.constraintDateMinutes`
- `ScheduleDependency.lagWorkMinutes`
- `ScheduleRequest.nonWorkingDays`
- `ScheduleTaskResult.earlyStartMinutes`
- `ScheduleTaskResult.earlyFinishMinutes`
- `ScheduleTaskResult.lateStartMinutes`
- `ScheduleTaskResult.lateFinishMinutes`
- `ScheduleTaskResult.totalFloatMinutes`

These names are tolerated today because the authoritative slot path still interprets them as day-slot-style quantities, not literal minute-native execution values.

### 2. Worker request builder
The Worker request builder is translator-driven, but it still emits the same authoritative slot request shape.

That means the Worker can translate canonical values, but it cannot safely become minute-authoritative while the downstream contract remains slot-authoritative.

The critical request-side field group still moves together through the same shape:
- task duration
- task minEarlyStart
- task constraint date
- dependency lag
- project nonWorkingDays contract

### 3. WASM boundary
The authoritative WASM entry point is still the slot boundary.

It still deserializes:
- `duration_work_minutes: u32`
- `min_early_start_minutes: u32`
- `constraint_date_minutes: Option<i32>`
- `lag_work_minutes: i32`
- `non_working_days: Vec<u32>`

and still routes them to `calculate_schedule`.

That means the production ABI is still the slot ABI, even if the Worker were to begin sending minute-like values.

### 4. Rust models
The authoritative Rust slot structs are still:
- `RawTask.duration_work_minutes: u32`
- `RawTask.min_early_start_minutes: u32`
- `RawTask.constraint_date_minutes: Option<i32>`
- `RawDependency.lag_work_minutes: i32`
- `ScheduleResult.*: u32/i32`

The minute-native temporal structs exist in parallel, but they are not the current authoritative production contract.

### 5. Rust engine math
The decisive blocker is in the slot engine math itself.

The current authoritative kernel still:
- snaps forward/backward by blocked day index
- advances and retreats by working-day counts
- applies lag by stepping across working-day offsets
- computes float as working-day distance between offsets
- accepts `non_working_days` as day-offset blockers

This is not a minute-native execution model. It is a working-day stepping model with integer day-slot semantics.

Because of that, sending minute-native request scalars into this engine would not create minute-authoritative scheduling. It would only reinterpret minute values as if they were day-slot counts.

### 6. Output/projection seam
The authoritative slot output seam still assumes day-offset results:
- slot translator converts result coordinates by multiplying day offsets by `MS_PER_DAY`
- projection converts normalized facts back into day-offset `ScheduleResultMap` values

So even if request values changed, the production result path would still remain day-offset based unless the result contract and projection seam migrated with it.

## Field groups that must migrate together

### Group A — authoritative request scalars
These cannot be partially cut over:
- duration
- minEarlyStart
- constraintDate
- lag

Reason:
they participate together in the same request contract and are consumed together by the same engine math. Switching only one or two would create inconsistent execution semantics inside the authoritative solver.

### Group B — authoritative calendar skip contract
This cannot remain slot-era if Group A becomes minute-native:
- nonWorkingDays

Reason:
the current slot engine uses day-offset blocking. A minute-native request model cannot truthfully remain anchored to day-offset skip semantics without preserving slot authority.

### Group C — authoritative result scalars
These must migrate with authoritative execution:
- earlyStart
- earlyFinish
- lateStart
- lateFinish
- totalFloat

Reason:
the projection seam currently decodes them as day offsets. If the request became minute-native while results remained slot-decoded, production authority would still be semantically hybrid.

## Why request-only cutover would create mixed-unit authority
A request-only cutover would mean:
- the Worker claims authoritative minute-native input semantics
- the WASM and Rust slot path still deserialize slot-era scalar fields
- the slot engine still executes day-slot stepping logic
- the projection layer still decodes output as day offsets

That is not a cutover.

That is a mixed-unit pipeline where:
- request semantics say minutes
- execution semantics still say working-day slots
- result semantics still say day offsets

Under Track-A rules, that would be misleading architecture and must remain a no-go.

## Future option 1 — Full slot-boundary unit migration
This option preserves the current slot engine as the authoritative engine family, but migrates its full contract from day-slot-style semantics to minute-native semantics.

Required migration package:
- TypeScript protocol request/result contract migration
- Worker authoritative request builder migration
- WASM slot ABI migration
- Rust slot model migration
- Rust slot engine math rewrite from day-stepping to minute-stepping against an integer-only boundary contract
- Output/projection seam migration so production results are no longer decoded as day offsets

Required properties:
- integer-only preserved
- kernel calendar-blindness preserved
- no task/resource calendar activation during the rewrite
- no partial request-only rollout

Meaning:
this is a true slot-engine contract rewrite, not a narrow boundary edit.

## Future option 2 — Authoritative switch to a minute-native engine
This option retires the slot engine from authority and promotes a minute-native engine to production authority.

Required migration package:
- complete the minute-native engine boundary as the production request/result contract
- make the Worker authoritative on the minute-native engine path
- replace the authoritative projection/result seam so output is derived from minute-native results
- preserve integer-only kernel behavior
- preserve kernel calendar-blindness at the boundary contract level

Meaning:
this is not a request-shape edit. It is an authority switch.

This option may be cleaner than rewriting the slot engine semantics in place, but it is still a larger milestone than D7c.

## Task/resource calendar activation rule
Task calendar activation remains NO-GO.

Resource calendar activation remains NO-GO.

Those features must stay inactive until one of the following is complete:
- full slot-boundary unit migration
- authoritative switch to a minute-native engine

Reason:
activating richer calendar semantics before authoritative minute-native execution exists would reintroduce the exact mixed-unit authority problem identified in D7c.

## Production authority truth at the end of D7c
- authoritative production scheduling still runs on the slot path
- minute payload preparation remains shadow/preparatory only
- temporal/minute-native execution remains non-authoritative

## D7d design rule
Do not attempt a request-only authoritative cutover.

The next implementation milestone must explicitly choose one of the two coherent migration packages above and carry it through request contract, kernel contract, execution semantics, and projection semantics together.