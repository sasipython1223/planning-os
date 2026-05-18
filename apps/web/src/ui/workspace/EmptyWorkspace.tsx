interface EmptyWorkspaceProps {
  onImport: () => void;
}

export function EmptyWorkspace({ onImport }: EmptyWorkspaceProps) {
  return (
    <div className="r3-empty-workspace">
      <div className="r4-empty-workspace-icon" aria-hidden="true">📂</div>
      <h2 className="r4-empty-workspace-heading">No Programme Loaded</h2>
      <p className="r4-empty-workspace-description">
        Import a schedule file to preview and load programme data into the workspace.
      </p>
      <button type="button" className="r4-empty-import-btn" onClick={onImport}>
        ↑ Import XER / MSP File
      </button>
      <div className="r4-empty-workspace-formats">
        <span className="r4-format-pill">XER — Primavera P6</span>
        <span className="r4-format-pill">XML — MS Project</span>
      </div>
    </div>
  );
}
