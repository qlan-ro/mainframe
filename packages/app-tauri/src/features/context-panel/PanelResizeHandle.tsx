'use client';

import { useRef } from 'react';
import { useBottomPanel, clampBottomPanelHeight, BOTTOM_PANEL_MAX_FALLBACK } from '@/store/bottom-panel';

/** Reserve for the session list above the panel (matches the artboard's clientHeight − 200). */
const LIST_RESERVE = 200;

/** 5px row-resize bar above the bottom panel. Dragging up grows the panel. */
export function PanelResizeHandle() {
  const setHeight = useBottomPanel((s) => s.setHeight);
  const cleanupRef = useRef<(() => void) | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = useBottomPanel.getState().height;
    const sidebar = (e.currentTarget as HTMLElement).closest('[data-testid="sessions-sidebar"]');
    const measured = sidebar?.clientHeight ?? 0;
    const sidebarHeight = measured > 0 ? measured : BOTTOM_PANEL_MAX_FALLBACK + LIST_RESERVE;
    const maxHeight = Math.max(0, sidebarHeight - LIST_RESERVE);

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const move = (ev: PointerEvent) => {
      setHeight(clampBottomPanelHeight(startHeight + (startY - ev.clientY), maxHeight));
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cleanupRef.current = null;
    };
    cleanupRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      data-testid="sidebar-bottom-resize"
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      className="group flex h-[5px] shrink-0 cursor-row-resize touch-none items-center"
    >
      <div className="h-px w-full bg-border transition-colors group-hover:bg-primary" />
    </div>
  );
}
