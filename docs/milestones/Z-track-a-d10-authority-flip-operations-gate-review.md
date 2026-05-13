# Track-A Milestone Note - D10 Authority-Flip Operations & Gate Review

## Status
D10 is planning/operations documentation only.

No production authority flip is performed in this note.

## Purpose
Define the implementation-ready runbook for the first minute-authoritative rollout using governed gates, ring deployment, and explicit rollback criteria.

## Scope and Invariants
- Slot path remains authoritative until explicit go decision at D10 execution time.
- Minute path remains shadow-only until go decision at D10 execution time.
- Task calendar activation: NO-GO.
- Resource calendar activation: NO-GO.
- Kernel remains integer-only and calendar-blind.
- This runbook is operational and advisory; it does not change scheduling math.

## 1) Go/No-Go Checklist for First Authority Flip
All checks below must be green in the same release candidate.

### A. Technical gate inputs (hard requirements)
- Requested authority mode is minute.
- Kill switch is not forcing slot authority.
- Parity gate is passed for required D8 scope.
- Readiness benchmark is passed.
- Persistence purity is passed.
- Staging approval for minute authority is present.

### B. Evidence bundle required for gate review
- Latest unified D9e cutover-readiness report captured from worker runtime.
- Benchmark report package from D9c fixture runner for representative scenarios.
- Parity mismatch summary with critical fields at zero true regressions.
- Persistence purity report with zero derived-field persistence violations.
- Rollback rehearsal evidence from latest pre-prod ring.

### C. Operational readiness checks
- On-call owner assigned for rollout window.
- Incident channel opened and staffed by Engineering + QA.
- Kill-switch operators identified and verified.
- Rollback command path rehearsed and documented.
- User-facing support triage template prepared for schedule-shift reports.

### D. No-Go conditions
- Any hard requirement in section A is false.
- Any required evidence artifact in section B is missing or stale.
- Rollback rehearsal failed or was not executed in current release candidate.
- Telemetry feed required for continuation is unavailable.

## 2) Ring Rollout Plan
Progress only when exit criteria for the current ring are satisfied.

### Ring 0: Internal / Dogfood
Population:
- Internal projects only.
- Engineering-owned datasets including known edge-case fixtures.

Duration:
- Minimum 24 hours and at least 100 scheduling runs.

Entry criteria:
- Go checklist fully green.

Exit criteria:
- No Sev1/Sev2 schedule-integrity incidents.
- Critical-field parity true regressions remain zero.
- Latency continuation thresholds satisfied (see section 6).
- Kill-switch verification completed in-ring (section 4).
- Persistence reversibility verification completed in-ring (section 5).

### Ring 1: Canary
Population:
- Small external slice (target 1-5% of eligible production workspaces).
- Exclude high-risk enterprise workspaces in first canary pass.

Duration:
- Minimum 48 hours and at least 500 scheduling runs.

Entry criteria:
- Ring 0 exit criteria met and signed off.

Exit criteria:
- No unresolved Sev1 incidents.
- Sev2 rate does not exceed Ring 0 baseline.
- No new authoritative error class introduced.
- Latency continuation thresholds satisfied for two consecutive review windows.

### Ring 2: Partial Production
Population:
- Increase to 10-25% of eligible production workspaces.

Duration:
- Minimum 72 hours and at least 2,000 scheduling runs.

Entry criteria:
- Ring 1 exit criteria met and signed off.

Exit criteria:
- Stability trend non-degrading across all telemetry and support metrics.
- Rollback drill repeated successfully at this scale.
- Gate review board approves full-production promotion.

### Ring 3: Full Production
Population:
- 100% of eligible production workspaces.

Entry criteria:
- Ring 2 exit criteria met and signed off.

Post-entry guard period:
- 7-day heightened monitoring window.
- Keep slot fallback and kill-switch path active during guard period.

Promotion completion criteria:
- No Sev1 incidents during final 72 hours of guard period.
- Continuation thresholds remain green.

## 3) Rollback Triggers
Immediately roll back to slot authority when any trigger occurs:
- Critical-field parity true regression is detected in rollout scope.
- New authoritative solver error class appears.
- Any ABI incompatibility or decode contract break is detected.
- Latency threshold breach persists across two consecutive windows.
- Data integrity anomaly is observed in projected schedule outputs.
- Sev1 schedule-shift incident confirmed as authority-related.

Rollback action sequence:
1. Force slot authority via kill switch.
2. Set requested authority mode back to slot for rollout cohort.
3. Keep minute path shadow-only for diagnostics.
4. Capture and freeze readiness report + telemetry snapshots for incident review.
5. Open blocker record; rollout progression is halted until closure.

## 4) Kill-Switch Verification Procedure
Run this verification in each ring before promotion.

Procedure:
1. Start with requested mode minute and kill switch off in the target ring.
2. Confirm D9e report shows minute requested and gate status as expected.
3. Enable kill switch force-slot.
4. Run controlled scheduling samples.
5. Verify effective authority is slot in runtime decision evidence.
6. Verify scheduling output remains service-healthy and stable.
7. Disable kill switch and confirm behavior returns to pre-test state.

Pass criteria:
- Switch to slot is immediate for subsequent scheduling passes.
- No worker crash or persistence corruption during toggle.
- Audit/telemetry evidence is captured for all toggle transitions.

## 5) Persistence-Reversibility Verification Procedure
Objective:
- Prove that rollback does not corrupt canonical persisted state and hydration remains valid.

Procedure:
1. Capture pre-test persisted-state checksum and schema version for test workspace.
2. Execute minute-authority cohort runs for representative command sequences.
3. Trigger rollback to slot authority.
4. Persist state and rehydrate in a fresh worker session.
5. Validate persistence purity (no derived fields persisted).
6. Recompute schedule under slot authority and verify domain-state consistency.
7. Compare post-rollback persisted-state schema and canonical keys against pre-test baseline.

Pass criteria:
- Persisted canonical structures remain valid and schema-compatible.
- No forbidden derived fields in persisted payload.
- Rehydration succeeds without migration errors.
- Slot-authoritative recompute is deterministic for canonical state.

## 6) Latency / Telemetry Thresholds for Rollout Continuation
Thresholds are continuation gates at each ring.

### Benchmark thresholds (from D9c baseline policy)
- Max p95 regression per metric: <= 10%.
- Minimum runs per metric: >= 30 in each evaluation window.
- Shadow failures allowed: 0.

### Required metrics
- primary_overall
- shadow_overall
- primary_request_build
- primary_engine_exec
- primary_projection
- shadow_request_build
- shadow_engine_exec

### Continuation policy
- Continue ring only if all required metrics pass threshold and sample checks.
- Hold ring (no promotion) on first failed window and investigate.
- Roll back on two consecutive failed windows or on any hard rollback trigger.

## 7) Support / QA Triage Workflow for Reported Schedule Shifts
Intake and triage must follow one queue and one severity model.

### Intake bundle (required per report)
- Workspace/project identifier.
- Command/time window when shift first observed.
- Expected vs observed early/late dates and float.
- Exported diagnostics and latest D9e readiness report.
- Whether issue reproduces under forced slot authority.

### Severity classification
- Sev1: widespread incorrect schedule output affecting critical planning decisions.
- Sev2: significant but contained correctness drift with known workaround.
- Sev3: low-impact discrepancy or cosmetic projection issue.

### Workflow
1. Support logs incident with required intake bundle.
2. QA reproduces in controlled fixture where possible.
3. Engineering runs parity comparison and authority-path isolation (slot-forced vs minute cohort behavior).
4. If minute-authority regression is confirmed, trigger rollback policy.
5. Publish incident summary with root-cause status and mitigation.

### SLA targets
- Sev1: acknowledge within 15 minutes, mitigation decision within 60 minutes.
- Sev2: acknowledge within 60 minutes, mitigation decision within 4 hours.
- Sev3: acknowledge same business day.

## 8) Explicit No-Go: Task/Resource Calendars
Task and resource calendars remain NO-GO during D10 rollout and guard period.

Re-open condition (all required):
- D10 full-production guard period completed.
- Slot engine retirement/stabilization milestone explicitly approved.
- Dedicated post-rollout calendar-activation milestone published.

Until then, no task/resource calendar UI or runtime activation is permitted.

## D10 Exit Artifact Set
D10 execution is complete only when all artifacts exist:
- Signed gate review checklist.
- Ring progression log with entry/exit evidence.
- Kill-switch verification logs for each ring.
- Persistence reversibility verification logs for each ring.
- Incident and triage summary, including zero-incident statement if applicable.
- Final go/no-go decision record for post-D10 stabilization phase.
