import { useEffect, useRef, useState } from 'react';

interface Props {
  axis: 'x' | 'y';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onFrac: (frac: number) => void;
  /** Permanent hairline class: `bg-border` for split, `bg-transparent` for glass/unified. */
  lineClass?: string;
  /** Gutter width in px — per window style (04-engine `SHELL.gutter`: 8 for
   *  unified/glass, 9 for split). Defaults to 6 for standalone callers. */
  gutter?: number;
}

/**
 * Drag handle between surface panels (width per the caller's window-style gutter).
 * On hover: a 2px accent line appears (matches 04-engine.jsx SurfDivider).
 * On drag: calls onFrac(0.18–0.82) so the caller can update flex weights.
 */
export function SurfDivider({ axis, containerRef, onFrac, lineClass = 'bg-transparent', gutter = 6 }: Props) {
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
      {/* Permanent hairline: visible only for split (bg-border); transparent for glass/unified. */}
      <div style={{ [isX ? 'width' : 'height']: 1, [isX ? 'height' : 'width']: '100%' }} className={lineClass} />
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
