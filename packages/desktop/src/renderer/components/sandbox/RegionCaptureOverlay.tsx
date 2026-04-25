import React, { useEffect, useRef, useState } from 'react';

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  /** Bounding element the overlay covers — used to resolve pointer coords. */
  containerRef: React.RefObject<HTMLElement | null>;
  onComplete: (rect: CaptureRect | null) => void;
}

interface DragState {
  startX: number;
  startY: number;
}

/** Normalise a rect so width/height are always positive. */
export function normaliseRect(x1: number, y1: number, x2: number, y2: number): CaptureRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

const MIN_SIZE = 4;

/** Transparent full-cover overlay that lets the user drag a selection rectangle. */
export function RegionCaptureOverlay({ containerRef, onComplete }: Props): React.ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [rect, setRect] = useState<CaptureRect | null>(null);

  // Escape cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onComplete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onComplete]);

  const relativeCoords = (e: React.PointerEvent): { x: number; y: number } => {
    const el = overlayRef.current;
    if (!el) return { x: e.clientX, y: e.clientY };
    const bounds = el.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const { x, y } = relativeCoords(e);
    dragRef.current = { startX: x, startY: y };
    setRect({ x, y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { x, y } = relativeCoords(e);
    setRect(normaliseRect(dragRef.current.startX, dragRef.current.startY, x, y));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { x, y } = relativeCoords(e);
    const finalRect = normaliseRect(dragRef.current.startX, dragRef.current.startY, x, y);
    dragRef.current = null;
    setRect(null);

    if (finalRect.width < MIN_SIZE || finalRect.height < MIN_SIZE) {
      onComplete(null);
      return;
    }
    onComplete(finalRect);
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-40"
      style={{ cursor: 'crosshair', background: 'transparent' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {rect && rect.width >= 1 && rect.height >= 1 && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '1px dashed #3b82f6',
            background: 'rgba(59,130,246,0.08)',
          }}
        />
      )}
    </div>
  );
}
