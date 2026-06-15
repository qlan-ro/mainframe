import { useState, useCallback } from 'react';

interface RegionCaptureOverlayProps {
  onRegionSelect: (region: { x: number; y: number; w: number; h: number }) => void;
  onClose: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function RegionCaptureOverlay({ onRegionSelect, onClose }: RegionCaptureOverlayProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragState({ startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setDragState((prev) => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const x = Math.min(dragState.startX, e.clientX);
    const y = Math.min(dragState.startY, e.clientY);
    const w = Math.abs(e.clientX - dragState.startX);
    const h = Math.abs(e.clientY - dragState.startY);
    setDragState(null);
    if (w > 0 && h > 0) onRegionSelect({ x, y, w, h });
  }, [dragState, onRegionSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const selectionRect = dragState
    ? {
        left: Math.min(dragState.startX, dragState.currentX),
        top: Math.min(dragState.startY, dragState.currentY),
        width: Math.abs(dragState.currentX - dragState.startX),
        height: Math.abs(dragState.currentY - dragState.startY),
      }
    : null;

  return (
    <div
      data-testid="preview-region-overlay"
      className="fixed inset-0 z-50 cursor-crosshair bg-black/5"
      role="presentation"
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
    >
      {selectionRect && (
        <div
          data-testid="preview-region-selection"
          className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
          style={{
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
          }}
        />
      )}
    </div>
  );
}
