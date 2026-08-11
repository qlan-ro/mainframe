/**
 * The draggable line between the two zones. The visible hairline stays 1px;
 * an invisible ±6px child widens the grab area, and a drag writes the left
 * zone's fraction into the zones store — clamped so NEITHER side ever goes
 * under MIN_ZONE_WIDTH (the same floor that parks the split entirely).
 */
import { MIN_ZONE_WIDTH, useZonesStore } from './zones-store';

export function SplitDivider() {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const row = event.currentTarget.parentElement;
    if (row == null) return;
    const { left, width } = row.getBoundingClientRect();
    const minFrac = MIN_ZONE_WIDTH / width;

    const onMove = (e: PointerEvent) => {
      const frac = (e.clientX - left) / width;
      useZonesStore.getState().setFrac(Math.min(1 - minFrac, Math.max(minFrac, frac)));
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
      data-testid="chat-split-divider"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="relative w-px shrink-0 cursor-col-resize bg-border"
    >
      {/* Widened grab area; tints on hover so the line reads as draggable. */}
      <div className="absolute inset-y-0 -right-1.5 -left-1.5 transition-colors hover:bg-primary/20" />
    </div>
  );
}
