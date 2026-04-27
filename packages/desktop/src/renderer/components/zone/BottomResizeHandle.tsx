import { useCallback, useRef } from 'react';
import React from 'react';

interface BottomResizeHandleProps {
  onResize: (deltaY: number) => void;
}

export function BottomResizeHandle({ onResize }: BottomResizeHandleProps): React.ReactElement {
  const startY = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startY.current = e.clientY;
      const target = e.currentTarget as HTMLDivElement;
      target.setPointerCapture(e.pointerId);

      const handleMove = (me: PointerEvent): void => {
        const delta = startY.current - me.clientY;
        startY.current = me.clientY;
        onResize(delta);
      };

      const handleUp = (): void => {
        target.removeEventListener('pointermove', handleMove as EventListener);
        target.removeEventListener('pointerup', handleUp);
      };

      target.addEventListener('pointermove', handleMove as EventListener);
      target.addEventListener('pointerup', handleUp);
    },
    [onResize],
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      className="h-mf-gap cursor-row-resize bg-mf-app-bg hover:bg-mf-divider transition-colors shrink-0"
    />
  );
}
