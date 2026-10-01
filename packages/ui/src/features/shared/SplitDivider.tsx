/**
 * A draggable vertical line between two side-by-side panes. The visible
 * hairline stays 1px; an invisible ±6px child widens the grab area. A drag
 * reports the LEFT pane's share of the row, clamped so neither side goes under
 * its pixel minimum — only the drag site knows the row's real width.
 */
import { cn } from '@/lib/utils';

export function SplitDivider({
  testId,
  minLeft,
  minRight,
  onFrac,
}: {
  testId: string;
  minLeft: number;
  minRight: number;
  onFrac: (leftFrac: number) => void;
}) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const row = event.currentTarget.parentElement;
    if (row == null) return;
    const { left, width } = row.getBoundingClientRect();
    const minFrac = minLeft / width;
    const maxFrac = 1 - minRight / width;

    const onMove = (e: PointerEvent) => {
      const frac = (e.clientX - left) / width;
      onFrac(Math.min(maxFrac, Math.max(minFrac, frac)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      data-testid={testId}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      // Same recipe as the sidebar's resize rail (sidebar.tsx SidebarRail): an
      // 8px grab strip whose resting hairline thickens to the 2px
      // sidebar-border line on hover — one resize vocabulary app-wide.
      className={cn(
        'relative z-20 w-2 shrink-0 cursor-col-resize transition-all ease-linear',
        'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent',
        'hover:after:bg-sidebar-border',
      )}
    />
  );
}
