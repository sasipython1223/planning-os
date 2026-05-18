interface ProjectStatusStripProps {
  projectName: string;
  fileName: string;
  activityCount: number;
  visibleActivityCount: number;
  dependencyCount: number;
  warningCount: number;
  constraintFilter: string;
  viewState: 'empty' | 'preview' | 'loaded';
  workerReady: boolean;
  importFormat?: string;
  importErrorCount?: number;
}

export function ProjectStatusStrip({
  projectName,
  fileName,
  activityCount,
  visibleActivityCount,
  dependencyCount,
  warningCount,
  constraintFilter,
  viewState,
  workerReady,
  importFormat,
  importErrorCount,
}: ProjectStatusStripProps) {
  return (
    <div className="r3-project-status-strip" role="status" aria-live="polite">
      {viewState === 'preview' ? (
        <>
          <span className="r4-status-import-indicator">
            <span className="r4-status-import-label">Import Preview</span>
            {importFormat && <span className="r4-import-format-badge">{importFormat}</span>}
          </span>
          <span>Project: {projectName}</span>
          <span>File: {fileName}</span>
          {(importErrorCount ?? 0) > 0 ? (
            <span className="r4-status-error">
              {importErrorCount} error{importErrorCount !== 1 ? 's' : ''} — load blocked
            </span>
          ) : warningCount > 0 ? (
            <span className="r4-status-warning">
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="r4-status-ready">Ready to load</span>
          )}
        </>
      ) : (
        <>
          <span>Project: {projectName}</span>
          <span>File: {fileName}</span>
          {viewState === 'loaded' && (
            <>
              <span>Activities: {visibleActivityCount}/{activityCount}</span>
              <span>Dependencies: {dependencyCount}</span>
              {warningCount > 0 && <span className="r4-status-warning">Warnings: {warningCount}</span>}
              <span>Constraint Filter: {constraintFilter}</span>
            </>
          )}
        </>
      )}
      <span className="r4-status-worker">
        <span aria-hidden="true">{workerReady ? '● ' : '○ '}</span>
        {workerReady ? 'Ready' : 'Starting…'}
      </span>
    </div>
  );
}
