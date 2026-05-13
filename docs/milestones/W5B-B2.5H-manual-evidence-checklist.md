# W5B-B2.5H Imported-XER Manual Apply/Rollback Evidence — Operator Checklist

**Purpose:** Reusable checklist for the human operator who will execute the imported-XER manual apply/rollback evidence sequence in a live browser.

**Strict rules (do not violate):**
- Do **not** enable dogfood, UAT, or production authority.
- Do **not** persist temporal-authoritative output.
- Do **not** overwrite imported source dates.
- Do **not** mutate source import records.
- Do **not** weaken slot fallback.
- Do **not** fake or simulate evidence — capture real values from the live browser session.
- If any step fails or returns an unexpected payload, stop and record the result; do not retry blindly.

---

## 0. Pre-flight

- [ ] Fixture present at agreed local path (e.g. `apps/web/tests/fixtures/AI001.xer` or operator-local confidential path). File name: __________________________
- [ ] Confirm `.gitignore` excludes the fixture if it is confidential.
- [ ] Clean dev server start: `pnpm --filter @planner/web dev` (or repo equivalent).
- [ ] Hard-refresh browser (Ctrl/Cmd+Shift+R).
- [ ] DevTools console open. No prior `window.__runTemporal*` calls in this session.

## 1. Fixture details

| Field | Value |
|---|---|
| File name |  |
| Project name |  |
| Data date |  |
| Default calendar |  |
| Activities count |  |
| Source rollup finish |  |
| Must finish by (if any) |  |

## 2. Representative activities (≥3)

Pick 3 activities spanning the schedule (e.g. early, middle critical, late milestone).

| # | Activity ID | Activity Name | Imported Source Start | Imported Source Finish |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## 3. Before apply — baseline capture

- [ ] Engine badge state (label + tooltip): __________________________
- [ ] TaskTable dates for the 3 representative activities (screenshot + values).
- [ ] Import Details source dates for the 3 representative activities (screenshot + values).
- [ ] Source vs Planner / Source vs Temporal label state: __________________________
- [ ] Calendar-risk diagnostics (if surfaced): __________________________
- [ ] Status header text: __________________________

## 4. WASM gate

```js
await window.__runTemporalWasmValidationGate()
```

Paste returned payload (JSON) verbatim:

```
<paste here>
```

- [ ] Gate succeeded with no fallback reason.

## 5. Candidate projection

```js
await window.__runTemporalCandidateProjection({
  runWasmGateFirst: true,
  temporalCandidateProjectionEnabled: true,
  temporalAuthorityRolloutRing: "internal_test",
  useLastSuccessfulWasmGate: true
})
```

Paste returned payload:

```
<paste here>
```

Capture: `candidateProjectionAvailable`, `comparisonAvailable`, `unexplainedDivergenceCount`, `unsupportedFeatureFlags`.

## 6. Temporal authority apply (only if §4 and §5 passed cleanly)

```js
await window.__runTemporalAuthorityApply({
  temporalAuthorityEnabled: true,
  temporalAuthorityRolloutRing: "internal_test",
  requestedAuthorityEngineMode: "temporal_authoritative",
  temporalCandidateProjectionEnabled: true,
  useLastSuccessfulWasmGate: true
})
```

Paste returned payload:

```
<paste here>
```

Capture exact values:

| Field | Value |
|---|---|
| `authorityApplied` |  |
| `appliedEngine` |  |
| `applyMode` |  |
| `rolloutRing` |  |
| `fallbackReason` |  |
| `persistenceApplied` (must be `false`) |  |
| `sourceProtectionStatus` (must be `ok`) |  |
| `unsupportedFeatureFlags` |  |
| `unexplainedDivergenceCount` |  |

After apply:
- [ ] Engine badge state: __________________________
- [ ] TaskTable and Gantt show consistent (non-split-brain) dates.
- [ ] Import Details source dates **unchanged** for all 3 representative activities.

## 7. Rollback

```js
await window.__runTemporalAuthorityRollback()
```

Paste returned payload:

```
<paste here>
```

Capture:

| Field | Value |
|---|---|
| `rollbackApplied` |  |
| `restoredEngine` |  |
| `restoredTaskCount` |  |
| `persistenceApplied` (must be `false`) |  |
| `fallbackReason` |  |

After rollback:
- [ ] Engine badge returned to safe default / slot state.
- [ ] TaskTable/Gantt restored and coherent.
- [ ] Import Details source dates **unchanged** for all 3 representative activities.

## 8. Reload check

- [ ] Hard-refresh browser.
- [ ] Engine mode returns to safe default / slot state (not `temporal_authoritative`).
- [ ] Imported source records remain intact (Import Details still lists project + activities).
- [ ] Source dates unchanged for the 3 representative activities.
- [ ] No temporal-authoritative runtime state hydrated as canonical state.

## 9. Source-date preservation table

Fill at end of session:

| Activity ID | Src Start Before | Src Finish Before | Src Start After Apply | Src Finish After Apply | Src Start After Rollback | Src Finish After Rollback | Src Start After Reload | Src Finish After Reload |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |

All "After …" columns **must** equal the "Before" columns. Any drift = recommendation C (failed).

## 10. Final report

Use the structure from the B2.5H task spec:

1. Summary
2. XER Fixture Used
3. Source Date Preservation Evidence (table from §9)
4. Candidate Projection Result
5. Temporal Authority Apply Result
6. Rollback Result
7. Persistence / Reload Evidence
8. UI / Label Safety
9. Validation Results (typecheck × 3, vitest worker, vitest web, wasm-browser)
10. Blockers / Risks
11. Recommendation:
    - **A.** Imported-XER evidence passed — ready for dogfood design, not enablement.
    - **B.** Evidence blocked — fix listed issue before dogfood design.
    - **C.** Evidence failed — fix source/apply/rollback safety before proceeding.

**Stop after manual evidence. Do not enable dogfood, UAT, or production authority.**
