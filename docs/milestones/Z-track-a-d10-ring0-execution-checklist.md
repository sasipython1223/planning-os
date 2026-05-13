# Track A D10 Ring 0 Execution Checklist

Scope: internal dogfood Ring 0 execution only. This sheet is intentionally narrower than the full gate review note and is aligned to the current worker runtime flags, readiness report, operator summary, and runtime logs.

## 1. Pre-run controls

Set or confirm these worker runtime controls before starting the Ring 0 run:

| Control | Required value for Ring 0 |
| --- | --- |
| `__PLANNER_REQUESTED_AUTHORITY_MODE` | `"minute"` |
| `__PLANNER_FORCE_SLOT_AUTHORITY` | `false` |
| `__PLANNER_STAGE_APPROVED_MINUTE_AUTHORITY` | `true` |
| `__PLANNER_PARITY_GATE_PASSED` | `true` |
| `__PLANNER_READINESS_BENCHMARK_PASSED` | `true` |
| `__PLANNER_PERSISTENCE_PURITY_PASSED` | `true` |
| `__PLANNER_ROLLOUT_RING` | `"internal_dogfood"` |
| `__PLANNER_ENABLE_MINUTE_AUTHORITY_CANARY` | `true` |
| `__PLANNER_KILL_SWITCH_REHEARSAL_RESULT` | `"passed"` |
| `__PLANNER_ROLLBACK_REHEARSAL_RESULT` | `"passed"` |

If using cohort allowlisting, also confirm:

| Control | Required value |
| --- | --- |
| `__PLANNER_ROLLOUT_TARGETING_MODE` | `"cohort_allowlist"` |
| `__PLANNER_ROLLOUT_SUBJECT_COHORT_ID` | active Ring 0 cohort id |
| `__PLANNER_ROLLOUT_TARGET_COHORTS` | includes the active Ring 0 cohort id |

If not using allowlisting, `__PLANNER_ROLLOUT_TARGETING_MODE` may remain `"all"`.

## 2. Start authorization checks

Do not start Ring 0 unless the latest readiness surfaces show all of the following:

- `ringProgressionApproval.approvedRing` is `"internal_dogfood"` or higher.
- `ringProgressionApproval.canProgress` is `true`.
- `minuteCanaryEnablement.canEnableMinuteAuthorityForCohort` is `true`.
- `operatorSummary.internalDogfoodExecutionEntryReady` is `true`.
- `operatorSummary.internalDogfoodExecutionEntryBlockers` is empty.
- `operatorSummary.minuteExecutionRoute` is expected to become `"minute"` for the active Ring 0 cohort.

If any of those conditions fail, remain slot-authoritative and treat the run as not authorized.

## 3. Logs and reports to watch during the run

Watch these runtime log blocks throughout the Ring 0 window:

- `[D9e Cutover Readiness Report]` for the full state snapshot.
- `[D10b Rollout Operator Summary]` for the condensed operator view.
- `[D10d Canary Enablement]` for current cohort eligibility and blockers.
- `[D10e Canary Execution Routing]` for actual route, routing reason, and fallback reason.
- `[D10h Ring 0 Support]` for execution evidence, observation progress, and fallback capture.
- `[D10h Ring 0 Review]` for execution-entry state, evidence-bundle state, review readiness, and continuation readiness.

Healthy Ring 0 runtime signals:

- routing log shows `route: "minute"` for the intended Ring 0 cohort
- routing reason is not a blocker condition
- fallback reason remains `null`
- `internalDogfoodSupport.minuteExecutionObserved` becomes `true`
- `internalDogfoodSupport.persistenceSafetyVerified` stays `true`
- `internalDogfoodSupport.persistencePurityViolationCount` stays `0`

## 4. Immediate stop or rollback signs

Treat any of the following as a stop-and-review condition:

- routing flips back to `"slot"` unexpectedly for the targeted Ring 0 cohort
- `minuteFallbackReason` or `lastFallbackReason` becomes non-null
- routing reason shows execution failure, normalized output missing, or runtime not observed
- `persistenceSafetyVerified` becomes `false`
- `persistencePurityViolationCount` becomes greater than `0`
- parity or benchmark evidence is later reported as not passed for review

If a kill switch is intentionally used, confirm the system returns to slot routing and preserve the resulting evidence for the post-run bundle.

## 5. Post-run minimum review checks

Do not consider Ring 0 complete until the report shows all of the following:

- `internalDogfoodSupport.minimumObservationDurationMet` is `true`
- `internalDogfoodSupport.minimumSchedulingRunsMet` is `true`
- `internalDogfoodSupport.inRingKillSwitchVerified` is `true`
- `internalDogfoodSupport.inRingRollbackVerified` is `true`
- `internalDogfoodSupport.evidenceBundleComplete` is `true`
- `internalDogfoodSupport.reviewReady` is `true`
- `internalDogfoodSupport.reviewBlockers` is empty

Evidence bundle completeness means the run captured benchmark evidence, kill-switch evidence, rollback evidence, and persistence-purity evidence.

## 6. Go or no-go before progression beyond Ring 0

Answer "yes" to every question before proposing progression:

1. Did Ring 0 remain explicitly approved for the current ring throughout the run?
2. Did the targeted Ring 0 cohort execute on minute authority without unexpected slot fallback?
3. Was the observation window at least 24 hours?
4. Were at least 100 scheduling runs observed?
5. Were in-ring kill-switch and rollback checks both verified?
6. Did persistence safety remain verified with zero purity violations?
7. Did parity stay clear with zero true regressions?
8. Did benchmark review evidence remain passed?
9. Does `internalDogfoodSupport.continuationGateReady` equal `true`?

If any answer is "no", stay at Ring 0 and reopen the gate review before any wider progression.