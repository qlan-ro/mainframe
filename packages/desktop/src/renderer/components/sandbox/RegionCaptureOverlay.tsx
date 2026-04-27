import React, { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedRegion {
  id: string;
  rect: CaptureRect;
}

interface Props {
  /** Already-captured regions to render as persistent markers. */
  captured: ReadonlyArray<CapturedRegion>;
  /** Called when the user finishes a drag with a non-trivial rect. */
  onCapture: (rect: CaptureRect) => void;
  /** Called when the user clicks "Submit all". Disabled if `captured.length === 0`. */
  onSubmitAll: () => void;
  /** Called when the user clicks the close-mode (X) button or hits Escape. */
  onCancel: () => void;
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

export function RegionCaptureOverlay({ captured, onCapture, onSubmitAll, onCancel }: Props): React.ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draftRect, setDraftRect] = useState<CaptureRect | null>(null);

  // Escape exits capture mode entirely (parent decides what to do with pending captures).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const relativeCoords = (e: React.PointerEvent): { x: number; y: number } => {
    const el = overlayRef.current;
    if (!el) return { x: e.clientX, y: e.clientY };
    const bounds = el.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only start a drag when pointerdown lands on the overlay background itself,
    // not on a marker or its child UI.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const { x, y } = relativeCoords(e);
    dragRef.current = { startX: x, startY: y };
    setDraftRect({ x, y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { x, y } = relativeCoords(e);
    setDraftRect(normaliseRect(dragRef.current.startX, dragRef.current.startY, x, y));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { x, y } = relativeCoords(e);
    const finalRect = normaliseRect(dragRef.current.startX, dragRef.current.startY, x, y);
    dragRef.current = null;
    setDraftRect(null);
    if (finalRect.width < MIN_SIZE || finalRect.height < MIN_SIZE) return;
    onCapture(finalRect);
  };

  const submitDisabled = captured.length === 0;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-40"
      style={{ cursor: 'crosshair', background: 'transparent' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Persistent markers for captured regions */}
      {captured.map((c, idx) => (
        <div
          key={c.id}
          className="absolute pointer-events-none"
          style={{
            left: c.rect.x,
            top: c.rect.y,
            width: c.rect.width,
            height: c.rect.height,
            border: '1px solid #f59e0b',
            background: 'rgba(245,158,11,0.10)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          }}
        >
          <span
            className="absolute -top-2 -left-2 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
            style={{ background: '#f59e0b', color: '#1a1a1a' }}
          >
            {idx + 1}
          </span>
        </div>
      ))}

      {/* Live drag rect */}
      {draftRect && draftRect.width >= 1 && draftRect.height >= 1 && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: draftRect.x,
            top: draftRect.y,
            width: draftRect.width,
            height: draftRect.height,
            border: '1px dashed #3b82f6',
            background: 'rgba(59,130,246,0.08)',
          }}
        />
      )}

      {/* Floating mode controls — top-right */}
      <div
        className="absolute top-2 right-2 flex items-center gap-1.5 rounded-md bg-mf-sidebar/95 backdrop-blur border border-mf-divider px-1.5 py-1 shadow-xl"
        style={{ pointerEvents: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="text-[11px] text-mf-text-secondary px-1.5">
          {captured.length === 0 ? 'Drag to capture' : `${captured.length} captured`}
        </span>
        <button
          type="button"
          onClick={onSubmitAll}
          disabled={submitDisabled}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-mf-accent/20 text-mf-accent hover:bg-mf-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Submit all captures"
        >
          <Check size={12} />
          Submit all
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          aria-label="Cancel region capture"
          title="Cancel (Esc)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
