import { useEffect, useRef, useState } from 'react';

interface Props {
  axis: 'x' | 'y';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onFrac: (frac: number) => void;
}

/**
 * 6px drag handle between surface panels.
 * On hover: a 2px accent line appears (matches 04-engine.jsx SurfDivider).
 * On drag: calls onFrac(0.18–0.82) so the caller can update flex weights.
 */
export function SurfDivider({ axis, containerRef, onFrac }: Props) {
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
      style={{ flexShrink: 0, [isX ? 'width' : 'height']: 6 }}
      className={`relative z-[6] flex items-center justify-center self-stretch ${isX ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    >
      <div
        style={{
          [isX ? 'width' : 'height']: hot ? 2 : 0,
          [isX ? 'height' : 'width']: '100%',
          transition: 'all 0.12s',
        }}
        className="rounded-sm bg-primary"
      />
    </div>
  );
}
