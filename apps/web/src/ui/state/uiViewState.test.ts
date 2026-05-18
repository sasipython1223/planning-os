import { describe, expect, it } from 'vitest';
import { deriveWorkspaceShellView } from './uiViewState';

describe('deriveWorkspaceShellView', () => {
  it('returns preview when import preview data exists', () => {
    expect(deriveWorkspaceShellView({ hasImportPreview: true, hasTasks: false })).toBe('preview');
    expect(deriveWorkspaceShellView({ hasImportPreview: true, hasTasks: true })).toBe('preview');
  });

  it('returns loaded when tasks exist and preview is absent', () => {
    expect(deriveWorkspaceShellView({ hasImportPreview: false, hasTasks: true })).toBe('loaded');
  });

  it('returns empty when neither preview nor tasks exist', () => {
    expect(deriveWorkspaceShellView({ hasImportPreview: false, hasTasks: false })).toBe('empty');
  });
});
