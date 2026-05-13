# W5B-B2.8 — Dogfood Enablement Review / Operator Runbook

> **STATUS: Documentation / Review only.**
> **Dogfood authority is NOT enabled.**
> **This document is a readiness review and operator runbook only.**
> **Dogfood enablement remains a future, separately-scoped milestone (B2.9 or later).**
> **No production / UAT authority is allowed. Temporal-authoritative persistence remains disabled.**

---

## 1. Executive Summary

Dogfood is **not enabled** by this document. The dogfood control plane installed in W5B-B2.7 remains **default OFF**.

This runbook captures:

- the dogfood-enablement preconditions that must be satisfied before any future activation,
- the step-by-step operator procedure for running a dogfood readiness check against an imported project today (diagnostic-only),
- the evidence-package format,
- rollback and emergency procedures,
- a failure-classification rubric, and
- the design gate that a future B2.9 milestone must clear before flipping the dogfood master switch.

No code is changed by this milestone. Worker `canApplyInternalTemporalAuthority` continues to block every rollout ring other than `internal_test`. UAT and production authority remain blocked. Persistence of temporal-authoritative output remains disabled. Source dates remain immutable.

---

## 2. Current Control State (post-W5B-B2.7)

### Accepted state

- Dogfood control plane installed: `TemporalDogfoodControls`, `TemporalDogfoodEligibilityDecision`, `TemporalDogfoodEligibilityEvaluator`, `RUN_TEMPORAL_DOGFOOD_READINESS_CHECK`, `TEMPORAL_DOGFOOD_READINESS_RESULT`.
- Dogfood authority master switch (`__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED`) defaults `false`.
- Operator acknowledgement defaults required, not provided.
- Persistence policy locked to `"disabled_runtime_only"`; `persistenceApplied` is literal `false`.
- Apply guard `canApplyInternalTemporalAuthority` still requires `temporalAuthorityRolloutRing === "internal_test"`. Dogfood / UAT / production rings fall back to slot with `fallbackReason: "rollout_ring_not_internal_test"`.
- Three clean internal_test evidence runs accepted (AI001, AI002, AI004).
- Evidence count `3 of 3` is a precondition only — it does **not** grant permission to apply.

### Validation captured at acceptance

| Surface | Result |
|---|---|
| `tsc --noEmit` protocol | green |
| `tsc --noEmit` worker | green |
| `tsc -b --noEmit` web | green |
| Worker vitest | 1234 tests / 63 files passed |
| Web vitest | 503 tests / 40 files passed |
| Playwright wasm-browser | 1 / 1 passed |

### Rollout rings (fixed vocabulary — must not be extended)

`off | internal_test | dogfood | uat | production`

---

## 3. Preconditions for Future Dogfood Enablement

All four blocks below must be **simultaneously** satisfied before any future B2.9 enablement design is approved.

### 3.1 Evidence preconditions

- 3 clean internal_test evidence runs accepted.
- For each run:
  - WASM gate passed (`realWasmValidationPassed === true`, `wasmLoadMode === "real"`).
  - Candidate projection available.
  - Candidate-vs-slot comparison present.
  - `unexplainedDivergenceCount === 0`.
  - `unsupportedFeatureFlags === []`.
  - `sourceProtectionStatus === "ok"`.
  - Internal temporal apply succeeded under `internal_test` ring.
  - Rollback restored `slot_authoritative`.
  - `persistenceApplied === false`.
  - Source dates preserved across apply, rollback, and reload.

### 3.2 Runtime readiness preconditions

- Dogfood control plane installed (B2.7) — ✅ done.
- Dogfood authority master switch defaults OFF — ✅ done.
- Dogfood readiness command (`RUN_TEMPORAL_DOGFOOD_READINESS_CHECK`) returns a result with `authorityApplied: false` — ✅ done.
- Apply guard still blocks dogfood ring — ✅ done.
- Emergency rollback verified end-to-end on a representative fixture.

### 3.3 Operator readiness preconditions

- Operator can articulate the difference between **source dates** (immutable import facts), **slot-engine schedule** (current authority), and **temporal-candidate / temporal-authoritative schedule** (diagnostic until dogfood is approved).
- Operator can trigger rollback to `slot_authoritative` without external help.
- Operator can capture and attach the diagnostic evidence payload defined in §5.
- Operator can classify a fallback event as **expected** (precondition-blocked), **blocker** (precondition unmet but recoverable), or **safety failure** (source mutation / persistence contamination / rollback failure).

### 3.4 Project-eligibility preconditions

A given project (or fixture) is eligible for a dogfood readiness pass only if **all** of the following hold:

- No resource-calendar requirement (`resourceCalendarRequirementDetected === false`).
- No unsupported lag-calendar semantics (`lagCalendarRequirementDetected === false`).
- No unsupported P6 constraint semantics (`p6SemanticsRequirementDetected === false`).
- No unexplained divergence (`unexplainedDivergenceCount <= unexplainedDivergenceTolerance`, default tolerance `0`).
- No unsupported feature flags (`unsupportedFeatureFlags.length === 0`).
- Project activity count within dogfood threshold (`projectActivityCount <= projectActivityLimit`, default `1000`).
- Source protection status `"ok"`.
- Persistence remains disabled.

---

## 4. Operator Runbook

This runbook is for **diagnostic** use today. Steps that would apply temporal authority are only valid under the existing `internal_test` ring. Dogfood authority remains disabled.

### 4.1 Pre-run checklist

1. Confirm environment is internal / non-production.
2. Confirm branch / commit hash and record it in the evidence package.
3. Confirm `__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED` is unset or `false`.
4. Confirm the fixture or project to be examined matches the eligibility profile in §3.4.
5. Confirm the rollback command (§6) is understood and reachable.

### 4.2 Import / open schedule

Capture, in the evidence package:

- Project name.
- Task count.
- Dependency count.
- Calendar profile (calendar IDs in use, default calendar id).
- Resource assignment count (must be 0 for dogfood eligibility).
- Source rollup finish (project finish derived from source dates).
- Import diagnostics (any warnings emitted during import).

### 4.3 Run readiness check

Dispatch the worker command:

```jsonc
{ "type": "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK", "v": 1, "reqId": "<unique-id>" }
```

Expected response:

```jsonc
{ "type": "TEMPORAL_DOGFOOD_READINESS_RESULT", "v": 1, "reqId": "<unique-id>", "payload": { ... } }
```

Capture, from the payload:

- `decision.eligible`
- `decision.blockedReasons`
- `decision.warnings`
- `evidenceRunCountAccepted` (vs `evidenceRunCountRequired`)
- `sourceProtectionStatus`
- `persistenceStatus` (must be `{ persistencePolicy: "disabled_runtime_only", persistenceApplied: false }`)
- `rollbackStatus`
- `unsupportedFeatureFlags`
- `decision.authorityApplied` (must be `false`)

If `decision.authorityApplied !== false`, **stop** and treat as a safety failure (§7.3).

### 4.4 Diagnostic evidence sequence

Execute in order:

1. **WASM gate** — confirm `realWasmValidationPassed === true` and `wasmLoadMode === "real"`.
2. **Candidate projection** — confirm `candidateProjectionAvailable === true`.
3. **Comparison review** — confirm comparison is present and inspect divergence summary.
4. **Internal temporal apply** — only under the existing `internal_test` ring. Do **not** override `temporalAuthorityRolloutRing` to `dogfood`.
5. **Rollback** — return to `slot_authoritative` (§6).
6. **Reload diagnostics** — close and reopen the project; confirm source dates are unchanged and the apply ring is back to default.

### 4.5 Source-date preservation check

Capture a small table for at least three sentinel activities (first, last, longest-duration):

| Activity ID | Source Start | Source Finish | After Apply | After Rollback | After Reload |
|---|---|---|---|---|---|
| ... | ... | ... | must equal source | must equal source | must equal source |

If any row diverges, **stop** and treat as a safety failure (§7.3).

### 4.6 Run readiness check again

Re-dispatch `RUN_TEMPORAL_DOGFOOD_READINESS_CHECK` after rollback and reload. Confirm:

- `decision.authorityApplied === false`.
- `persistenceStatus.persistenceApplied === false`.
- `rollbackStatus.rollbackAvailable === true` or, if `false`, with `rollbackRequired === true` flagged as blocker.

---

## 5. Evidence Package Template

Each readiness pass produces one evidence package containing:

1. **Run metadata**
   - Run ID, operator, branch / commit, date/time, fixture / project name.
2. **Required payloads**
   - Full `TEMPORAL_DOGFOOD_READINESS_RESULT` payload (pre-apply and post-rollback).
   - Full `TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT` payload.
   - Full `TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT` payload.
   - Full `TEMPORAL_AUTHORITY_APPLY_RESULT` payload (under `internal_test` ring only).
3. **Screenshots** (operator-captured; agent does not drive the browser)
   - TaskTable showing source dates intact post-rollback.
   - Gantt showing slot-authoritative bars post-rollback.
   - Diagnostics overlay or console snapshot showing `authorityApplied: false`.
4. **Source preservation table** (§4.5).
5. **Console / runtime errors**
   - Any console errors or warnings during the sequence.
6. **Recommendation**
   - **A.** Ready — preconditions satisfied; package supports a future dogfood enablement design (still default off).
   - **B.** Incomplete — listed gaps to address.
   - **C.** Safety issue — do not proceed; escalate.

---

## 6. Rollback / Emergency Procedure

### 6.1 Command

Operator can clear the requested temporal authority and force fallback by either:

- Toggling `__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK = true` on the worker scope and re-running a schedule, or
- Reloading the project (since temporal-authoritative output is not persisted).

### 6.2 Expected payload

After rollback, a subsequent `RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS` must show:

- `currentAuthorityEngineMode: "slot_authoritative"`.
- `authorityApplied: false`.
- `appliedEngine: "slot"`.
- `persistenceApplied: false`.

A subsequent `RUN_TEMPORAL_DOGFOOD_READINESS_CHECK` must show:

- `decision.authorityApplied: false`.
- `persistenceStatus.persistenceApplied: false`.

### 6.3 How to confirm slot is restored

- TaskTable and Gantt match the slot-authoritative schedule from before any apply attempt.
- Source dates equal the import values across sentinel rows (§4.5).
- Diagnostics show `appliedEngine: "slot"`.

### 6.4 How to confirm no persistence contamination

- Reload the page; the project state is whatever the persistence layer last saved under `slot_authoritative`. Temporal-authoritative output never reaches persistence.
- `persistenceStatus.persistenceApplied` is `false` in both diagnostics and readiness payloads.

---

## 7. Failure Classification

### 7.1 Expected fallback (not a blocker)

Any of the documented `blockedReasons` returned by the readiness check is **expected** behavior when the corresponding precondition is unmet. These include:

- `dogfood_authority_disabled` (always present until B2.9 enables it).
- `operator_acknowledgement_missing`.
- `evidence_package_missing`.
- `real_wasm_gate_not_passed`.
- `candidate_projection_unavailable`.
- `candidate_comparison_missing`.
- `unexplained_divergence_present`.
- `unsupported_feature_detected`.
- `temporal_execution_error`.
- `resource_calendar_not_supported`.
- `lag_calendar_not_supported`.
- `p6_semantics_not_supported`.
- `project_size_exceeds_dogfood_limit`.

Operator action: record the reasons in the evidence package; choose recommendation **B** if any are recoverable, **A** only if all are absent.

### 7.2 Blocker (recoverable, but readiness fails)

- `rollback_not_available` with `rollbackRequired: true`.
- `source_protection_not_ok` when `sourceProtectionStatus` is `"violated"` due to a recoverable diagnostic issue (e.g. WASM unavailable). Treat as blocker, escalate before re-running.

### 7.3 Safety failure (escalate immediately, stop the run)

Any of the following indicate the safety invariants have been broken and the run must be stopped:

- `persistence_not_disabled` reason is emitted **or** `persistenceStatus.persistenceApplied === true`.
- A source-date row in §4.5 changes value after apply, rollback, or reload.
- Rollback does not restore `slot_authoritative`.
- TaskTable and Gantt show different schedules ("split-brain") after rollback.
- `decision.authorityApplied !== false` from the dogfood readiness command.
- `TEMPORAL_AUTHORITY_APPLY_RESULT` under a non-`internal_test` ring returns `authorityApplied: true`.

Operator action: capture full diagnostics, do not continue, file the safety failure against B2.7 / B2.8 acceptance, and require an investigation milestone before any further readiness runs.

---

## 8. Future Enablement Design Requirements (B2.9 gate)

A future milestone that enables the dogfood ring as an actual apply path must include **all** of the following before it is approved:

1. **Explicit config flag** — a single runtime flag (e.g. `__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED`) gates the entire apply path; default remains `false`.
2. **Operator acknowledgement** — runtime requires `operatorAcknowledgementProvided === true` before the apply path will accept the dogfood ring.
3. **Dogfood-only apply path** — the change to `canApplyInternalTemporalAuthority` must be strictly limited to permitting `dogfood` **in addition to** `internal_test`. UAT and production remain blocked. The change must not relax any other precondition.
4. **Emergency rollback always wins** — `__PLANNER_TEMPORAL_AUTHORITY_EMERGENCY_ROLLBACK` continues to force `slot_authoritative` regardless of ring or flags.
5. **Persistence disabled** — `persistencePolicy` stays `"disabled_runtime_only"`; `persistenceApplied` remains literal `false`; no temporal-authoritative output reaches persistence.
6. **Source dates immutable** — apply / rollback / reload must not alter any source field; B2.7 source-protection checks remain in force.
7. **UAT / production still blocked** — apply guard hard-rejects both rings with `fallbackReason: "rollout_ring_not_internal_test"` (or a clearly-scoped successor reason that still rejects UAT/production).
8. **Apply guard change limited to dogfood only** — no other ring is unlocked in the same change.
9. **Tests proving default OFF** — at minimum:
   - Default runtime + dogfood ring → fallback with `rollout_ring_not_internal_test` (or successor) and `authorityApplied: false`.
   - Master switch on but acknowledgement missing → fallback.
   - Master switch on + acknowledgement on + any precondition unmet → fallback.
   - UAT / production ring → always fallback, regardless of flags.
   - `persistenceApplied` is `false` on every code path.
10. **No production UI** — internal diagnostics surface only; production UI exposure remains out of scope.
11. **No new authority surface** — resource calendars, lag-calendar full parity, and full P6 constraint semantics remain out of scope.

---

## 9. Files Changed

| File | Status |
|---|---|
| [docs/milestones/W5B-B2.8-dogfood-operator-runbook.md](docs/milestones/W5B-B2.8-dogfood-operator-runbook.md) | New (this document) |

No code files changed. No runtime defaults changed. No tests added or removed.

---

## 10. Validation Results

Documentation-only milestone. No code changes; per the B2.8 brief, validation matrix is not required.

- `git status` / `git diff --stat`: expected to show only this new file under `docs/milestones/`.
- Worker / web / protocol typechecks: not re-run (no code touched).
- Worker / web vitest: not re-run (no code touched).
- Playwright wasm-browser: not re-run (no code touched).

Last accepted validation baseline (from W5B-B2.7) remains authoritative:

- Worker: 1234 tests / 63 files passed.
- Web: 503 tests / 40 files passed.
- wasm-browser: 1 / 1 passed.

---

## 11. Recommendation

**A. Runbook ready — may plan future B2.9 dogfood enablement implementation, still default off.**

Rationale:

- B2.7 control plane is installed and accepted.
- Dogfood authority remains default OFF; apply guard still rejects the dogfood ring.
- Operator preconditions, evidence preconditions, project eligibility preconditions, and the future enablement design gate are all defined.
- Failure-classification rubric distinguishes expected fallback from blockers from safety failures.
- No code change is required to deliver this runbook; no runtime behavior is altered.

Dogfood remains **not enabled**. Any future activation must clear the §8 design gate as a separate milestone.
