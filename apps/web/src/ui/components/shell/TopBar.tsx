import { useUIStore } from '../../store/uiStore';

/** Top bar — 36px chrome with app title and status. */
export function TopBar() {
  const statusText = useUIStore((s) => s.statusText);

  return (
    <div className="topbar">
      <span className="topbar-title">Planning OS</span>
      {statusText && (
        <span className="topbar-status">
          {statusText}
        </span>
      )}
    </div>
  );
}
