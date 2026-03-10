# CPM Kernel Schedule Contract

## Purpose

This document defines the Worker-facing contract for the CPM (Critical Path Method) scheduling kernel. This is a **design specification only** — integration implementation is deferred to a later milestone.

## Scope

**In scope:**
- Request/response type definitions
- Error contract shapes
- Input/output data formats

**Out of scope (deferred):**
- WASM compilation
- FFI bridge implementation
- Worker runtime wiring
- UI integration
- Backward pass, float calculation
- Calendars, resource constraints, lag
- Dependency types beyond FS (Finish-to-Start)

## Architecture

```
┌─────────────┐
│   Worker    │ ← owns application state
└──────┬──────┘
       │
       │ ScheduleRequest
       ▼
┌─────────────┐
│ CPM Kernel  │ ← pure scheduling calculation
│   (Rust)    │
└──────┬──────┘
       │
       │ ScheduleResponse | ScheduleError
       ▼
┌─────────────┐
│   Worker    │ ← applies results to state
└─────────────┘
```

## Contract Design

### Input: ScheduleRequest

The Worker sends a snapshot of tasks and dependencies for scheduling.

```typescript
{
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
}
```

**Notes:**
- Task IDs are strings (matches runtime Task.id)
- Only duration is needed for scheduling (name is runtime metadata)
- Dependencies are Finish-to-Start only in v1
- Input order determines output result order

### Output: ScheduleResponse (success)

Returns early-start and early-finish times for each task in **stable input order**.

```typescript
{
  results: ScheduleTaskResult[];
}
```

**Notes:**
- Results array matches input tasks array length and order
- Result[i] corresponds to input tasks[i]
- Stable ordering simplifies Worker result mapping

### Output: ScheduleError (failure)

Returns structured error with type discriminator.

```typescript
{
  type: "DuplicateTaskId" | "SelfDependency" | "TaskNotFound" | "CycleDetected";
  taskId?: string;  // present for task-specific errors
  message: string;  // human-readable description
}
```

**Error variants:**
- `DuplicateTaskId` — same task ID appears multiple times in input
- `SelfDependency` — dependency where predId === succId
- `TaskNotFound` — dependency references non-existent task ID
- `CycleDetected` — circular dependency graph

## Data Types

### ScheduleTask

Minimal task input for scheduling calculation.

```typescript
{
  id: string;      // matches Task.id from runtime state
  duration: number; // in days (u32 in Rust)
}
```

**Design rationale:**
- Scheduler only needs ID and duration
- Name, metadata stay in Worker runtime state
- Avoids unnecessary serialization overhead

### ScheduleDependency

Finish-to-Start dependency between two tasks.

```typescript
{
  predId: string;  // predecessor task ID
  succId: string;  // successor task ID
}
```

**Design rationale:**
- v1 supports only FS dependencies
- No dependency ID needed (relationships are ephemeral for calculation)
- No type field needed until SS/FF/SF support added

### ScheduleTaskResult

Computed schedule output for one task.

```typescript
{
  taskId: string;
  earlyStart: number;  // earliest possible start time
  earlyFinish: number; // earliest possible finish time
}
```

**Design rationale:**
- Matches Rust ScheduleResult 1:1
- earlyFinish = earlyStart + duration (included for convenience)
- v1 does not include backward pass (lateStart, lateFinish, float)

## Integration Pattern (Future)

When WASM bridge is implemented:

```typescript
// Worker pseudo-code
function handleScheduleRequest() {
  const request: ScheduleRequest = {
    tasks: this.tasks.map(t => ({ id: t.id, duration: t.duration })),
    dependencies: this.dependencies.map(d => ({ predId: d.predId, succId: d.succId }))
  };

  const result = cpmKernel.calculateSchedule(request);

  if (isScheduleError(result)) {
    // handle error
  } else {
    // apply result.results to runtime state
  }
}
```

## Version Compatibility

This contract is versioned independently from the Worker protocol.

- **Contract v1:** FS dependencies only, forward pass only
- **Future v2:** May add SS/FF/SF, backward pass, float, constraints

When WASM integration is implemented, version negotiation will be handled at the FFI boundary.

## References

- Rust kernel: `packages/cpm-kernel/src/`
- Worker protocol: `packages/protocol/src/types.ts`
- Worker implementation: `packages/worker/worker.ts`
