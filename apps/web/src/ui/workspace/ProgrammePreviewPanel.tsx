import { ImportPreviewPanel, type ImportPreviewData } from '../../components/ImportPreviewPanel';

interface ProgrammePreviewPanelProps {
  data: ImportPreviewData;
  onImport: () => void;
  onCancel: () => void;
}

export function ProgrammePreviewPanel({ data, onImport, onCancel }: ProgrammePreviewPanelProps) {
  return (
    <div className="r3-programme-preview-panel">
      <ImportPreviewPanel data={data} onImport={onImport} onCancel={onCancel} />
    </div>
  );
}
