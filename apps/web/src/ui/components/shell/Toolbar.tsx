import type { ConstraintFilter } from '../../../utils/filterByConstraint';
import { useUIStore } from '../../store/uiStore';

/**
 * Toolbar — 36px chrome with drawer toggles. Controls use 28px height.
 */
export function Toolbar() {
  const setActiveTab = useUIStore((s) => s.setActiveBottomTab);
  const isOpen = useUIStore((s) => s.isBottomOpen);
  const toggle = useUIStore((s) => s.toggleBottomDrawer);
  const activeTab = useUIStore((s) => s.activeBottomTab);
  const constraintFilter = useUIStore((s) => s.constraintFilter);
  const setConstraintFilter = useUIStore((s) => s.setConstraintFilter);

  return (
    <div
      style={{
        height: 36,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        gap: 8,
        borderBottom: '1px solid var(--border-default, #ccc)',
        background: 'var(--bg-surface, #fafafa)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
      }}
    >
      <button
        onClick={() => isOpen && activeTab === 'histogram' ? toggle(false) : setActiveTab('histogram')}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          background: isOpen && activeTab === 'histogram' ? 'var(--bg-primary, #fff)' : 'transparent',
          border: '1px solid var(--border-default, #ccc)',
          borderRadius: 4,
        }}
      >
        Histogram
      </button>
      <button
        onClick={() => isOpen && activeTab === 'logs' ? toggle(false) : setActiveTab('logs')}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          background: isOpen && activeTab === 'logs' ? 'var(--bg-primary, #fff)' : 'transparent',
          border: '1px solid var(--border-default, #ccc)',
          borderRadius: 4,
        }}
      >
        Logs
      </button>
      <span style={{ marginLeft: 8, color: '#888' }}>|</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
        <span style={{ color: '#666' }}>Constraint</span>
        <select
          value={constraintFilter}
          onChange={(e) => setConstraintFilter(e.target.value as ConstraintFilter)}
          style={{
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '2px 4px',
            border: '1px solid var(--border-default, #ccc)',
            borderRadius: 4,
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          <option value="constrained">Constrained</option>
          <option value="unconstrained">Unconstrained</option>
          <option value="SNET">SNET</option>
          <option value="FNLT">FNLT</option>
          <option value="MSO">MSO</option>
          <option value="MFO">MFO</option>
          <option value="ALAP">ALAP</option>
        </select>
      </label>
    </div>
  );
}
