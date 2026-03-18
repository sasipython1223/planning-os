import type { ReactNode } from 'react';

interface MainWorkspaceProps {
  children: ReactNode;
}

/**
 * Main workspace area — fills remaining vertical space.
 * Must NOT become a vertical scroll owner. Scroll ownership
 * stays with the existing phantom/shared scroll track.
 */
export function MainWorkspace({ children }: MainWorkspaceProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}
