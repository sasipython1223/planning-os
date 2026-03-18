/**
 * @module commandEnvelope
 *
 * Internal Worker Command Spine — M03\n *\n * Phase 1: Envelope type, factory, and audit log seam.\n * Phase 2: handleCommand returns DispatchOutcome for accurate audit logging.
 *
 * Defines the CommandEnvelope that wraps every inbound protocol Command
 * with execution metadata. This is an internal worker concern — the
 * shared protocol Command type and WorkerMessage contracts are unchanged.
 *
 * ⚠️ INTERNAL TO WORKER — Do not export from protocol or expose to UI.
 *
 * This module prepares for future:
 *   - Audit event ledger (envelope provides structured metadata)
 *   - AI governance (issuerType distinguishes human vs. system origin)
 *   - Domain compiler integration (envelope is the dispatch seam)
 *   - Simulation branching (envelope carries correlation for tracing)
 *
 * None of those systems are implemented here. This module provides
 * only the envelope type, factory, and a minimal audit log seam.
 */

import type { Command } from "protocol";

// ─── Issuer Type ────────────────────────────────────────────────────

/**
 * Identifies the origin of a command.
 *
 * - "human": command issued via UI interaction (postMessage from main thread)
 * - "system": command issued internally (undo/redo replay, hydration, etc.)
 *
 * Future values (not yet implemented): "ai-agent", "external-api"
 */
export type IssuerType = "human" | "system";

// ─── Command Envelope ───────────────────────────────────────────────

/**
 * Internal execution wrapper for a protocol Command.
 *
 * The envelope carries metadata that the protocol Command intentionally
 * does not include (timestamps, correlation, origin tracking).
 * It is created at the worker's message boundary and discarded after
 * dispatch — it is never persisted or sent back to the UI.
 */
export type CommandEnvelope = {
  /** Unique identifier for this envelope instance. */
  readonly commandId: string;
  /** The original protocol command, unmodified. */
  readonly command: Command;
  /** Wall-clock timestamp (ms since epoch) when the envelope was created. */
  readonly receivedAt: number;
  /** Correlation ID for request tracing. Maps to command.reqId. */
  readonly correlationId: string;
  /** Origin of the command. */
  readonly issuerType: IssuerType;
};

// ─── Envelope Factory ───────────────────────────────────────────────

/** Monotonic counter for commandId uniqueness within a worker session. */
let envelopeSeq = 0;

/**
 * Create a CommandEnvelope from a protocol Command.
 *
 * @param command  - The original protocol Command
 * @param issuerType - Origin: "human" for UI-issued, "system" for internal replay
 */
export const createEnvelope = (command: Command, issuerType: IssuerType): CommandEnvelope => ({
  commandId: `env-${++envelopeSeq}`,
  command,
  receivedAt: Date.now(),
  correlationId: command.reqId,
  issuerType,
});

// ─── Audit Log Seam ─────────────────────────────────────────────────

/**
 * Dispatch outcome recorded at the audit seam.
 *
 * - "ack": command was accepted and applied
 * - "nack": command was rejected (validation failure, not-found, etc.)
 * - "error": command caused a schedule error (rollback may have occurred)
 */
export type DispatchOutcome = "ack" | "nack" | "error";

/**
 * Minimal audit log seam. Called after every dispatch cycle completes.
 *
 * Currently logs to console. This is the single attachment point where
 * a future audit event ledger, telemetry sink, or governance hook
 * replaces the console.log call — one line of code, zero structural change.
 *
 * @param envelope - The envelope that was dispatched
 * @param outcome  - Result of the dispatch
 */
export const auditLog = (envelope: CommandEnvelope, outcome: DispatchOutcome): void => {
  console.log(
    "[AUDIT]",
    envelope.commandId,
    envelope.command.type,
    outcome,
    envelope.issuerType,
    `corr=${envelope.correlationId}`,
  );
};

/**
 * Reset envelope sequence counter. For testing only.
 * @internal
 */
export const _resetEnvelopeSeq = (): void => {
  envelopeSeq = 0;
};
