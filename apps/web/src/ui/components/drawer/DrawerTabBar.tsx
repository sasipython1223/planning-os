import { useUIStore, type BottomTab } from '../../store/uiStore';

const TABS: { key: BottomTab; label: string }[] = [
  { key: 'task-details', label: 'Task Details' },
  { key: 'histogram', label: 'Histogram' },
  { key: 'logs', label: 'Logs' },
];

export function DrawerTabBar() {
  const activeTab = useUIStore((s) => s.activeBottomTab);
  const setTab = useUIStore((s) => s.setActiveBottomTab);
  const toggle = useUIStore((s) => s.toggleBottomDrawer);

  return (
    <div
      style={{
        height: 28,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: '1px solid var(--border-default, #ccc)',
        background: 'var(--bg-secondary, #f5f5f5)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        paddingLeft: 8,
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          style={{
            padding: '4px 12px',
            background: activeTab === t.key ? 'var(--bg-primary, #fff)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === t.key ? '2px solid var(--accent, #1e88e5)' : '2px solid transparent',
            fontWeight: activeTab === t.key ? 600 : 400,
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            borderRadius: 0,
          }}
        >
          {t.label}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => toggle(false)}
        style={{
          marginRight: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 6px',
          fontFamily: 'inherit',
          borderRadius: 0,
        }}
        title="Close drawer"
      >
        ✕
      </button>
    </div>
  );
}
