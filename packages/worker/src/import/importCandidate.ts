/**
 * @module importCandidate
 *
 * Import Candidate — Worker-Internal Preview State
 *
 * The ImportCandidate holds the parsed + summarized result of a
 * PREVIEW_IMPORT command. It is held in a Worker-level variable
 * (not in canonical state) until the user confirms or cancels.
 *
 * ⚠️ INTERNAL TO WORKER — not exported from protocol, not persisted.
 *
 * Lifecycle:
 *   PREVIEW_IMPORT  → candidate created / replaced
 *   IMPORT_SCHEDULE → candidate consumed and committed (W.4)
 *   CANCEL_IMPORT_PREVIEW → candidate discarded
 *   New PREVIEW_IMPORT → previous candidate replaced (staleness guard)
 */

import type {
    Assignment,
    Dependency,
    ImportDiagnostic,
    ImportDiagnosticsSummary,
    ImportFormat,
    ImportSummary,
    Resource,
    Task,
} from "protocol";
import type { MspData } from "./types/mspTypes.js";
import type { XerData } from "./types/xerTypes.js";

// ─── Import Candidate ───────────────────────────────────────────────

/**
 * Held preview state for a pending import.
 * Created by the preview orchestrator, consumed by IMPORT_SCHEDULE (W.4).
 */
export type ImportCandidate = {
  readonly format: ImportFormat;
  readonly projectName: string;
  readonly projectStartDate: string;
  readonly summary: ImportSummary;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly diagnosticsSummary: ImportDiagnosticsSummary;
  readonly canCommit: boolean;
  /**
   * Raw parsed data, retained for the commit step (W.4).
   * The mapper will consume this when IMPORT_SCHEDULE is handled.
   * Format-specific — XER or MSP XML.
   */
  readonly rawData: XerData | MspData;
  /**
   * W.3: Mapped canonical entities from the mapper.
   * Present only when mapping succeeded (no fatal parse errors).
   * Consumed by IMPORT_SCHEDULE to replace canonical state (W.4).
   */
  readonly mappedTasks?: readonly Task[];
  readonly mappedDependencies?: readonly Dependency[];
  readonly mappedResources?: readonly Resource[];
  readonly mappedAssignments?: readonly Assignment[];
};

// ─── Held Preview State ─────────────────────────────────────────────

/**
 * Module-level held ImportCandidate.
 * Only one preview can be active at a time (staleness guard per spec §6.3).
 */
let pendingCandidate: ImportCandidate | null = null;

export function getPendingCandidate(): ImportCandidate | null {
  return pendingCandidate;
}

export function setPendingCandidate(candidate: ImportCandidate): void {
  pendingCandidate = candidate;
}

export function clearPendingCandidate(): void {
  pendingCandidate = null;
}
