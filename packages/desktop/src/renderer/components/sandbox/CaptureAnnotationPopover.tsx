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

const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT = 96;

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
      className="fixed z-50 flex flex-col rounded-md bg-mf-input-bg border border-mf-divider shadow-lg shadow-black/30"
      style={{ top, left, width: POPOVER_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-2 pt-1.5">
        <span
          className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
          style={{ background: '#f59e0b', color: '#1a1a1a' }}
        >
          {index}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 rounded text-mf-text-secondary hover:text-mf-text-primary"
          aria-label={`Remove capture ${index}`}
        >
          <X size={12} />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Annotation (optional)…"
        className="w-full h-14 resize-none bg-transparent border-0 px-2.5 pb-2 pt-1 text-mf-body font-mono text-mf-text-primary placeholder-mf-text-secondary/40 focus:outline-none"
      />
    </div>
  );
}
