import type { ReactNode } from 'react';
import { BottomDrawer } from '../components/drawer/BottomDrawer';

interface BottomDiagnosticsDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function BottomDiagnosticsDrawer({ isOpen, onToggle, children }: BottomDiagnosticsDrawerProps) {
  if (!isOpen) {
    return (
      <div className="r3-diagnostics-collapsed">
        <span>Diagnostics drawer</span>
        <button type="button" onClick={onToggle}>Open</button>
      </div>
    );
  }

  return <BottomDrawer>{children}</BottomDrawer>;
}
