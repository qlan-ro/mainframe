import { useEffect, useRef, useState } from 'react';

interface Props {
  axis: 'x' | 'y';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onFrac: (frac: number) => void;
  /** Layout thickness in px; the hairline is centred in it. */
  gutter?: number;
}

/** The drag target's thickness, however thin the divider itself is. */
const HIT_SIZE = 9;

/**
 * Drag handle between surface panels: a 1px hairline with a 9px drag target. The
 * vertical one's target lies over the left panel only: the right one can hold a
 * native webview, which sits above the DOM and would swallow the press.
 * `data-edge-handle` lets the left panel's scrollbar thumb share those pixels. On hover: a 2px accent line appears.
 * On drag: calls onFrac(0.18–0.82) so the caller can update flex weights.
 */
export function SurfDivider({ axis, containerRef, onFrac, gutter = 1 }: Props) {
  const [hot, setHot] = useState(false);
  const isX = axis === 'x';

  // Holds the teardown for an in-flight drag so it can run on unmount too —
  // pointerup alone can't clean up if the divider unmounts mid-drag.
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanup.current?.(), []);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = isX ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const move = (ev: PointerEvent) => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const frac = isX ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      onFrac(Math.max(0.18, Math.min(0.82, frac)));
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

  return (
    <div
      data-testid={`surf-divider-${axis}`}
      onPointerDown={onDown}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{ flexShrink: 0, [isX ? 'width' : 'height']: gutter }}
      className={`relative z-[6] flex items-center justify-center self-stretch ${isX ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    >
      <div style={{ [isX ? 'width' : 'height']: 1, [isX ? 'height' : 'width']: '100%' }} className="bg-border" />
      <div
        aria-hidden
        data-edge-handle=""
        style={isX ? { top: 0, bottom: 0, right: 0, width: HIT_SIZE } : { left: 0, right: 0, top: 0, height: HIT_SIZE }}
        className="absolute"
      />
      {/* Hover accent: 2px primary line that fades in on hover/drag. */}
      <div
        style={{
          position: 'absolute',
          [isX ? 'width' : 'height']: hot ? 2 : 0,
          [isX ? 'height' : 'width']: '100%',
          transition: 'all 0.12s',
        }}
        className="rounded-sm bg-primary"
      />
    </div>
  );
}
