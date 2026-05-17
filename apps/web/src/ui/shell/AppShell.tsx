import type { ReactNode } from 'react';

interface AppShellProps {
  menuBar: ReactNode;
  commandBar: ReactNode;
  statusStrip: ReactNode;
  children: ReactNode;
}

export function AppShell({ menuBar, commandBar, statusStrip, children }: AppShellProps) {
  return (
    <div className="r3-app-shell">
      {menuBar}
      {commandBar}
      {statusStrip}
      <div className="r3-app-shell-workspace">{children}</div>
    </div>
  );
}
