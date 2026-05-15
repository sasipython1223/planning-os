# W5B-B2.12A.10 — ProjectionAdapter Output Contract Audit

## 1. Executive Summary

This audit confirms that the current downstream scheduling contract does **not** expose a `ProjectionAdapter` output containing paired canonical integer minutes plus projected workday values. The active contract exposes schedule values as numeric fields (`earlyStart`, `earlyFinish`, `lateStart`, `lateFinish`, `totalFloat`) and task `duration`, without explicit unit suffixes and without `freeFloat`.

Result: canonical integer minute fields are **not currently exposed alongside projected workday fields** in the present contract. A future contract extension is required.

## 2. Background

Milestone W5B-B2.12A.9 established policy that canonical values remain integer minutes and any workday conversion is projection/display only. This milestone audits the current output shape before implementing any extension.

Current codebase flow remains layered:

React UI → Web Worker authoritative state → protocol contracts / adapters → WASM boundary → Rust CPM kernel.

This audit is documentation-only and makes no production changes.

## 3. Policy Carried Forward from W5B-B2.12A.9

Policy carried forward unchanged:

- Canonical representation must remain integer minutes.
- Workday conversion is projection/display only.
- `481 / 480 = 1.00208333…` is a valid projection artifact.
- No rounding/truncation in engine, WASM boundary, translator, or adapter input layers.
- UI/reporting formatting must not contaminate authoritative Worker/engine inputs.

## 4. Current ProjectionAdapter Contract

A concrete `ProjectionAdapter` contract/type is **not present** as a named production artifact in this repository. The effective downstream schedule output contract is currently represented by `ScheduleResultMap`:

```ts
export type ScheduleResultMap = {
  [taskId: string]: {
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    totalFloat: number;
    isCritical: boolean;
  };
};
```

Source: `packages/protocol/src/types.ts`

The worker maps kernel results directly to this shape:

```ts
resultMap[result.taskId] = {
  earlyStart: result.earlyStart,
  earlyFinish: result.earlyFinish,
  lateStart: result.lateStart,
  lateFinish: result.lateFinish,
  totalFloat: result.totalFloat,
  isCritical: result.isCritical,
};
```

Source: `packages/worker/src/schedule/applyScheduleResult.ts`

## 5. Current Output Fields

### `totalFloat`

- Present as `totalFloat: number`.
- No `totalFloatMinutes` or `totalFloatWorkdays` split.
- Unit is not encoded in field name.

### `freeFloat`

- Not present in the contract.
- No field in protocol map, worker mapping, or UI schedule result usage.

### `duration`

- Task contract uses `duration: number`.
- UI renders duration as days (`{task.duration}d`) and enforces integer edits.
- No parallel minute/workday representation in output shape.

### `start` / `finish`

- Schedule output uses `earlyStart`, `earlyFinish`, `lateStart`, `lateFinish`.
- UI projects `earlyStart` and `earlyFinish` to calendar date strings via `projectDateShort`.
- No explicit `*Minutes` / `*Workdays` naming.

## 6. Canonical Minutes Availability

Canonical integer minute values are **not directly available** in the current effective output contract as explicit fields. There are no `*Minutes` fields for float/duration/start/finish in the schedule output object and no paired minute + workday structure exposed to consumers.

## 7. Workday Projection Behaviour

No dedicated `ProjectionAdapter` output contract currently exposes workday projection fields for schedule results. In current UI usage, projection observed is day-offset-to-date projection (`projectDateShort`) for start/finish display, not a minute-to-workday paired output contract.

## 8. Downstream Consumer Risk

Current risks:

- Ambiguous units (`duration`, `totalFloat`, start/finish fields are plain numbers without unit suffixes).
- No direct canonical minute field for consumers that may later need minute-level fidelity.
- If a future display projection emits workday floats without paired minute fields, downstream consumers may treat projected floats as authoritative and introduce precision drift during round-trips.

## 9. Contract Gap

Gap identified:

- Missing explicit dual-unit output contract (`*Minutes` + `*Workdays`) for temporal/schedule values.
- Missing `freeFloat` output shape alignment (if required by domain/consumer needs).
- Missing explicit unit naming that prevents ambiguity.

## 10. Recommended Contract Extension

For the next implementation milestone, extend the adapter/output contract to provide explicit paired fields where applicable, for example:

- `durationMinutes` (integer), `durationWorkdays` (float)
- `totalFloatMinutes` (integer), `totalFloatWorkdays` (float)
- `freeFloatMinutes` (integer), `freeFloatWorkdays` (float) (if free float is part of supported results)
- `startMinutes` / `finishMinutes` plus projected display/workday companions as needed by consuming boundaries

Requirements:

- Canonical minute fields remain authoritative.
- Workday fields are derived projection-only.
- No reverse-use of projected display values as canonical inputs.

## 11. Required Future Tests

Before/with implementation, add tests for:

1. **Contract shape validation**
   - Output exposes explicit `*Minutes` integer fields and `*Workdays` float fields.
2. **Boundary minute values**
   - `479`, `480`, `481`, `960`, and `961` minute cases.
3. **Immutability**
   - Projection layer does not mutate incoming translator/WASM facts.
4. **Round-trip safety**
   - UI/display workday values are not written back as authoritative worker input.
5. **Single-source `minutesPerDay` usage**
   - One authoritative source; avoid duplicated hard-coded `480` constants.

## 12. What Is Proven

- Current effective schedule output contract fields are `earlyStart`, `earlyFinish`, `lateStart`, `lateFinish`, `totalFloat`, `isCritical`.
- `freeFloat` is absent.
- No explicit `*Minutes`/`*Workdays` dual-field contract is currently exposed.
- UI uses numeric schedule fields directly and projects start/finish for date display.

## 13. What Is Not Proven

- Whether any external/non-repository consumer has a private adapter or out-of-band mapping not represented in this codebase.
- Whether future product decisions will require all temporal fields to expose both minute and workday variants vs selective pairing.

## 14. Safety Confirmation

- This milestone performed documentation/audit only.
- No production code, tests, protocol contracts, worker commands, React files, WASM/Rust, CI, or lockfiles were modified.
- Only the allowed file for this milestone was added.

## 15. Recommended Next Milestone

Proceed with **W5B-B2.12A.10 implementation follow-up (ProjectionAdapter Output Contract Extension)**:

- Introduce explicit canonical minute + projected workday paired output fields.
- Add required boundary/immutability/round-trip tests before release.
- Preserve architecture rule that Worker state remains authoritative and display projection remains non-authoritative.
