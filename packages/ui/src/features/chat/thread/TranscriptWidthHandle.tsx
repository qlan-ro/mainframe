/**
 * A resize grip on one edge of the centred transcript column. The column stays
 * centred, so a drag sets its width to twice the pointer's distance from the
 * centre — either grip works the same. The drag paints through
 * `--mf-transcript-width` on `root` and commits to ui-prefs once, on release,
 * so a long transcript doesn't re-render on every pointer move. Double-click
 * restores the default.
 */
import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import { clampTranscriptWidth, TRANSCRIPT_DEFAULT_WIDTH, useUiPrefs } from '@/store/ui-prefs';

export const TRANSCRIPT_WIDTH_VAR = '--mf-transcript-width';

export function TranscriptWidthHandle({
  side,
  rootRef,
}: {
  side: 'left' | 'right';
  rootRef: RefObject<HTMLElement | null>;
}) {
  const setTranscriptWidth = useUiPrefs((s) => s.setTranscriptWidth);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const column = event.currentTarget.parentElement;
    const root = rootRef.current;
    if (column == null || root == null) return;
    event.preventDefault();
    const { left, width } = column.getBoundingClientRect();
    const center = left + width / 2;
    // Past the viewport, `w-full` caps the column and the grips stop following
    // the pointer, so the stored width must stop there too.
    const room = column.parentElement?.clientWidth || Infinity;
    // A click without a move must not commit: on a squeezed column the
    // rendered width is narrower than the stored one.
    let next: number | null = null;

    const onMove = (e: PointerEvent) => {
      next = Math.min(room, clampTranscriptWidth(2 * Math.abs(e.clientX - center)));
      root.style.setProperty(TRANSCRIPT_WIDTH_VAR, `${next}px`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (next != null) setTranscriptWidth(next);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      data-testid={`transcript-width-handle-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize transcript"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setTranscriptWidth(TRANSCRIPT_DEFAULT_WIDTH)}
      // Inside the column's 20px padding, never past its edge: the viewport
      // scrolls on x too, so an overhang would add a horizontal scrollbar.
      // The sidebar rail's hover line, without its resting hairline.
      className={cn(
        'absolute inset-y-0 z-10 w-2 cursor-col-resize',
        side === 'left' ? 'left-0' : 'right-0',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-sidebar-border',
      )}
    />
  );
}
