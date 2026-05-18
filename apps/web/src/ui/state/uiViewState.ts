export type WorkspaceShellView = 'empty' | 'preview' | 'loaded';

export interface WorkspaceShellViewInput {
  hasImportPreview: boolean;
  hasTasks: boolean;
}

export function deriveWorkspaceShellView(input: WorkspaceShellViewInput): WorkspaceShellView {
  if (input.hasImportPreview) {
    return 'preview';
  }

  if (input.hasTasks) {
    return 'loaded';
  }

  return 'empty';
}

export type ImportStatus = 'idle' | 'preview-ready' | 'warnings' | 'failed';

export interface ImportStatusInput {
  hasPreview: boolean;
  errorCount: number;
  warningCount: number;
}

export function deriveImportStatus(input: ImportStatusInput): ImportStatus {
  if (!input.hasPreview) return 'idle';
  if (input.errorCount > 0) return 'failed';
  if (input.warningCount > 0) return 'warnings';
  return 'preview-ready';
}
