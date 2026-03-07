# CPM WASM Bridge

Thin WASM/FFI bridge between TypeScript scheduling contract and Rust CPM kernel.

## Architecture

```
TypeScript (packages/protocol/kernel.ts)
    ↓ ScheduleRequest
WASM Bridge (packages/cpm-wasm)
    ↓ RawTask, RawDependency
Rust Kernel (packages/cpm-kernel)
    ↓ ScheduleResult, CpmError
WASM Bridge (packages/cpm-wasm)
    ↓ ScheduleResponse, ScheduleError
TypeScript (packages/protocol/kernel.ts)
```

## Scope

This package is a **thin boundary adapter only**:
- Accepts JS `ScheduleRequest` (via wasm-bindgen)
- Converts to Rust kernel types
- Calls `cpm_kernel::calculate_schedule`
- Maps results back to protocol-compliant response
- Returns `ScheduleResponse` or `ScheduleError`

**Does NOT include:**
- Worker integration
- UI integration
- Business logic beyond type mapping
- Runtime orchestration

## Prerequisites

Install wasm-pack:
```bash
cargo install wasm-pack
```

## Build

```bash
# Production build
pnpm build

# Development build (unoptimized, with debug info)
pnpm build:dev
```

Output will be in `pkg/` directory.

## Test

```bash
# Run WASM tests in Node.js
pnpm test

# Or use cargo directly
cargo test
```

## Usage (Future)

Once integrated into Worker:

```typescript
import init, { calculate_schedule } from 'cpm-wasm/pkg';

await init();

const request: ScheduleRequest = {
  tasks: [
    { id: 'A', duration: 3 },
    { id: 'B', duration: 5 }
  ],
  dependencies: [
    { predId: 'A', succId: 'B' }
  ]
};

const result = calculate_schedule(request);

if ('scheduleVersion' in result) {
  // Success: ScheduleResponse
  console.log(result.results);
} else {
  // Error: ScheduleError
  console.error(result.type, result.message);
}
```

## Type Mapping

### Request (TypeScript → Rust)

| TypeScript | Rust (Boundary) | Rust (Kernel) |
|------------|----------------|---------------|
| ScheduleTask { id, duration } | ScheduleTask | RawTask { id, duration } |
| ScheduleDependency { predId, succId } | ScheduleDependency | RawDependency { pred_id, succ_id } |

### Response (Rust → TypeScript)

| Rust (Kernel) | Rust (Boundary) | TypeScript |
|---------------|----------------|------------|
| ScheduleResult { task_id, early_start, early_finish } | ScheduleTaskResult | ScheduleTaskResult { taskId, earlyStart, earlyFinish } |
| Vec<ScheduleResult> | ScheduleResponse { schedule_version: 1, results } | ScheduleResponse { scheduleVersion: 1, results } |

### Errors (Rust → TypeScript)

| Rust (Kernel) | Rust (Boundary) | TypeScript |
|---------------|----------------|------------|
| CpmError::DuplicateTaskId(id) | ScheduleError::DuplicateTaskId { task_id, message } | DuplicateTaskIdError |
| CpmError::SelfDependency(id) | ScheduleError::SelfDependency { task_id, message } | SelfDependencyError |
| CpmError::TaskNotFound(id) | ScheduleError::TaskNotFound { task_id, message } | TaskNotFoundError |
| CpmError::CycleDetected | ScheduleError::CycleDetected { message } | CycleDetectedError |

## Design Principles

1. **Thin adapter only** - no business logic
2. **Protocol alignment** - matches `packages/protocol/kernel.ts` exactly
3. **Pure kernel** - `cpm-kernel` remains unchanged, no WASM dependencies
4. **Structured errors** - discriminated unions, never panic
5. **Boundary isolation** - serde types live only in cpm-wasm

## Files

- `Cargo.toml` - cdylib crate with wasm-bindgen dependencies
- `src/lib.rs` - boundary types and wasm_bindgen entry point
- `tests/wasm_tests.rs` - integration tests for all error cases
- `package.json` - npm build scripts for wasm-pack

## Version

- **Contract version:** 1
- **scheduleVersion:** 1 (hardcoded in response)
- Future versions may add backward pass, float, constraints

## References

- Rust kernel: `packages/cpm-kernel/`
- TypeScript contract: `packages/protocol/src/kernel.ts`
- Protocol docs: `docs/cpm-kernel-contract.md`
