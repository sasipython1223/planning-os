import { useCallback, useEffect, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';

/**
 * Draggable resize handle for the bottom drawer.
 * Uses imperative DOM updates during mousemove to avoid React render thrash.
 * Commits to Zustand only on mouseup.
 */
export function DrawerResizer() {
  const setBottomHeight = useUIStore((s) => s.setBottomHeight);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  /** Will be set by BottomDrawer via the data-drawer-ref pattern */
  const drawerRef = useRef<HTMLElement | null>(null);

  const getDrawerEl = useCallback((): HTMLElement | null => {
    if (drawerRef.current) return drawerRef.current;
    // Walk DOM: resizer is a direct child of BottomDrawer's root div
    const resizerEl = document.querySelector('[data-drawer-resizer]');
    const el = resizerEl?.parentElement ?? null;
    drawerRef.current = el;
    return el;
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const delta = startY.current - e.clientY;
    const newH = Math.max(100, Math.min(startH.current + delta, Math.floor(window.innerHeight * 0.8)));
    const el = getDrawerEl();
    if (el) el.style.height = `${newH}px`;
  }, [getDrawerEl]);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    const delta = startY.current - e.clientY;
    const finalH = Math.max(100, Math.min(startH.current + delta, Math.floor(window.innerHeight * 0.8)));
    setBottomHeight(finalH);
  }, [onMouseMove, setBottomHeight]);

  // Cleanup on unmount if mid-drag
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = getDrawerEl()?.offsetHeight ?? useUIStore.getState().bottomHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onMouseMove, onMouseUp, getDrawerEl]);

  return (
    <div
      data-drawer-resizer
      onMouseDown={onMouseDown}
      style={{
        height: 4,
        flexShrink: 0,
        cursor: 'row-resize',
        background: 'var(--border-default, #ccc)',
      }}
    />
  );
}
