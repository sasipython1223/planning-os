# Phase W — Import / Export Architecture Specification

**Status:** Design / Specification  
**Predecessor:** Phase V (Constraints & Scheduling Modes)  
**Date:** 2026-03-18

---

## 1. Architecture Note

### 1.1 Why the System Is Ready for Import

The canonical model now covers the scheduling primitives present in professional-grade external formats:

| Canonical Capability | P6 XER Equivalent | MSP XML Equivalent |
|---|---|---|
| `Task` (id, name, duration, depth, isSummary) | TASK / TASKACTV | Task (UID, Name, Duration, Summary) |
| `Dependency` (FS/SS/FF/SF + integer lag) | TASKPRED (pred_type + lag) | PredecessorLink (Type + LinkLag) |
| `ConstraintType` (ASAP/ALAP/SNET/FNLT/MSO/MFO) | TASK.cstr_type | Task.ConstraintType |
| `constraintDate` (day-offset) | TASK.cstr_date | Task.ConstraintDate |
| `Resource` (id, name, maxUnitsPerDay) | RSRC | Resource (UID, Name, MaxUnits) |
| `Assignment` (taskId, resourceId, unitsPerDay) | TASKRSRC | Assignment (TaskUID, ResourceUID, Units) |
| Calendar / non-working days | CLNDR + CALDATA | Calendar + WeekDays + Exceptions |
| WBS hierarchy | PROJWBS | OutlineLevel / WBSMasks |
| Baseline snapshots | TASKACTV baseline fields | Task.BaselineStart/Finish |

Before Phase V, the system lacked constraint semantics and had no mechanism for diagnostics on lossy ingest. Both are now present. The `DiagnosticsMap` architecture, the `Command` spine with atomic undo/redo, and the `CommandEnvelope` audit seam provide the governance infrastructure for a safe, traceable import pathway.

### 1.2 Why Import Belongs in the Worker, Not React

Per `ARCHITECTURE_BOUNDARIES.md`:

> **React is a Projection Layer.** UI components dispatch intent and render subscribed state. They do not own business logic or scheduling truth.

> **Worker Owns Canonical State.** The Web Worker remains the single owner of mutable planning truth.

> **New Mutations Must Go Through the Command Spine.** All new canonical mutation paths must route through `dispatchCommand()`.

Import is a multi-entity bulk mutation of canonical state. It must:

1. Parse raw file bytes into structured data.
2. Validate and map external fields onto canonical types.
3. Emit diagnostics for unsupported, lossy, or ambiguous data.
4. Mutate canonical state atomically.
5. Produce a single undo entry covering the entire import.
6. Trigger re-scheduling via the kernel.

Steps 1–6 are all Worker responsibilities. React's role is limited to:

- Providing a file-select/drop surface.
- Displaying a parsed preview and diagnostics before commit.
- Dispatching a single `IMPORT_SCHEDULE` command on user confirmation.
- Rendering the resulting state diff.

---

## 2. Parsing Boundaries

### 2.1 Where Raw File Parsing Lives

Parsers live as **isolated, stateless modules within the Worker package** at:

```
packages/worker/src/import/
  parsers/
    xerParser.ts      # P6 XER text-format parser
    mspXmlParser.ts   # MS Project XML parser
  types/
    xerTypes.ts       # Raw XER row types (table-per-type)
    mspXmlTypes.ts    # Raw MSP XML element types
```

Each parser module exports a single pure function:

```
parseXer(raw: string): XerParseResult
parseMspXml(raw: string): MspXmlParseResult
```

The result types contain:

```
{
  data: XerData | MspXmlData;       // Parsed structured rows/elements
  errors: ParseError[];             // Fatal or structural parse errors
  warnings: ParseWarning[];         // Non-fatal parse issues
}
```

Parsers have **zero imports** from protocol, state, or kernel. They operate on raw strings and return plain objects. This isolation means parsers can be tested independently of the Worker runtime.

### 2.2 Whether Parsers Run in Worker or Isolated Thread

**Decision: Parsers run directly in the Worker thread, with a size gate.**

Rationale:

- XER files are plain text (tab-delimited tables). Parsing is CPU-cheap — O(n) string splitting.
- MSP XML files are larger but still parseable with DOMParser or streaming XML in acceptable time for typical project files (< 50 MB).
- Introducing a sub-worker (Worker inside Worker) adds complexity with no proven benefit until profiling proves otherwise.
- The size gate provides a safety valve.

**Size gate rule:**

Before parsing, the Worker checks `file.size`. If the file exceeds a configurable threshold (default: **50 MB**), the Worker emits a `NACK` with error `"FILE_TOO_LARGE"` and does not attempt parsing. This threshold can be raised in a future milestone if streaming parsing is added.

### 2.3 How Parse Errors Propagate to UI

Parse errors flow through the existing `WorkerMessage` channel using a new message type:

```
IMPORT_PREVIEW  — success: parsed summary + diagnostics for user review
NACK            — failure: parse error prevents any preview
```

The Worker never silently swallows parse errors. If the XER/XML structure is malformed to the point where no useful data can be extracted, the Worker emits a `NACK` with a structured error describing the failure location and reason. Partial parse results are never committed — the file either parses into a preview-able state or fails entirely.

---

## 3. Canonical Mapping Strategy

### 3.1 Mapping Pipeline

```
Raw File → Parser → ParseResult (format-specific)
                         ↓
                    Mapper Module
                         ↓
               ImportCandidate (canonical-shaped)
                         ↓
                  Validation + Diagnostics
                         ↓
              IMPORT_SCHEDULE command payload
```

The **mapper** is a separate module from the parser. It transforms format-specific parsed data into canonical types. The mapper is where all semantic translation decisions live.

```
packages/worker/src/import/
  mappers/
    xerMapper.ts
    mspXmlMapper.ts
  importCandidate.ts    # ImportCandidate type definition
```

### 3.2 Field Mapping Tables

#### Tasks / Activities

| Canonical Field | P6 XER Source (TASK table) | MSP XML Source | Notes |
|---|---|---|---|
| `id` | Generated UUID (not `task_id`) | Generated UUID (not `UID`) | External IDs stored in metadata; see §3.3 |
| `name` | `task_name` | `Task > Name` | Trimmed, non-empty required |
| `duration` | `target_drtn_hr_cnt / 8` (→ working days) | `Task > Duration` (ISO 8601 → days) | Rounded to integer; fractional → warning |
| `parentId` | Derived from `wbs_id` → WBS tree walk | `Task > OutlineLevel` nesting | Reconstructed from hierarchy |
| `depth` | Computed from WBS ancestry | Computed from `OutlineLevel` | Recomputed by `State.computeHierarchy()` |
| `isSummary` | `task_type == "TT_WBS"` or has children | `Task > Summary == 1` | Recomputed by `State.computeHierarchy()` |
| `constraintType` | `cstr_type` mapping (see §3.2.1) | `Task > ConstraintType` mapping | Unmappable types → `ASAP` + diagnostic |
| `constraintDate` | `cstr_date` → day-offset from project start | `Task > ConstraintDate` → day-offset | `null` if not applicable |
| `minEarlyStart` | `0` (default) | `0` (default) | May be refined from constraint date |

#### 3.2.1 Constraint Type Mapping

| P6 `cstr_type` | Canonical `ConstraintType` | Fidelity |
|---|---|---|
| `CS_ASAP` | `ASAP` | Exact |
| `CS_ALAP` | `ALAP` | Exact |
| `CS_SNET` / `CS_SNEDT` | `SNET` | Exact |
| `CS_FNLT` / `CS_FNLDT` | `FNLT` | Exact |
| `CS_MSO` / `CS_MSODT` | `MSO` | Exact |
| `CS_MFO` / `CS_MFODT` | `MFO` | Exact |
| `CS_FNET` | `SNET` (approximation) | Lossy — warning diagnostic |
| `CS_SNLT` | `FNLT` (approximation) | Lossy — warning diagnostic |
| Any other / unknown | `ASAP` | Lossy — warning diagnostic |

| MSP `ConstraintType` | Canonical `ConstraintType` | Fidelity |
|---|---|---|
| `0` (ASAP) | `ASAP` | Exact |
| `1` (ALAP) | `ALAP` | Exact |
| `2` (MSO) | `MSO` | Exact |
| `3` (MFO) | `MFO` | Exact |
| `4` (SNET) | `SNET` | Exact |
| `5` (SNLT) | `FNLT` (approximation) | Lossy — warning diagnostic |
| `6` (FNET) | `SNET` (approximation) | Lossy — warning diagnostic |
| `7` (FNLT) | `FNLT` | Exact |
| Any other / unknown | `ASAP` | Lossy — warning diagnostic |

#### Dependencies

| Canonical Field | P6 XER Source (TASKPRED) | MSP XML Source | Notes |
|---|---|---|---|
| `id` | Generated UUID | Generated UUID | |
| `predId` | Resolved from `pred_task_id` → canonical ID | Resolved from `PredecessorLink > PredecessorUID` → canonical ID | Requires ID lookup table |
| `succId` | Resolved from `task_id` → canonical ID | Resolved from parent `Task > UID` → canonical ID | |
| `type` | `pred_type`: `"PR_FS"` → `"FS"`, `"PR_SS"` → `"SS"`, `"PR_FF"` → `"FF"`, `"PR_SF"` → `"SF"` | `PredecessorLink > Type`: `0→FF, 1→FS, 2→SF, 3→SS` | Unknown type → `FS` + warning |
| `lag` | `lag_hr_cnt / 8` → integer days | `PredecessorLink > LinkLag` → tenths of minutes → days | Fractional → rounded + warning |

#### Resources

| Canonical Field | P6 XER Source (RSRC) | MSP XML Source | Notes |
|---|---|---|---|
| `id` | Generated UUID | Generated UUID | |
| `name` | `rsrc_name` | `Resource > Name` | |
| `maxUnitsPerDay` | `max_qty_per_hr * 8` | `Resource > MaxUnits / 100` (percent → decimal) | Default `1` if absent |

#### Assignments

| Canonical Field | P6 XER Source (TASKRSRC) | MSP XML Source | Notes |
|---|---|---|---|
| `id` | Generated UUID | Generated UUID | |
| `taskId` | Resolved from `task_id` → canonical | Resolved from `Assignment > TaskUID` → canonical | |
| `resourceId` | Resolved from `rsrc_id` → canonical | Resolved from `Assignment > ResourceUID` → canonical | |
| `unitsPerDay` | `target_qty_per_hr * 8` | `Assignment > Units / 100` | Default `1` if absent |

#### Calendars

| Canonical Concept | P6 XER Source | MSP XML Source | Notes |
|---|---|---|---|
| `projectStartDate` | `PROJECT.plan_start_date` | `Project > StartDate` | ISO date string |
| `excludeWeekends` | Inferred from `CLNDR.clndr_data` standard workweek | Inferred from `Calendar > WeekDays` | Best-effort boolean |
| Non-working days | `CLNDR.clndr_data` holiday/exception entries → day-offsets | `Calendar > Exceptions` → day-offsets | Mapped to `nonWorkingDays` array |

**Calendar limitation:** The canonical model currently supports a single global calendar (`excludeWeekends` + `nonWorkingDays` array). P6 and MSP both support per-task and per-resource calendars. In Phase W, all tasks are mapped to the **project-level default calendar**. Task-specific or resource-specific calendar assignments emit an `info`-level diagnostic noting the simplification.

#### Project Metadata / Schedule Settings

| Canonical Concept | P6 XER Source | MSP XML Source |
|---|---|---|
| `projectStartDate` | `PROJECT.plan_start_date` | `Project > StartDate` |
| Project name | `PROJECT.proj_short_name` (display only) | `Project > Name` (display only) |
| Hours per day | `PROJECT.day_hr_cnt` (used for duration conversion) | `Project > MinutesPerDay / 60` |

### 3.3 External ID Preservation

All external IDs (`task_id`, `UID`, `rsrc_id`, etc.) are **not** used as canonical IDs. The mapper generates fresh UUIDs for all canonical entities. A bidirectional ID lookup table is built during mapping:

```
ExternalIdMap = {
  tasks: Map<ExternalId, CanonicalId>;
  resources: Map<ExternalId, CanonicalId>;
}
```

This map is used internally during mapping to resolve dependency and assignment references. It is included in the `ImportCandidate` for diagnostics and potential re-export, but is **not persisted** in Phase W.

### 3.4 Unsupported Fields

Fields present in external formats but absent from the canonical model are **not silently dropped**. Each unsupported field category emits an `info`-level diagnostic. Key examples:

| Unsupported Feature | Format | Diagnostic |
|---|---|---|
| Percent complete / actual dates | P6, MSP | `UNSUPPORTED_ACTUALS` — actuals tracking not yet supported |
| Cost / budget data | P6, MSP | `UNSUPPORTED_COST` — cost model not in scope |
| Per-task calendars | P6, MSP | `UNSUPPORTED_TASK_CALENDAR` — mapped to project calendar |
| Per-resource calendars | P6, MSP | `UNSUPPORTED_RESOURCE_CALENDAR` — mapped to project calendar |
| Resource rates / cost tables | P6, MSP | `UNSUPPORTED_COST` |
| Task codes / UDFs | P6 | `UNSUPPORTED_CUSTOM_FIELDS` |
| Extended attributes | MSP | `UNSUPPORTED_CUSTOM_FIELDS` |
| Multiple projects in one XER | P6 | `MULTI_PROJECT_XER` — first project used, others skipped |
| Leveling delay | P6, MSP | `UNSUPPORTED_LEVELING` |
| Task splits / interruptions | MSP | `UNSUPPORTED_TASK_SPLITS` |
| Recurring tasks | MSP | `UNSUPPORTED_RECURRING` |
| Deadline dates | MSP | `UNSUPPORTED_DEADLINE` — not modeled as constraint |

---

## 4. Import Diagnostics Strategy

### 4.1 Diagnostic Categories

Import diagnostics extend the existing `DiagnosticsMap` architecture with new diagnostic codes organized into three categories:

| Category | When Emitted | Severity | Examples |
|---|---|---|---|
| **Parse Error** | Raw file parsing fails or is structurally invalid | `error` | Malformed XER header, corrupt XML, missing required table |
| **Mapping Warning** | External data maps lossily to canonical | `warning` | Constraint type approximated, fractional duration rounded, lag rounded |
| **Unsupported Feature Notice** | External data references features the canonical model lacks | `info` | Actuals skipped, cost data skipped, per-task calendar simplified |

### 4.2 Diagnostic Code Design

New import-specific diagnostic codes are added as a separate union type to avoid polluting the existing `ConstraintDiagnosticCode`:

```
ImportDiagnosticCode =
  // Parse errors
  | "PARSE_MALFORMED_HEADER"
  | "PARSE_MISSING_TABLE"
  | "PARSE_INVALID_ROW"
  | "PARSE_XML_STRUCTURE"
  // Mapping warnings
  | "CONSTRAINT_APPROXIMATED"
  | "DURATION_FRACTIONAL_ROUNDED"
  | "LAG_FRACTIONAL_ROUNDED"
  | "DEPENDENCY_TYPE_UNKNOWN"
  | "CALENDAR_SIMPLIFIED"
  | "MULTI_PROJECT_XER"
  // Unsupported features
  | "UNSUPPORTED_ACTUALS"
  | "UNSUPPORTED_COST"
  | "UNSUPPORTED_TASK_CALENDAR"
  | "UNSUPPORTED_RESOURCE_CALENDAR"
  | "UNSUPPORTED_CUSTOM_FIELDS"
  | "UNSUPPORTED_LEVELING"
  | "UNSUPPORTED_TASK_SPLITS"
  | "UNSUPPORTED_RECURRING"
  | "UNSUPPORTED_DEADLINE"
```

### 4.3 Import Diagnostic Shape

Each import diagnostic carries richer context than existing constraint diagnostics:

```
ImportDiagnostic = {
  code: ImportDiagnosticCode;
  severity: DiagnosticSeverity;       // "error" | "warning" | "info"
  message: string;                    // Human-readable explanation
  sourceEntityId?: string;            // External ID of the affected entity
  canonicalEntityId?: string;         // Canonical ID (if mapping succeeded)
  field?: string;                     // Specific field name
  originalValue?: string;             // The external value before mapping
  mappedValue?: string;               // The canonical value after mapping
}
```

### 4.4 Integration with Existing Diagnostics

Import diagnostics are **separate from runtime constraint diagnostics**.

- Runtime `DiagnosticsMap` (keyed by task ID, containing `ConstraintDiagnosticCode[]`) is recomputed after import when scheduling runs. It reflects the _current state_ of the imported data.
- Import diagnostics are attached to the `ImportCandidate` and surfaced in the preview/review flow. They describe what happened _during_ the import mapping — the delta between external data and canonical representation.
- Per `ENGINEERING_RULES.md` ("Separate Canonical from Derived"), import diagnostics are **derived, non-persisted** data. They exist only in the preview flow and in the `IMPORT_SCHEDULE` command response. They are not stored in `PersistedState`.

### 4.5 No Silent Data Loss

The mapping pipeline enforces a **completeness invariant**: every top-level entity-bearing table/element in the parsed data must either:

1. Map to a canonical entity, or
2. Emit at least one diagnostic explaining why it was skipped or simplified.

The mapper maintains a counter: `{ mapped: number, warned: number, skipped: number }` per entity type. These counts are included in the parsed summary shown to the user.

---

## 5. Transaction Boundary

### 5.1 Interaction with Undo/Redo

The `IMPORT_SCHEDULE` command produces **one undo entry** in the `UndoHistory` stack.

The undo transaction for an import works by **full state snapshot**, not by inverse-command replay:

| Approach | When Used | Tradeoff |
|---|---|---|
| Inverse commands (current undo model) | Individual task/dep/resource mutations | Efficient for single edits; impractical for bulk import of N entities (N×3 inverse commands) |
| Full state snapshot | `IMPORT_SCHEDULE` only | Slightly higher memory; one snapshot pair regardless of import size |

Before applying the import, the Worker captures a `StateSnapshot` (tasks, dependencies, resources, assignments, baselines). The undo entry stores:

```
HistoryEntry = {
  undo: RESTORE_FULL_STATE(preImportSnapshot),
  redo: IMPORT_SCHEDULE(importPayload)
}
```

This uses a new internal-only command type `RESTORE_FULL_STATE` (analogous to the existing internal `RESTORE_BASELINES`), which replaces all canonical arrays atomically.

The redo side stores the full `IMPORT_SCHEDULE` payload so that redo re-applies the import without re-parsing.

### 5.2 Replace vs. Merge

**Phase W implements replace-only semantics.** An import replaces the entire project state:

- All existing tasks, dependencies, resources, and assignments are replaced.
- Baselines are cleared (the imported project starts with no baseline).
- Undo history before the import is preserved — undoing the import restores the previous project.

Merge semantics (adding imported activities into an existing project) are a future capability and explicitly out of scope for Phase W. Merge introduces ID reconciliation, conflict resolution, and partial-graph scheduling problems that warrant their own design phase.

### 5.3 Atomicity

The import mutation is **all-or-nothing**:

1. Worker validates the entire `ImportCandidate`.
2. If validation fails, `NACK` is emitted. No state change occurs.
3. If validation passes, Worker captures pre-import snapshot, then replaces state atomically.
4. Worker runs scheduling. If scheduling fails (e.g., cycle detected in imported dependencies), the Worker **rolls back** to the pre-import snapshot and emits a `NACK` with the scheduling error.
5. Only if scheduling succeeds does the import commit — history entry is pushed, persistence is triggered, and `DIFF_STATE` is emitted.

---

## 6. Preview / Review Flow

### 6.1 Recommended UX Flow

```
┌──────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  File Select │ ──→ │  Parse +     │ ──→ │  Preview Panel    │ ──→ │  Confirm     │
│  / Drop      │     │  Map Preview │     │  (Diagnostics)    │     │  Import      │
└──────────────┘     └──────────────┘     └───────────────────┘     └──────────────┘
       UI                 Worker                   UI                    Worker
```

#### Step 1: File Select / Drop

React provides a file input or drop zone. On file selection, React reads the file as text (`FileReader.readAsText`) and dispatches a preview command:

```
{ type: "PREVIEW_IMPORT", v: 1, reqId, payload: { format: "xer" | "msp-xml", content: string } }
```

`PREVIEW_IMPORT` is a **read-only** command — it does not mutate canonical state, does not enter the undo stack, and does not trigger scheduling. It is a query to the Worker for parse + map analysis.

#### Step 2: Worker Parses and Maps

The Worker receives `PREVIEW_IMPORT`, runs the parser, then the mapper, then emits:

```
{
  type: "IMPORT_PREVIEW",
  v: 1,
  reqId: string,
  payload: {
    projectName: string;
    projectStartDate: string;
    summary: {
      taskCount: number;
      dependencyCount: number;
      resourceCount: number;
      assignmentCount: number;
      calendarInfo: string;         // e.g., "5-day workweek, 3 holidays"
    };
    diagnostics: ImportDiagnostic[];
    diagnosticsSummary: {
      errors: number;
      warnings: number;
      infos: number;
    };
    canCommit: boolean;             // false if any error-severity diagnostics exist
  }
}
```

The Worker does **not** store the parsed data in canonical state at this point. It holds the `ImportCandidate` in a temporary variable, discarded if the user cancels or selects a different file.

#### Step 3: Preview Panel

React renders:

- Project name and start date from the import source.
- Entity counts (tasks, dependencies, resources, assignments).
- Calendar summary.
- Diagnostics list, grouped by severity (errors first, then warnings, then info).
- A clear "Import" button, disabled if `canCommit === false`.
- A "Cancel" button.

The preview panel replaces no existing UI — it is a modal or side-panel overlay.

#### Step 4: Confirm Import

On user confirmation, React dispatches:

```
{ type: "IMPORT_SCHEDULE", v: 1, reqId }
```

The `IMPORT_SCHEDULE` command carries no payload — it tells the Worker to commit the `ImportCandidate` it is holding from the preview step. This avoids re-transmitting the entire file content across the postMessage boundary.

The Worker:

1. Validates that a pending `ImportCandidate` exists (NACK if stale/absent).
2. Captures pre-import `StateSnapshot`.
3. Replaces canonical state with `ImportCandidate` data.
4. Runs scheduling.
5. On success: pushes undo entry, persists, emits `DIFF_STATE` + `ACK`.
6. On failure: rolls back to snapshot, emits `NACK` with error.

### 6.2 Cancellation

If the user cancels, React dispatches:

```
{ type: "CANCEL_IMPORT_PREVIEW", v: 1, reqId }
```

The Worker discards the pending `ImportCandidate` and emits `ACK`. No state change occurs.

### 6.3 Staleness Guard

If a new `PREVIEW_IMPORT` arrives while a previous `ImportCandidate` is pending, the old candidate is silently replaced. Only one import preview can be active at a time.

---

## 7. Rollout Plan

### W.1 — Import Protocol Contracts + Architecture Seams

**Scope:**
- Define `PREVIEW_IMPORT`, `IMPORT_SCHEDULE`, `CANCEL_IMPORT_PREVIEW` command types in protocol.
- Define `IMPORT_PREVIEW` worker message type in protocol.
- Define `ImportDiagnosticCode`, `ImportDiagnostic`, and `ImportCandidate` types.
- Define `ParseError`, `ParseWarning`, `XerParseResult`, `MspXmlParseResult` types.
- Add `RESTORE_FULL_STATE` internal command type for undo/redo.
- Create directory structure under `packages/worker/src/import/`.
- No parser or mapper implementation. Type stubs only.

**Tests:** Type-level compilation checks, mock instantiation tests.

### W.2 — P6 XER Parser + Preview Flow

**Scope:**
- Implement `xerParser.ts` — parse XER text format into typed row objects.
- Implement `PREVIEW_IMPORT` command handling in Worker.
- Wire file-read and preview dispatch in React (file select UI + preview panel).
- Emit `IMPORT_PREVIEW` message with parsed summary.
- Parser unit tests against sample XER files.
- No mapping, no canonical mutation.

**Tests:** Parser correctness tests, preview round-trip integration test.

### W.3 — XER Canonical Mapping + Diagnostics

**Scope:**
- Implement `xerMapper.ts` — map XER parsed data to `ImportCandidate`.
- Full diagnostic emission for all mapping decisions.
- Validate completeness invariant (no silent skips).
- Enhance `IMPORT_PREVIEW` to include mapped summary + diagnostics.
- Preview panel renders diagnostics grouped by severity.

**Tests:** Mapper unit tests, diagnostic completeness tests.

### W.4 — Atomic Import Command + Undo/Redo

**Scope:**
- Implement `IMPORT_SCHEDULE` command handling in Worker.
- Implement `RESTORE_FULL_STATE` for undo reverse.
- Full state snapshot before import, rollback on scheduling failure.
- Single undo entry for entire import.
- Persistence of imported state.
- `CANCEL_IMPORT_PREVIEW` handling.

**Tests:** Import + undo + redo round-trip tests, rollback on cycle error tests.

### W.5 — MSP XML Parser + Mapper

**Scope:**
- Implement `mspXmlParser.ts`.
- Implement `mspXmlMapper.ts`.
- Reuse preview/import/undo infrastructure from W.2–W.4.
- Format-specific diagnostic codes for MSP.

**Tests:** Parser + mapper tests against sample MSP XML files.

### W.6 — Export Architecture (Design Only)

**Scope:**
- Architecture spec for exporting canonical model to XER and MSP XML.
- Define export as a read-only projection (no state mutation).
- Export runs in Worker, file download triggered by React.
- Design spec only — implementation deferred.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Silent data loss** — external field maps to nothing without user awareness | High | Critical | Completeness invariant in mapper (§4.5). Every entity must map or emit diagnostic. Summary counts must reconcile. |
| R2 | **Calendar mismatch** — P6/MSP multi-calendar projects simplified to single global calendar | High | Medium | Emit `CALENDAR_SIMPLIFIED` diagnostic per affected task. Document limitation prominently in preview. Project-level calendar used as default; per-task calendars are Phase Z+ scope. |
| R3 | **Unsupported constraint semantics** — P6 has constraint types (FNET, SNLT) with no exact canonical equivalent | Medium | Medium | Map to closest canonical type + emit `CONSTRAINT_APPROXIMATED` with original and mapped values. User can review and adjust post-import. |
| R4 | **ID collisions** — external IDs clash with existing canonical IDs | Low | High | Mitigated by design: mapper generates fresh UUIDs for all canonical entities (§3.3). External IDs are never used as canonical IDs. |
| R5 | **Huge-file performance** — XER/XML files > 10 MB cause Worker thread to block, freezing the UI | Medium | Medium | Size gate at 50 MB (§2.2). Parsing benchmarking during W.2. If profiling shows >500ms parse times for typical files, introduce chunked parsing or sub-worker in a follow-up. |
| R6 | **Partial import corruption** — import half-applied if Worker crashes mid-mutation | Low | Critical | Atomic transaction (§5.3). Full pre-import snapshot taken before any mutation. Any scheduling failure triggers rollback. State is only committed after successful scheduling. |
| R7 | **Dependency cycle in imported data** — external schedule contains cycles the kernel rejects | Medium | Medium | Scheduling runs immediately after state replacement. If kernel returns `CycleDetected`, full rollback occurs. Diagnostic included in `NACK` error. User must fix the external file. |
| R8 | **Duration conversion precision** — P6 hours-based durations lose precision when converted to integer working days | Medium | Low | Round to nearest integer working day. Emit `DURATION_FRACTIONAL_ROUNDED` warning with original and rounded values. |
| R9 | **Multi-project XER files** — P6 exports can contain multiple projects in one XER | Medium | Low | First project selected by default. `MULTI_PROJECT_XER` diagnostic emitted. Future: project selector in preview UI. |
| R10 | **Stale preview state** — user modifies project, then confirms a previously-parsed import preview | Low | Medium | `IMPORT_SCHEDULE` validates that a pending `ImportCandidate` exists. Staleness guard (§6.3) ensures only most recent preview is committable. |

---

## 9. Explicit Non-Goals

The following are **out of scope** for Phase W first rollout:

| Non-Goal | Rationale |
|---|---|
| **Export implementation** | W.6 is design-only. Export code is deferred. |
| **Merge import** (add to existing project) | Merge requires ID reconciliation and partial-graph conflict resolution. Replace-only in W. |
| **Per-task or per-resource calendars** | Canonical model supports only a single global calendar. Multi-calendar is a model extension, not an import concern. |
| **Actuals / progress tracking** | No canonical concept of percent complete or actual dates exists. Import skips actuals with diagnostic. |
| **Cost data** | No canonical cost model. Skipped with diagnostic. |
| **Streaming / chunked parsing** | Not needed until profiling proves otherwise. Size gate protects against extreme cases. |
| **Sub-worker for parsing** | Complexity unjustified without profiling evidence. Revisit if W.2 benchmarks show >500ms parse for typical files. |
| **Custom field / UDF mapping** | No canonical custom-field model. Skipped with diagnostic. |
| **Kernel changes** | Kernel remains untouched. All import logic is Worker-side. |
| **Domain model extensions** | `AssumptionSet`, `AuthoredActivity`, and the domain compiler are not involved in the import path. Import targets the flat canonical types (`Task`, `Dependency`, `Resource`, `Assignment`). Domain model integration is a separate future concern. |
| **AI-assisted field mapping** | AI import assistance is a future capability under AI governance rules. |
| **Round-trip fidelity guarantee** | Import → Export → Import is not guaranteed to be lossless. |

---

## 10. Recommendation

### Safest First Implementation Slice

**Milestone W.1 — Import Protocol Contracts + Architecture Seams**

### Why W.1 Should Come First

1. **Zero runtime risk.** W.1 is type definitions and directory scaffolding only. No behavioral changes, no new runtime code, no state mutations.

2. **Establishes the contract boundary.** Every subsequent milestone (W.2–W.5) depends on the command types, message types, and diagnostic types defined in W.1. Defining these first prevents mid-flight protocol design churn.

3. **Validates architectural alignment.** W.1 forces explicit decisions about command shapes, message payloads, and diagnostic codes to be made against the governance documents _before_ any parser code exists. Any conflicts between the import design and the Product Constitution / Architecture Boundaries / Engineering Rules surface at the cheapest possible moment.

4. **Enables parallel work.** Once W.1 lands, parser implementation (W.2) and mapper implementation (W.3) can be developed and tested against concrete types, with clear interface boundaries.

5. **Follows the established pattern.** This mirrors the M02 precedent: protocol contracts first, implementation second. The project has validated this approach.

### Next Milestone Name

**`W.1 — Import Protocol Contracts`**

### Exact Deliverables for W.1

- `packages/protocol/src/import.ts` — all import-related type definitions
- `packages/worker/src/import/` directory with type stubs
- Protocol `Command` union extended with `PREVIEW_IMPORT`, `IMPORT_SCHEDULE`, `CANCEL_IMPORT_PREVIEW`
- `WorkerMessage` union extended with `IMPORT_PREVIEW`
- Type compilation tests
- Milestone document at `docs/milestones/W01-import-protocol-contracts.md`
