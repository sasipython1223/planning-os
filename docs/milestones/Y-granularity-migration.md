# Phase Y — Granularity Migration: Integer Days → Integer Minutes

**Status:** Draft Architecture Specification
**Depends on:** Phase X (Extension Metadata) — provides the `projectMetadata` store and schema-version infrastructure this migration requires.
**Blocked by:** Nothing after Phase X completes.

---

## 1. Migration Objective

Replace the current integer-day time model with an **integer-minute** time model across the entire scheduling pipeline. Every duration, lag, constraint date offset, schedule result, calendar slot, histogram bucket, variance delta, and persisted value that currently represents "working days" will represent "working minutes" after migration.

**Why minutes, not hours or seconds:**

| Granularity | Resolution for 1-day task (480 min) | Overflow at u32 max | Practical horizon |
|-------------|--------------------------------------|----------------------|-------------------|
| Days        | 1 value                              | 11.7M years          | ∞                 |
| Hours       | 8 values                             | 489K years           | ∞                 |
| **Minutes** | **480 values**                       | **8,171 years**      | **> durability goal** |
| Seconds     | 28,800 values                        | 136 years            | borderline        |

Minutes provide sub-hour scheduling fidelity (lag = 30 minutes, duration = 90 minutes) without risking u32 overflow within the 10–20 year durability window. Seconds would require u64 in the kernel or accept a dangerously small horizon. Minutes are the Goldilocks unit.

**Non-goals:**
- No floating-point time math. Every value stays integer.
- No sub-minute resolution. Minutes are the atomic quantum.
- No time-of-day modeling. Minutes are elapsed working minutes from project start, not clock time.
- No UI changes beyond consuming the new unit. UI remains projection-only.

---

## 2. Scope Boundaries

### In scope
- Protocol canonical types (`Task.duration`, `Dependency.lag`, constraint offsets, schedule results)
- Rust kernel (`RawTask`, `RawDependency`, `ScheduleResult`, `engine.rs` math, `graph.rs` storage)
- WASM bridge (`cpm-wasm/src/lib.rs` boundary structs)
- Worker compiler/schedule bridge (`buildScheduleRequest.ts`, `applyScheduleResult.ts`)
- Worker calendar (`calendar.ts` — working-minute slots instead of working-day slots)
- Worker histogram (`resourceHistogram.ts` — minute buckets)
- Worker variance (`variance.ts` — minute deltas)
- Worker rollup summaries (`rollupSummaries.ts` — min/max minute offsets)
- Import mappers (`xerMapper.ts`, `mspMapper.ts` — convert source hours/minutes directly to minutes)
- Persistence schema (v1 → v2 migration)
- UI date projection (`dateProjection.ts` — minute-offset → calendar date)
- All existing tests

### Out of scope
- Calendar structure (remains a single project-level calendar; hierarchical calendars are Phase Z)
- Resource leveling
- Cost model
- Actual dates / percent complete
- UI layout, styling, or interaction patterns
- Kernel algorithm changes (CPM logic is unchanged; only the unit of the numbers changes)

---

## 3. Canonical Model Changes

### 3.1 New constant: single source of truth

```typescript
// packages/protocol/src/timeUnits.ts (NEW)

/**
 * Canonical working minutes in one standard working day.
 *
 * This is the SINGLE constant that bridges "days" (human concept)
 * and "minutes" (scheduling quantum). Every conversion between
 * days and minutes in the entire codebase MUST reference this
 * constant — no magic 480s, no local MINUTES_PER_DAY variables.
 *
 * When hierarchical calendars arrive (Phase Z), project-specific
 * minutesPerDay will override this default. Until then, this is
 * the canonical value.
 */
export const DEFAULT_MINUTES_PER_DAY = 480; // 8 hours × 60 minutes
```

**Rationale:** A single exported constant prevents scattered `480` literals and ensures grep-ability. Import mappers, persistence migration, and the UI projection all import from this one location.

### 3.2 Protocol type changes

**`packages/protocol/src/types.ts`:**

| Field | Current | After |
|-------|---------|-------|
| `Task.duration` | integer days | integer minutes |
| `Dependency.lag` | integer days | integer minutes |
| `Task.constraintDate` | day-offset from project start | **minute-offset** from project start |
| `Task.minEarlyStart` | day-offset | minute-offset |

**`packages/protocol/src/kernel.ts`:**

| Field | Current | After |
|-------|---------|-------|
| `ScheduleTask.duration` | days | minutes |
| `ScheduleTask.minEarlyStart` | day-offset | minute-offset |
| `ScheduleTask.constraintDate` | day-offset | minute-offset |
| `ScheduleDependency.lag` | days | minutes |
| `ScheduleRequest.nonWorkingDays` | `number[]` day-offsets | **Rename field** — see §3.3 |
| `ScheduleTaskResult.earlyStart` | day-offset | minute-offset |
| `ScheduleTaskResult.earlyFinish` | day-offset | minute-offset |
| `ScheduleTaskResult.lateStart` | day-offset | minute-offset |
| `ScheduleTaskResult.lateFinish` | day-offset | minute-offset |
| `ScheduleTaskResult.totalFloat` | days | minutes |

**`packages/protocol/src/domain.ts`:**

| Field | Current | After |
|-------|---------|-------|
| `FixedDurationStrategy.durationDays` | days | **Rename to `durationMinutes`** |
| `ManualOverrideStrategy.durationDays` | days | **Rename to `durationMinutes`** |
| `Resource.maxUnitsPerDay` | per-day | **Keep unit as-is** (capacity per working day, not per minute — human-meaningful) |
| `Assignment.unitsPerDay` | per-day | **Keep unit as-is** |

**`packages/protocol/src/activities.ts`:**

| Field | Current | After |
|-------|---------|-------|
| `GeneratedActivity.durationDays` | days | **Rename to `durationMinutes`** |
| `GeneratedDependency.lagDays` | days | **Rename to `lagMinutes`** |
| `AuthoredDependencyLink.lagDays` | days | **Rename to `lagMinutes`** |

### 3.3 Calendar contract change

Current: `nonWorkingDays: readonly number[]` — array of blocked day-offsets.

After migration, non-working time is expressed as **blocked minute-ranges**:

```typescript
// Option A (recommended): keep day-based blocked list, kernel multiplies internally
nonWorkingDays: readonly number[];       // blocked DAY indices (unchanged shape)
minutesPerDay: number;                   // NEW — kernel uses this to expand to minute slots

// Option B: full minute-resolution blocked ranges
nonWorkingSlots: readonly [number, number][]; // [startMinute, endMinute) pairs
```

**Recommendation: Option A.** The calendar model is day-level until Phase Z (hierarchical calendars). Passing `nonWorkingDays` + `minutesPerDay` to the kernel lets it internally convert day-offsets to minute-ranges without exploding the JSON payload size. The kernel converts on receipt:

```
blocked_day 3 with minutesPerDay=480
→ blocked minutes [1440, 1920)     // 3×480 to 4×480
```

This keeps the calendar contract nearly unchanged (one new field) and avoids sending 480× more data over the WASM bridge.

---

## 4. Kernel Input / ABI Changes

### 4.1 Rust model changes (`cpm-kernel/src/models.rs`)

```rust
pub struct RawTask {
    pub duration: u32,              // MINUTES (was days)
    pub min_early_start: u32,       // minute-offset (was day-offset)
    pub constraint_date: Option<i32>, // minute-offset (was day-offset, signed for before-start)
}

pub struct RawDependency {
    pub lag: i32,                   // MINUTES (was days, stays i32 for negative lag)
    pub dep_type: DepType,
}

pub struct ScheduleResult {
    pub early_start: u32,           // minute-offset
    pub early_finish: u32,          // minute-offset
    pub late_start: u32,            // minute-offset
    pub late_finish: u32,           // minute-offset
    pub total_float: i32,           // minutes (stays i32 for negative float)
}
```

**No type changes** — `u32` and `i32` are sufficient for minutes at any practical horizon.

### 4.2 Engine changes (`cpm-kernel/src/engine.rs`)

The core CPM functions (`snap_forward`, `advance_working`, `snap_backward`, `retreat_working`, `step_forward_lag`, `step_backward_lag`, `count_working_days_signed`) currently operate on day-slot arithmetic:

```rust
// Current: advance by 1 working day per loop iteration
fn advance_working(start: u32, duration: u32, blocked: &HashSet<u32>) -> u32 {
    let mut pos = start;
    let mut remaining = duration;
    while remaining > 0 {
        if !blocked.contains(&pos) { remaining -= 1; }
        if remaining > 0 { pos += 1; }
    }
    pos
}
```

After migration, the engine works at **day granularity internally but tracks minute positions**:

```rust
/// New field passed to engine alongside blocked days
minutes_per_day: u32,

/// advance_working now consumes `duration` working minutes
/// by stepping through day slots, each worth `minutes_per_day` minutes.
fn advance_working(start: u32, duration: u32, blocked: &HashSet<u32>, mpd: u32) -> u32 {
    let mut pos = start;                     // minute-offset
    let mut remaining = duration;            // working minutes remaining
    while remaining > 0 {
        let current_day = pos / mpd;         // which day are we in?
        if blocked.contains(&current_day) {
            pos = (current_day + 1) * mpd;   // skip to start of next day
            continue;
        }
        let minutes_left_in_day = (current_day + 1) * mpd - pos;
        let consume = remaining.min(minutes_left_in_day);
        remaining -= consume;
        pos += consume;
    }
    pos
}
```

**Key invariant:** No per-minute iteration. The engine steps in **day-sized chunks** when possible, consuming `min(remaining, minutes_left_in_day)` per step. This maintains O(days) performance, not O(minutes). If a 240-day project has 480 MPD, the engine iterates ~240 times (days), not ~115,200 times (minutes).

### 4.3 WASM bridge changes (`cpm-wasm/src/lib.rs`)

Add `minutes_per_day: u32` to the deserialized `ScheduleRequest` struct. Pass through to engine:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmScheduleRequest {
    tasks: Vec<ScheduleTask>,
    dependencies: Vec<ScheduleDependency>,
    non_working_days: Vec<u32>,
    minutes_per_day: u32,           // NEW
}
```

---

## 5. Worker Compiler Changes

### 5.1 `buildScheduleRequest.ts`

Currently passes `task.duration` and `dep.lag` as-is. After migration, values are already in minutes (canonical model is minutes), so **this file requires no conversion logic** — it remains a transparent mapper:

```typescript
const scheduleTasks: ScheduleTask[] = tasks.map(task => ({
  id: task.id,
  duration: task.duration,             // already minutes
  minEarlyStart: task.minEarlyStart ?? 0, // already minute-offset
  // ... constraints already minute-offset
}));
```

The only addition: pass `minutesPerDay` from project metadata into the request:

```typescript
return {
  tasks: scheduleTasks,
  dependencies: scheduleDependencies,
  nonWorkingDays,
  minutesPerDay,  // NEW — from Extension Metadata (Phase X)
};
```

### 5.2 `calendar.ts`

Currently returns `number[]` of blocked day-offsets. This **stays unchanged** — the kernel receives day-indices and expands internally. The calendar module does not need to enumerate minute slots.

### 5.3 `resourceHistogram.ts`

Currently iterates `for (let day = earlyStart; day < earlyFinish; day++)` and checks `nonWorkingDays.has(day)`.

After migration, `earlyStart` and `earlyFinish` are minute-offsets. The histogram must bucket by **working day**, not by minute:

```typescript
for (let day = Math.floor(earlyStart / minutesPerDay);
     day < Math.ceil(earlyFinish / minutesPerDay);
     day++) {
  if (!nonWorkingDays.has(day)) {
    // Compute fractional overlap of this task within the day
    const dayStartMin = day * minutesPerDay;
    const dayEndMin = (day + 1) * minutesPerDay;
    const overlapStart = Math.max(earlyStart, dayStartMin);
    const overlapEnd = Math.min(earlyFinish, dayEndMin);
    const fractionOfDay = (overlapEnd - overlapStart) / minutesPerDay;
    histogram[a.resourceId][day] =
      (histogram[a.resourceId][day] || 0) + a.unitsPerDay * fractionOfDay;
  }
}
```

**Note:** `fractionOfDay` is the only place where division occurs, and it produces a resource-loading ratio (not a time value), so floating point is acceptable here. Alternatively, keep integer `overlapMinutes` and defer ratio to display.

### 5.4 `variance.ts`

No logic change. Subtractions of minute-offsets produce minute deltas. The variance values change unit (days → minutes) but the code is unit-agnostic:

```typescript
startVariance: live.earlyStart - base.start,  // was day-delta, now minute-delta
```

### 5.5 `rollupSummaries.ts`

No logic change. `min(earlyStart)` and `max(earlyFinish)` are unit-agnostic.

---

## 6. Import Mapper Changes

This is where the migration delivers its primary benefit: **no more rounding to days**.

### 6.1 XER Mapper (`xerMapper.ts`)

**Current** (lossy):
```typescript
const rawDuration = parseFloat(xt.target_drtn_hr_cnt || "0") / hoursPerDay;
const duration = Math.max(1, Math.round(rawDuration));  // round to nearest day!
```

**After** (lossless for integer hours):
```typescript
const rawHours = parseFloat(xt.target_drtn_hr_cnt || "0");
const duration = Math.max(minutesPerDay, Math.round(rawHours * 60));
// 12 hours → 720 minutes. No rounding loss.
// Minimum duration = 1 working day (minutesPerDay) for non-summary tasks.
```

**Lag** (currently lossy):
```typescript
const rawLag = parseFloat(xp.lag_hr_cnt || "0") / hoursPerDay;
const lag = Math.round(rawLag);  // round to day!
```

**After:**
```typescript
const lagMinutes = Math.round(parseFloat(xp.lag_hr_cnt || "0") * 60);
// 4 hours lag → 240 minutes. Exact.
```

**Constraint dates:**
```typescript
// Current: day-offset = (cstrMs - projectStartMs) / MS_PER_DAY
// After:   minute-offset = day-offset * minutesPerDay
const dayOffset = Math.round((cstrMs - projectStartMs) / MS_PER_DAY);
const constraintDate = dayOffset * minutesPerDay; // start-of-day, minute precision
```

### 6.2 MSP XML Mapper (`mspMapper.ts`)

**Current** (lossy):
```typescript
const rawHours = parseIso8601DurationHours(mt.duration);
const rawDays = rawHours / hoursPerDay;
const duration = Math.max(1, Math.round(rawDays));
```

**After** (lossless for integer hours):
```typescript
const rawHours = parseIso8601DurationHours(mt.duration);
const duration = Math.max(minutesPerDay, Math.round(rawHours * 60));
```

**Lag:**
```typescript
// Current: tenths-of-minutes → days (lossy)
const lagTenthsOfMinutes = parseInt(link.linkLag || "0", 10);
const lagMinutes = lagTenthsOfMinutes / 10;
const lagDays = lagMinutes / (hoursPerDay * 60);
const lag = Math.round(lagDays);

// After: tenths-of-minutes → minutes (nearly lossless)
const lagTenthsOfMinutes = parseInt(link.linkLag || "0", 10);
const lag = Math.round(lagTenthsOfMinutes / 10);
// 4800 tenths = 480 minutes = exactly 1 day. No loss.
```

### 6.3 Diagnostic code changes

`DURATION_FRACTIONAL_ROUNDED` and `LAG_FRACTIONAL_ROUNDED` become much rarer — they only trigger when the source value has sub-minute precision (uncommon). The codes remain valid but fire less frequently, which is the whole point of the migration.

---

## 7. Backward Compatibility / Hydration Strategy

### 7.1 Persistence schema version

**Current:** `CURRENT_SCHEMA_VERSION = 1`, no time-unit metadata.

**After:** `CURRENT_SCHEMA_VERSION = 2`. The migration function in `persistence.ts`:

```typescript
function migrateV1toV2(persisted: PersistedStateV1): PersistedStateV2 {
  const mpd = DEFAULT_MINUTES_PER_DAY; // 480

  return {
    version: 2,
    state: {
      ...persisted.state,
      tasks: persisted.state.tasks.map(t => ({
        ...t,
        duration: t.duration * mpd,
        constraintDate: t.constraintDate != null ? t.constraintDate * mpd : t.constraintDate,
        minEarlyStart: (t.minEarlyStart ?? 0) * mpd,
      })),
      dependencies: persisted.state.dependencies.map(d => ({
        ...d,
        lag: d.lag * mpd,
      })),
      baselines: migrateBaselines(persisted.state.baselines, mpd),
    },
  };
}

function migrateBaselines(baselines: BaselineMap, mpd: number): BaselineMap {
  const migrated: BaselineMap = {};
  for (const [taskId, entry] of Object.entries(baselines)) {
    migrated[taskId] = {
      start: entry.start * mpd,
      finish: entry.finish * mpd,
    };
  }
  return migrated;
}
```

**Properties:**
- **Deterministic:** `integer × 480 = integer`. No floating point.
- **Reversible:** Division by 480 recovers original if needed (for rollback).
- **Silent data loss prevention:** The migration runs on hydration; if the version is already 2, no-op.
- **Phase X dependency:** Extension Metadata (Phase X) stores `minutesPerDay` per project. The migration uses `DEFAULT_MINUTES_PER_DAY` because v1 data was always 8-hour-day.

### 7.2 Schedule result cache

Schedule results are not persisted — they are recomputed on every scheduling pass. No migration needed for cached results.

### 7.3 Undo/redo history

The undo history holds snapshots with day-based values. On migration:
- **Option A (recommended):** Clear undo history on schema migration. Undo across a unit change is semantically unsound — the pre-migration snapshot would have day values mixed into a minute-based engine.
- **Option B:** Migrate all snapshots in the history stack. Complex and fragile for marginal benefit.

---

## 8. Test Migration Strategy

### 8.1 Mechanical test update

Every test that asserts a numeric duration, lag, constraint offset, or schedule result must be updated. The transformation is mechanical:

```
old_value_days × DEFAULT_MINUTES_PER_DAY = new_value_minutes
```

Example:
```typescript
// Before
expect(task.duration).toBe(5);           // 5 days
expect(dep.lag).toBe(2);                 // 2 days
expect(result.earlyStart).toBe(0);       // day 0 (unchanged — 0 × 480 = 0)
expect(result.earlyFinish).toBe(5);      // day 5

// After
expect(task.duration).toBe(2400);        // 5 × 480 = 2400 minutes
expect(dep.lag).toBe(960);              // 2 × 480
expect(result.earlyStart).toBe(0);       // minute 0
expect(result.earlyFinish).toBe(2400);   // minute 2400
```

### 8.2 New sub-day tests

Add tests that exercise sub-day precision (the whole point):
- Duration of 240 minutes (half day)
- Lag of 120 minutes (quarter day)
- Constraint at minute-offset 720 (start of day 1, noon of day 0? — depends on calendar)
- Import of XER with 4-hour task → 240 minutes (no rounding diagnostic)
- Import of MSP with PT2H30M → 150 minutes (no rounding diagnostic)

### 8.3 Persistence migration test

```typescript
it("should migrate v1 day-based data to v2 minute-based data", () => {
  const v1: PersistedState = {
    version: 1,
    state: {
      tasks: [{ id: "t1", duration: 5, constraintDate: 10 }],
      dependencies: [{ id: "d1", lag: 2 }],
      baselines: { t1: { start: 0, finish: 5 } },
    },
  };
  const v2 = migratePersistedState(v1);
  expect(v2.version).toBe(2);
  expect(v2.state.tasks[0].duration).toBe(2400);
  expect(v2.state.tasks[0].constraintDate).toBe(4800);
  expect(v2.state.dependencies[0].lag).toBe(960);
  expect(v2.state.baselines.t1.start).toBe(0);
  expect(v2.state.baselines.t1.finish).toBe(2400);
});
```

### 8.4 Kernel regression tests

All existing `cpm_tests.rs` and `wasm_tests.rs` must pass with values × 480. Add a new test with sub-day durations to verify the engine handles non-day-multiple values correctly:

```rust
#[test]
fn sub_day_duration_schedules_correctly() {
    // Task A: 240 min, Task B: 720 min, A→B FS lag=0
    // With 480 mpd and no blocked days:
    //   A: ES=0, EF=240
    //   B: ES=240, EF=960
    // ...
}
```

---

## 9. Risks and Rollback Plan

### 9.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scattered `×480` / `÷480` conversions | Medium | High — inconsistency bugs | Single constant in `protocol/timeUnits.ts`; lint rule forbidding literal `480` |
| Kernel performance regression (larger numbers) | Low | Low — u32 math is same speed | Benchmark before/after; engine loops by day, not minute |
| Persistence migration data loss | Low | Critical | Version gate; v1→v2 is `×480` (exact integer); migration test coverage |
| Undo history corruption | Medium | Medium | Clear history on migration (recommended) |
| UI displays raw minutes to user | Low | Medium — confusing UX | UI date projection divides by `minutesPerDay` for display; test coverage |
| Import mapper off-by-one | Medium | Medium — wrong durations | Every existing import test updated mechanically + new sub-day tests |
| Phase Z (calendars) compatibility | Low | Low — minutes are calendar-ready | Calendar interface already designed for day-index + minutesPerDay expansion |

### 9.2 Rollback plan

1. **Schema rollback:** If v2 persistence is deployed and needs rollback, `migrateV2toV1` divides by `DEFAULT_MINUTES_PER_DAY`. Since all v1 values were multiplied by 480, this is exact. Add the reverse migration function proactively.
2. **Kernel rollback:** Revert Rust code, rebuild WASM. Kernel is pure, no state.
3. **Worker rollback:** Revert TypeScript, bump schema back. Persistence migration handles the revert.
4. **Data safety:** No data is destroyed — multiplication by 480 is reversible for all integers that were originally day-based.

---

## 10. Recommended Implementation Sequence

### Phase Y.1 — Protocol + Constant (smallest, safest first)

**Scope:** Add `timeUnits.ts` with `DEFAULT_MINUTES_PER_DAY`. Rename `durationDays` → `durationMinutes`, `lagDays` → `lagMinutes` in protocol types. Update TSDoc for all affected fields. No runtime behavior change yet — values still hold days at this point.

**Files:** `protocol/src/timeUnits.ts` (new), `protocol/src/types.ts`, `protocol/src/domain.ts`, `protocol/src/activities.ts`, `protocol/src/kernel.ts`.

**Tests:** Protocol compilation + existing tests still pass (rename only).

### Phase Y.2 — Kernel migration (isolated, testable)

**Scope:** Update `models.rs` field comments to say "minutes". Add `minutes_per_day: u32` parameter to engine functions. Update `engine.rs` to step by day-chunks consuming minutes (see §4.2). Update `graph.rs` accordingly. Update `lib.rs` WASM bridge to accept `minutesPerDay`.

**Files:** `cpm-kernel/src/models.rs`, `cpm-kernel/src/engine.rs`, `cpm-kernel/src/graph.rs`, `cpm-wasm/src/lib.rs`.

**Tests:** All `cpm_tests.rs` and `wasm_tests.rs` updated to pass minute values. New sub-day kernel tests. Run `cargo test` in isolation before touching TypeScript.

### Phase Y.3 — Worker bridge + state migration

**Scope:** Update `buildScheduleRequest.ts` to pass `minutesPerDay`. Update `persistence.ts` with v1→v2 migration. Update `state.ts` types (documentation only — `number` stays `number`). Convert canonical state values from days to minutes on startup (migration). Clear undo history on migration.

**Files:** `worker/src/schedule/buildScheduleRequest.ts`, `worker/src/persistence.ts`, `worker/src/state.ts`, `worker/src/history.ts`.

**Tests:** Persistence migration test. `buildScheduleRequest` test with minute values. Integration: v1 data → hydrate → schedule → correct minute-based results.

### Phase Y.4 — Import mapper migration

**Scope:** Update `xerMapper.ts` and `mspMapper.ts` to emit minutes instead of days. Update `DURATION_FRACTIONAL_ROUNDED` / `LAG_FRACTIONAL_ROUNDED` thresholds (round to nearest minute, not nearest day). Update import orchestrator tests.

**Files:** `worker/src/import/mappers/xerMapper.ts`, `worker/src/import/mappers/mspMapper.ts`, `worker/tests/import/` (all mapper + orchestrator tests).

**Tests:** All existing import tests updated mechanically (×480). New sub-day import tests showing reduced rounding.

### Phase Y.5 — Worker modules + UI projection

**Scope:** Update `calendar.ts` (if any interface change needed for `minutesPerDay` pass-through). Update `resourceHistogram.ts` to bucket by day from minute-offsets. Update `variance.ts` (documentation only). Update `dateProjection.ts` in UI to convert minute-offsets to calendar dates.

**Files:** `worker/src/calendar.ts`, `worker/src/resourceHistogram.ts`, `worker/src/variance.ts`, `worker/src/rollupSummaries.ts`, `apps/web/src/utils/dateProjection.ts`.

**Tests:** Histogram test with minute-based schedule results. Variance test. Date projection test (`minute 2400 with 480 mpd → day 5 → calendar date`).

### Phase Y.6 — Full integration + cleanup

**Scope:** End-to-end integration test: import MSP XML → preview → commit → schedule → Gantt renders with correct dates. Verify no literal `480` outside `timeUnits.ts`. Remove any transitional compatibility code. Tag milestone.

**Files:** Integration tests, grep-based audit.

**Tests:** E2E. `grep -r "480" --include="*.ts" --include="*.rs"` must return only `timeUnits.ts` and comments.

---

## Appendix A — Conversion Avoidance Strategy

The key design principle: **conversion happens at boundaries only, never in core logic.**

```
┌─────────────┐   hours/tenths  ┌──────────┐  minutes  ┌─────────┐  minutes  ┌────────┐
│ External     │ ──────────────→ │ Import   │ ────────→ │ Worker  │ ────────→ │ Kernel │
│ File (XER/   │                 │ Mapper   │           │ State   │           │ (Rust) │
│ MSP XML)     │                 └──────────┘           └─────────┘           └────────┘
└─────────────┘                     ↑ CONVERT               │ pass-through        │
                                    │ hours→min             │                     │
                               only boundary              minutes              minutes
                                                            │                     │
                                                            ↓                     ↓
                                                      ┌───────────┐         ┌───────────┐
                                                      │Persistence│         │ Schedule  │
                                                      │(IndexedDB)│         │ Results   │
                                                      └───────────┘         └───────────┘
                                                         minutes               minutes
                                                                                  │
                                                                                  ↓
                                                      ┌───────────────┐    min→date
                                                      │ UI Projection │ ←─────────
                                                      │ (dateProject) │   CONVERT
                                                      └───────────────┘   only boundary
```

**Boundaries where conversion exists:**
1. **Import mappers** — source format → canonical minutes (one-time, at import)
2. **Persistence migration** — v1 days → v2 minutes (one-time, at hydration)
3. **UI date projection** — minute-offset → calendar date (read-only, on render)
4. **User-facing display** — minutes → "X days Y hours" (UI formatting, Phase X metadata provides `minutesPerDay`)

**Everything between boundaries is pure minutes. No intermediate conversions.**

---

## Appendix B — Why Not "Tagged Union" or "Unit-Aware Types"

A tagged-union approach (`{ value: number, unit: "days" | "minutes" }`) was considered and rejected:

1. **Kernel ABI:** Rust kernel uses `u32`/`i32`. Adding a unit tag to every field doubles struct size and complicates the WASM boundary for zero runtime benefit.
2. **Performance:** Every arithmetic operation would need to assert matching units — pure overhead in a hot scheduling loop.
3. **Complexity:** The codebase is small and focused. A single canonical unit with conversions only at boundaries is simpler, faster, and easier to audit than unit-aware wrapper types.
4. **Durability:** If the unit ever changes again (unlikely), the same boundary-conversion strategy applies — migrate at persistence, convert at import, project at display.

The single-unit-throughout approach is the right call for a 10–20 year system where simplicity and auditability outweigh type-system cleverness.
