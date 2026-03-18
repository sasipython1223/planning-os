import { useUIStore } from '../../store/uiStore';

/** Top bar — 36px chrome with app title and status. */
export function TopBar() {
  const statusText = useUIStore((s) => s.statusText);

  return (
    <div
      style={{
        height: 36,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        borderBottom: '1px solid var(--border-default, #ccc)',
        background: 'var(--bg-secondary, #f5f5f5)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span>Planning OS</span>
      {statusText && (
        <span style={{ fontSize: 11, fontWeight: 400, color: '#666' }}>
          {statusText}
        </span>
      )}
    </div>
  );
}
