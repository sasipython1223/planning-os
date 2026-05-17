interface CommandToolbarProps {
  onImport: () => void;
  onLoadToWorkspace: () => void;
  onToggleInspector: () => void;
  onToggleDiagnostics: () => void;
  hasPreview: boolean;
  hasLoadedData: boolean;
  inspectorOpen: boolean;
  diagnosticsOpen: boolean;
  workerReady: boolean;
}

export function CommandToolbar({
  onImport,
  onLoadToWorkspace,
  onToggleInspector,
  onToggleDiagnostics,
  hasPreview,
  hasLoadedData,
  inspectorOpen,
  diagnosticsOpen,
  workerReady,
}: CommandToolbarProps) {
  return (
    <div className="r3-command-toolbar">
      <button type="button" onClick={onImport} disabled={!workerReady}>Import XER/MSP</button>
      <button type="button" onClick={onLoadToWorkspace} disabled={!hasPreview}>Load to Workspace</button>
      <button type="button" onClick={onToggleInspector} disabled={!hasLoadedData}>
        {inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
      </button>
      <button type="button" onClick={onToggleDiagnostics}>
        {diagnosticsOpen ? 'Hide Diagnostics' : 'Show Diagnostics'}
      </button>
    </div>
  );
}
