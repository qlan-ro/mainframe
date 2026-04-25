import React, { useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import type { CaptureRect } from './RegionCaptureOverlay.js';

interface Props {
  /** The dragged rect in CSS pixels relative to the webview container (used to anchor the popover). */
  anchorRect: CaptureRect;
  /** Container element so we can resolve screen coords for clamping. */
  containerRef: React.RefObject<HTMLElement | null>;
  imageDataUrl: string;
  onSubmit: (annotation: string) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 290; // approximate

/** Compute fixed-position coords for the popover, clamped to viewport. */
function computePosition(
  anchorRect: CaptureRect,
  containerRef: React.RefObject<HTMLElement | null>,
): { top: number; left: number } {
  const containerBounds = containerRef.current?.getBoundingClientRect();
  const offsetX = containerBounds?.left ?? 0;
  const offsetY = containerBounds?.top ?? 0;

  // Prefer showing below + to the right of the selection, fall back above/left
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
  imageDataUrl,
  onSubmit,
  onClose,
}: Props): React.ReactElement {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape submits with empty annotation (capture still added)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSubmit('');
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSubmit, onClose]);

  // Click outside closes (and submits empty)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onSubmit('');
        onClose();
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [onSubmit, onClose]);

  const handleSubmit = () => {
    onSubmit(text.trim());
    onClose();
  };

  const { top, left } = computePosition(anchorRect, containerRef);

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-mf-divider bg-mf-sidebar shadow-xl shadow-black/40"
      style={{ top, left, width: POPOVER_WIDTH }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-mf-divider">
        <span className="text-mf-small text-mf-text-secondary font-medium">Region capture</span>
        <button
          onClick={() => {
            onSubmit('');
            onClose();
          }}
          className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Thumbnail preview */}
      <div className="px-3 pt-2">
        <img
          src={imageDataUrl}
          alt="Region capture preview"
          className="w-full rounded border border-mf-border object-contain max-h-28"
        />
      </div>

      {/* Annotation input */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Add annotation (optional)…"
          className="w-full h-16 resize-none rounded-md border border-mf-divider bg-mf-input-bg px-2.5 py-2 text-mf-body font-mono text-mf-text-primary placeholder-mf-text-secondary/40 focus:outline-none focus:border-mf-accent/50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-mf-text-secondary opacity-40">Enter to add · Esc to skip</span>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mf-accent/20 text-mf-accent text-mf-small font-medium hover:bg-mf-accent/30 transition-colors"
          >
            <Send size={12} />
            Add to composer
          </button>
        </div>
      </div>
    </div>
  );
}
