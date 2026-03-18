import type { ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import { DrawerResizer } from './DrawerResizer';
import { DrawerTabBar } from './DrawerTabBar';

interface BottomDrawerProps {
  children: ReactNode;
}

/**
 * Push-layout bottom drawer. flex-shrink:0 ensures it claims fixed height
 * from WorkspaceContainer, shrinking MainWorkspace via flexbox.
 */
export function BottomDrawer({ children }: BottomDrawerProps) {
  const bottomHeight = useUIStore((s) => s.bottomHeight);

  return (
    <div
      style={{
        height: bottomHeight,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border-default, #ccc)',
        background: 'var(--bg-surface, #fafafa)',
      }}
    >
      <DrawerResizer />
      <DrawerTabBar />
      {/* DrawerContent: flex:1, overflow:hidden */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
