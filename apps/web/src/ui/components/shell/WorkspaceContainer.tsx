import type { ReactNode } from 'react';

interface WorkspaceContainerProps {
  children: ReactNode;
}

/**
 * Flex-column container holding MainWorkspace + optional BottomDrawer.
 * min-height:0 is critical so flexbox can shrink MainWorkspace when the drawer opens.
 */
export function WorkspaceContainer({ children }: WorkspaceContainerProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}
