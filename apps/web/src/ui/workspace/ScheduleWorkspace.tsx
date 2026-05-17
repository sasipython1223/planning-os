import type { ReactNode } from 'react';

interface ScheduleWorkspaceProps {
  children: ReactNode;
}

export function ScheduleWorkspace({ children }: ScheduleWorkspaceProps) {
  return <div className="r3-schedule-workspace">{children}</div>;
}
