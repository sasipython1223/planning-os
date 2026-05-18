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
}: ProjectStatusStripProps) {
  return (
    <div className="r3-project-status-strip" role="status" aria-live="polite">
      <span>Project: {projectName}</span>
      <span>File: {fileName}</span>
      <span>Activities: {visibleActivityCount}/{activityCount}</span>
      <span>Dependencies: {dependencyCount}</span>
      <span>Warnings: {warningCount}</span>
      <span>Constraint Filter: {constraintFilter}</span>
      <span>View: {viewState}</span>
      <span>Worker: {workerReady ? 'Ready' : 'Starting'}</span>
    </div>
  );
}
