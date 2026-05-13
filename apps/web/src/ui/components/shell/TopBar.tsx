import type { CSSProperties } from 'react';
import { useUIStore } from '../../store/uiStore';

const isDevOrTestMode = (
  env: { DEV?: boolean; MODE?: string } = import.meta.env,
): boolean => env.DEV === true || env.MODE === 'test';

const unknownText = '\u2014';

function getAuthorityBadgeLabel(input: {
  currentAuthorityEngineMode: 'slot_authoritative' | 'slot_fallback' | 'temporal_authoritative' | 'temporal_candidate_only';
  candidateProjectionAvailable: boolean;
}): 'Slot authoritative' | 'Temporal candidate' | 'Temporal authoritative' | 'Slot fallback' {
  if (input.currentAuthorityEngineMode === 'temporal_authoritative') {
    return 'Temporal authoritative';
  }
  if (input.currentAuthorityEngineMode === 'temporal_candidate_only') {
    return 'Temporal candidate';
  }
  if (input.currentAuthorityEngineMode === 'slot_fallback') {
    return 'Slot fallback';
  }
  if (input.candidateProjectionAvailable) {
    return 'Temporal candidate';
  }
  return 'Slot authoritative';
}

function getBadgeStyle(label: string): CSSProperties {
  if (label === 'Temporal authoritative') {
    return { borderColor: '#176b34', color: '#176b34', background: '#dff7e7' };
  }
  if (label === 'Temporal candidate') {
    return { borderColor: '#0f4f8a', color: '#0f4f8a', background: '#e1f0ff' };
  }
  if (label === 'Slot fallback') {
    return { borderColor: '#8a3a00', color: '#8a3a00', background: '#ffe9db' };
  }
  return { borderColor: '#5a5d67', color: '#3b3e45', background: '#eceef2' };
}

/** Top bar — 36px chrome with app title and status. */
export function TopBar() {
  const statusText = useUIStore((s) => s.statusText);
  const diagnostics = useUIStore((s) => s.temporalAuthorityDiagnostics);
  const showDiagnostics = isDevOrTestMode() && diagnostics != null;

  const authorityBadgeLabel = diagnostics
    ? getAuthorityBadgeLabel({
        currentAuthorityEngineMode: diagnostics.currentAuthorityEngineMode,
        candidateProjectionAvailable: diagnostics.candidateProjectionAvailable,
      })
    : null;

  return (
    <div className="topbar">
      <span className="topbar-title">Planning OS</span>
      {showDiagnostics && authorityBadgeLabel && (
        <details className="topbar-authority-panel">
          <summary
            className="topbar-authority-badge"
            style={getBadgeStyle(authorityBadgeLabel)}
            aria-label="Temporal authority diagnostics"
          >
            {authorityBadgeLabel}
          </summary>
          <div className="topbar-authority-grid">
            <span>Ring</span>
            <span>{diagnostics.rolloutRing}</span>
            <span>Apply mode</span>
            <span>{diagnostics.applyMode}</span>
            <span>Source protection</span>
            <span>{diagnostics.sourceProtectionStatus}</span>
            <span>Fallback reason</span>
            <span>{diagnostics.fallbackReason ?? unknownText}</span>
            <span>Candidate run</span>
            <span>{diagnostics.lastTemporalCandidateRunId ?? unknownText}</span>
            <span>Authority run</span>
            <span>{diagnostics.lastTemporalAuthorityRunId ?? unknownText}</span>
            <span>WASM gate</span>
            <span>
              {diagnostics.realWasmValidationPassed == null
                ? unknownText
                : diagnostics.realWasmValidationPassed
                  ? 'passed'
                  : 'failed'}
              {' / '}
              {diagnostics.wasmLoadMode}
            </span>
            <span>Persistence</span>
            <span>{diagnostics.persistenceApplied ? 'applied' : 'runtime-only'}</span>
          </div>
          <p className="topbar-authority-safety-copy">
            Imported Source Dates are immutable references. Slot-Calculated Dates are current authoritative output.
            Temporal-Calculated Dates are candidate or authority diagnostics only.
          </p>
        </details>
      )}
      {statusText && (
        <span className="topbar-status">
          {statusText}
        </span>
      )}
    </div>
  );
}
