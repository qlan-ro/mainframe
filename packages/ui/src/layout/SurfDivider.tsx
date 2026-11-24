import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The left panel's current share of the row. */
  frac: number;
  /** The smallest the panels can be, in px; the right one wins when the row cannot hold both. */
  minLeft: number;
  minRight: number;
  onFrac: (frac: number) => void;
}

/** The drag target's thickness, however thin the divider itself is. */
const HIT_SIZE = 9;

/** How far an arrow key moves it. */
const KEY_STEP = 0.02;

function clampFrac(frac: number, width: number, { minLeft, minRight }: Pick<Props, 'minLeft' | 'minRight'>): number {
  if (width <= 0) return frac;
  return Math.max(0, Math.min(1 - minRight / width, Math.max(minLeft / width, frac)));
}

/**
 * Drag handle between the chat and the workspace: a 1px hairline with a 9px drag target. The
 * target lies over the left panel only: the right one can hold a native webview, which sits
 * above the DOM and would swallow the press. `data-edge-handle` lets the left panel's scrollbar
 * thumb share those pixels; it is also the keyboard's handle. On hover a 2px accent line appears. Dragging, or
 * an arrow key, calls onFrac with a share both panels' minimums allow.
 */
export function SurfDivider({ containerRef, frac, minLeft, minRight, onFrac }: Props) {
  const [hot, setHot] = useState(false);

  // Holds the teardown for an in-flight drag so it can run on unmount too —
  // pointerup alone can't clean up if the divider unmounts mid-drag.
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanup.current?.(), []);

  const commit = (next: number) => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    onFrac(clampFrac(next, width, { minLeft, minRight }));
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (ev: PointerEvent) => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r) commit((ev.clientX - r.left) / r.width);
    };

    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragCleanup.current = null;
    };

    dragCleanup.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    commit(frac + (e.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP));
  };

  return (
    <div
      data-testid="surf-divider-x"
      onPointerDown={onDown}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      className="relative z-[6] flex w-px shrink-0 cursor-col-resize items-center justify-center self-stretch"
    >
      <div className="h-full w-px bg-border" />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the workspace"
        aria-valuenow={Math.round(frac * 100)}
        tabIndex={0}
        data-edge-handle=""
        onKeyDown={onKeyDown}
        style={{ top: 0, bottom: 0, right: 0, width: HIT_SIZE }}
        className="absolute focus-visible:focus-line-inset"
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute h-full rounded-sm bg-primary transition-[width] duration-100',
          hot ? 'w-0.5' : 'w-0',
        )}
      />
    </div>
  );
}
