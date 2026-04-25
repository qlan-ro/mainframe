import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { CaptureRect } from './RegionCaptureOverlay.js';

interface Props {
  /** The capture rect in CSS pixels relative to the webview container — used to anchor. */
  anchorRect: CaptureRect;
  /** Container element so we can resolve screen coords for clamping. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Index of this capture (1-based) — shown in the header to mirror the overlay marker. */
  index: number;
  /** Controlled annotation text. */
  value: string;
  onChange: (next: string) => void;
  /** Remove this capture entirely (the marker AND the popover). */
  onRemove: () => void;
  /** Whether to autofocus the textarea on mount. */
  autoFocus?: boolean;
}

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 140;

function computePosition(
  anchorRect: CaptureRect,
  containerRef: React.RefObject<HTMLElement | null>,
): { top: number; left: number } {
  const containerBounds = containerRef.current?.getBoundingClientRect();
  const offsetX = containerBounds?.left ?? 0;
  const offsetY = containerBounds?.top ?? 0;

  let top = offsetY + anchorRect.y + anchorRect.height + 8;
  let left = offsetX + anchorRect.x;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (top + POPOVER_HEIGHT > vh - 8) top = offsetY + anchorRect.y - POPOVER_HEIGHT - 8;
  if (top < 8) top = 8;
  if (left + POPOVER_WIDTH > vw - 8) left = vw - POPOVER_WIDTH - 8;
  if (left < 8) left = 8;

  return { top, left };
}

export function CaptureAnnotationPopover({
  anchorRect,
  containerRef,
  index,
  value,
  onChange,
  onRemove,
  autoFocus,
}: Props): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const { top, left } = computePosition(anchorRect, containerRef);

  return (
    <div
      className="fixed z-50 rounded-lg border border-mf-divider bg-mf-sidebar shadow-xl shadow-black/40"
      style={{ top, left, width: POPOVER_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-mf-divider">
        <span className="flex items-center gap-1.5 text-[11px] text-mf-text-secondary font-medium">
          <span
            className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
            style={{ background: '#f59e0b', color: '#1a1a1a' }}
          >
            {index}
          </span>
          Annotation
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary"
          aria-label={`Remove capture ${index}`}
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Annotation (optional)…"
          className="w-full h-16 resize-none rounded-md border border-mf-divider bg-mf-input-bg px-2.5 py-2 text-mf-body font-mono text-mf-text-primary placeholder-mf-text-secondary/40 focus:outline-none focus:border-mf-accent/50"
        />
      </div>
    </div>
  );
}
