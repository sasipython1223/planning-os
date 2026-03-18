import { useCallback, useRef } from 'react';
import { useUIStore } from '../store/uiStore';

const MIN_TABLE = 150;
const MIN_GANTT = 100;

interface WorkspaceSplitterProps {
  tableRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  lowerAxisRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Imperative drag splitter between Table and Gantt panes.
 * During mousemove: directly mutates tableRef's inline width.
 * On mouseup: commits final width to Zustand store.
 */
export function WorkspaceSplitter({ tableRef, containerRef, lowerAxisRef }: WorkspaceSplitterProps) {
  const setTableWidth = useUIStore((s) => s.setTableWidth);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;

    const startX = e.clientX;
    const tableEl = tableRef.current;
    const containerEl = containerRef.current;
    if (!tableEl || !containerEl) return;

    const startWidth = tableEl.getBoundingClientRect().width;
    const containerWidth = containerEl.getBoundingClientRect().width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = ev.clientX - startX;
      const maxWidth = containerWidth - MIN_GANTT - 4 - 17; // 4px splitter + 17px scroll track
      const clamped = Math.max(MIN_TABLE, Math.min(startWidth + delta, maxWidth));
      tableEl.style.width = `${clamped}px`;
      // Sync lower axis pane live during drag
      if (lowerAxisRef?.current) lowerAxisRef.current.style.width = `${clamped + 4}px`;
    };

    const onMouseUp = (ev: MouseEvent) => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const delta = ev.clientX - startX;
      const maxWidth = containerWidth - MIN_GANTT - 4 - 17;
      const finalWidth = Math.max(MIN_TABLE, Math.min(startWidth + delta, maxWidth));
      setTableWidth(finalWidth);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [tableRef, containerRef, setTableWidth, lowerAxisRef]);

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        background: '#e0e0e0',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#bbb'; }}
      onMouseLeave={(e) => { if (!draggingRef.current) (e.target as HTMLElement).style.background = '#e0e0e0'; }}
    />
  );
}
