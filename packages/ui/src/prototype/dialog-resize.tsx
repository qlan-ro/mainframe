/* PROTOTYPE — #340 dialog resize grabber variants. Size state is in-memory
 * only; the real change persists to the UI-chrome store. */
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePrototype } from './variant';

const MARGIN = 32; // the primitive's max-w-[calc(100%-2rem)] outer margin

interface Size {
  w: number;
  h: number;
}
type Axis = 'x' | 'y' | 'xy';

export interface DialogResizePrototype {
  ref: (el: HTMLDivElement | null) => void;
  style: CSSProperties | undefined;
  className: string;
  extra: ReactNode;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function useDialogResizePrototype(): DialogResizePrototype {
  const variant = usePrototype('dialog');
  const el = useRef<HTMLDivElement | null>(null);
  const defaults = useRef<Size | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [dragging, setDragging] = useState(false);

  const ref = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
  }, []);

  const startDrag = (axis: Axis) => (e: React.PointerEvent) => {
    if (!el.current) return;
    e.preventDefault();
    const rect = el.current.getBoundingClientRect();
    defaults.current ??= { w: rect.width, h: rect.height };
    const start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    const min = defaults.current;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      // Centered via translate(-50%,-50%): the edge moves half as far as the
      // size grows, so a pointer delta of N needs a size delta of 2N.
      const w = axis === 'y' ? start.w : clamp(start.w + 2 * (ev.clientX - start.x), min.w, window.innerWidth - MARGIN);
      const h = axis === 'x' ? start.h : clamp(start.h + 2 * (ev.clientY - start.y), min.h, window.innerHeight - MARGIN);
      setSize({ w, h });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const reset = () => setSize(null);

  if (!variant) return { ref, style: undefined, className: '', extra: null };

  const style: CSSProperties | undefined = size
    ? { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none' }
    : undefined;

  const grip = (
    <svg viewBox="0 0 12 12" className="size-3 text-muted-foreground/70" aria-hidden>
      <path d="M11 1L1 11M11 6L6 11M11 10l-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
  const cornerBtn = (
    <div
      data-testid="dialog-resize-grabber"
      onPointerDown={startDrag('xy')}
      onDoubleClick={variant === 'C' ? reset : undefined}
      className="absolute bottom-1 right-1 flex size-4 cursor-nwse-resize items-end justify-end select-none"
      aria-hidden
    >
      {grip}
    </div>
  );

  let extra: ReactNode;
  if (variant === 'B') {
    extra = (
      <>
        <div onPointerDown={startDrag('x')} className="absolute inset-y-3 -right-1 w-2 cursor-ew-resize" aria-hidden />
        <div onPointerDown={startDrag('y')} className="absolute inset-x-3 -bottom-1 h-2 cursor-ns-resize" aria-hidden />
        <div
          data-testid="dialog-resize-grabber"
          onPointerDown={startDrag('xy')}
          className="absolute -bottom-1 -right-1 flex size-4 cursor-nwse-resize items-center justify-center"
          aria-hidden
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/70 opacity-0 transition-opacity group-hover/dialog:opacity-100" />
        </div>
      </>
    );
  } else if (variant === 'C') {
    extra = (
      <>
        {cornerBtn}
        {dragging && size && (
          <span className="pointer-events-none absolute bottom-2 right-7 rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">
            {Math.round(size.w)} × {Math.round(size.h)}
          </span>
        )}
      </>
    );
  } else {
    extra = cornerBtn;
  }

  return { ref, style, className: cn('group/dialog', size && 'transition-none'), extra };
}
