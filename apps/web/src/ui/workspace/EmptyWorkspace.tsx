interface EmptyWorkspaceProps {
  onImport: () => void;
}

export function EmptyWorkspace({ onImport }: EmptyWorkspaceProps) {
  return (
    <div className="r3-empty-workspace">
      <h2>No programme loaded</h2>
      <p>Import an XER or MSP file to start previewing and loading schedule data.</p>
      <button type="button" onClick={onImport}>Import XER/MSP</button>
    </div>
  );
}
