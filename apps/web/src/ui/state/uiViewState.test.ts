import { describe, expect, it } from 'vitest';
import { deriveWorkspaceShellView, deriveImportStatus } from './uiViewState';

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

describe('deriveImportStatus', () => {
  it('returns idle when no preview is present', () => {
    expect(deriveImportStatus({ hasPreview: false, errorCount: 0, warningCount: 0 })).toBe('idle');
    expect(deriveImportStatus({ hasPreview: false, errorCount: 3, warningCount: 2 })).toBe('idle');
  });

  it('returns failed when errors are present in preview', () => {
    expect(deriveImportStatus({ hasPreview: true, errorCount: 1, warningCount: 0 })).toBe('failed');
    expect(deriveImportStatus({ hasPreview: true, errorCount: 5, warningCount: 3 })).toBe('failed');
  });

  it('returns warnings when warnings are present but no errors', () => {
    expect(deriveImportStatus({ hasPreview: true, errorCount: 0, warningCount: 1 })).toBe('warnings');
    expect(deriveImportStatus({ hasPreview: true, errorCount: 0, warningCount: 7 })).toBe('warnings');
  });

  it('returns preview-ready when preview has no errors or warnings', () => {
    expect(deriveImportStatus({ hasPreview: true, errorCount: 0, warningCount: 0 })).toBe('preview-ready');
  });
});
