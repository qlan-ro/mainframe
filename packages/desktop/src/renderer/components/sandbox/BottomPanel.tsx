import React, { useCallback, useRef } from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';

const MIN_HEIGHT = 120;

export function BottomPanel(): React.ReactElement | null {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const panelVisible = useUIStore((s) => s.panelVisible);
  const height = useUIStore((s) => s.panelSizes.bottom);
  const setPanelSize = useUIStore((s) => s.setPanelSize);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startHeight.current = height;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const next = Math.max(MIN_HEIGHT, startHeight.current + delta);
      setPanelSize('bottom', next);
    },
    [setPanelSize],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (panelCollapsed.bottom) return null;
  if (!panelVisible) return null;

  return (
    <div className="flex flex-col shrink-0">
      {/* Resize handle */}
      <div
        className="h-mf-gap shrink-0 cursor-row-resize group"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="h-full w-full flex items-center justify-center">
          <div className="h-px w-full bg-transparent group-hover:bg-mf-divider group-active:bg-mf-divider transition-colors" />
        </div>
      </div>

      {/* Panel content */}
      <div className="bg-mf-panel-bg rounded-mf-panel overflow-hidden" style={{ height }}>
        <PreviewTab />
      </div>
    </div>
  );
}
