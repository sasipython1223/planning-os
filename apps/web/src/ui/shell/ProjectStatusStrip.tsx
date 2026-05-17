interface ProjectStatusStripProps {
  projectName: string;
  fileName: string;
  activityCount: number;
  dependencyCount: number;
  warningCount: number;
  viewState: 'empty' | 'preview' | 'loaded';
  workerReady: boolean;
  ganttScrollInfo?: string;
}

export function ProjectStatusStrip({
  projectName,
  fileName,
  activityCount,
  dependencyCount,
  warningCount,
  viewState,
  workerReady,
  ganttScrollInfo,
}: ProjectStatusStripProps) {
  return (
    <div className="r3-project-status-strip" role="status" aria-live="polite">
      <span>Project: {projectName}</span>
      <span>File: {fileName}</span>
      <span>Activities: {activityCount}</span>
      <span>Dependencies: {dependencyCount}</span>
      <span>Warnings: {warningCount}</span>
      <span>View: {viewState}</span>
      <span>Worker: {workerReady ? 'Ready' : 'Starting'}</span>
      {ganttScrollInfo && <span>Gantt: {ganttScrollInfo}</span>}
    </div>
  );
}
