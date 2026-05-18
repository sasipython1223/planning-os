import type { ReactNode } from 'react';

interface WorkspaceLayoutProps {
  showInspector: boolean;
  inspector: ReactNode;
  children: ReactNode;
}

export function WorkspaceLayout({ showInspector, inspector, children }: WorkspaceLayoutProps) {
  return (
    <div className="r3-workspace-layout">
      <div className="r3-workspace-main">{children}</div>
      {showInspector && <div className="r3-workspace-inspector">{inspector}</div>}
    </div>
  );
}
