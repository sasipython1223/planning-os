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
