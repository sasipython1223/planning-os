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
    <div className="shell-toolbar">
      <div className="shell-toolbar-segment">
      <button
        onClick={() => isOpen && activeTab === 'histogram' ? toggle(false) : setActiveTab('histogram')}
        className={`shell-toolbar-btn${isOpen && activeTab === 'histogram' ? ' is-active' : ''}`}
      >
        Histogram
      </button>
      <button
        onClick={() => isOpen && activeTab === 'logs' ? toggle(false) : setActiveTab('logs')}
        className={`shell-toolbar-btn${isOpen && activeTab === 'logs' ? ' is-active' : ''}`}
      >
        Logs
      </button>
      </div>
      <span className="shell-toolbar-sep" />
      <label className="shell-toolbar-filter">
        <span>Constraint</span>
        <select
          value={constraintFilter}
          onChange={(e) => setConstraintFilter(e.target.value as ConstraintFilter)}
          className="shell-toolbar-select"
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
