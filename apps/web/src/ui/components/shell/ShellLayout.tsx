import type { ReactNode } from 'react';
import { useUIStore } from '../../store/uiStore';
import '../../styles/density.css';
import '../../styles/theme.css';
import '../../styles/tokens.css';

interface ShellLayoutProps {
  children: ReactNode;
}

/**
 * Root shell container. Applies data-theme and data-density at the
 * outermost DOM node so CSS semantic variables cascade to all children.
 * Full-viewport, no scroll of its own — scroll ownership stays with
 * the existing phantom/shared scroll track inside the workspace.
 */
export function ShellLayout({ children }: ShellLayoutProps) {
  const theme = useUIStore((s) => s.theme);
  const density = useUIStore((s) => s.density);

  return (
    <div
      data-theme={theme}
      data-density={density}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}
