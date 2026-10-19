/**
 * The usage capsule — the ambient plan-quota surface, right after the traffic
 * lights in the title bar. One limit at a time (provider dot, window tag,
 * bar, percent, time to reset), cycling every 4s through each provider's
 * windows, smallest first; the dots on the right say where in the cycle it
 * is. A window at 75%+ stops the rotation and stays on screen in warning,
 * 90%+ in destructive.
 *
 * Hover pauses the cycle and opens every limit at once in a popover; a click
 * pins that popover until the user clicks away. Pure wiring: the cycle's
 * contents and the pinned window come from `quota-format`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import {
  deriveCapsuleItems,
  formatRelativeReset,
  formatUsedPercent,
  pinnedCapsuleIndex,
  type CapsuleItemVm,
} from '@/features/quota/quota-format';
import { useQuotaStore } from '@/store/quota';
import { ProviderDot } from '../shared/ProviderDot';
import { QUOTA_BAR_FILL, QUOTA_PERCENT_TEXT } from './quota-severity';
import { UsagePopover } from './UsagePopover';
import { useHoverPin } from './use-hover-pin';

const CYCLE_INTERVAL_MS = 4_000;
/** One capsule row; the track slides by this much per step. */
const ROW_PX = 20;

function useCycleIndex(count: number, paused: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), CYCLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, paused]);
  return count === 0 ? 0 : index % count;
}

function capsuleAriaLabel(item: CapsuleItemVm | undefined, now: number): string {
  if (!item) return 'Usage: quota unknown';
  const rel = formatRelativeReset(item.resetsAt, now);
  const reset = rel ? `, resets in ${rel}` : '';
  const stale = item.stale ? ', stale' : '';
  return `Usage: ${item.providerLabel} ${item.label} ${formatUsedPercent(item.usedPercent)}%${reset}${stale}`;
}

function CapsuleRow({ item, now }: { item: CapsuleItemVm; now: number }) {
  return (
    <span
      data-testid={`usage-capsule-item-${item.key}`}
      className="flex h-5 items-center gap-1.5 text-xs whitespace-nowrap tabular-nums"
    >
      <ProviderDot adapterId={item.providerId} className="size-1.75" />
      <span className="w-4 shrink-0 text-muted-foreground">{item.tag}</span>
      <Progress
        value={item.usedPercent}
        className={cn('h-0.75 w-8 shrink-0 bg-foreground/10', QUOTA_BAR_FILL[item.severity])}
      />
      <span className={cn('w-6.5 shrink-0 text-right', QUOTA_PERCENT_TEXT[item.severity])}>
        {formatUsedPercent(item.usedPercent)}%
      </span>
      <span className="w-11 shrink-0 text-right text-muted-foreground">
        {formatRelativeReset(item.resetsAt, now) ?? '—'}
      </span>
    </span>
  );
}

function CycleDots({ count, active }: { count: number; active: number }) {
  return (
    <span data-testid="usage-capsule-dots" aria-hidden className="ml-0.5 flex shrink-0 flex-col gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          data-active={i === active ? '' : undefined}
          className={cn('size-0.75 rounded-full', i === active ? 'bg-foreground' : 'bg-muted-foreground/60')}
        />
      ))}
    </span>
  );
}

/** `now` is injectable so the derived staleness/expiry states are deterministic in tests. */
export function UsageCapsule({ now }: { now?: number }) {
  // Ticks so an idle capsule still crosses resetsAt/staleness thresholds.
  const ticking = useNow();
  const effectiveNow = now ?? ticking;
  const byId = useQuotaStore((s) => s.byId);
  const items = useMemo(() => deriveCapsuleItems(byId, effectiveNow), [byId, effectiveNow]);
  const pinnedIndex = pinnedCapsuleIndex(items);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hover = useHoverPin();
  const cycleIndex = useCycleIndex(items.length, hover.pointerInside || hover.open || pinnedIndex != null);
  const shown = pinnedIndex ?? cycleIndex;

  const onInteractOutside = useCallback((e: Event) => {
    // The capsule toggles the pin itself; Radix would otherwise close on its
    // pointerdown and the click would reopen it.
    if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
  }, []);

  return (
    <Popover open={hover.open} onOpenChange={hover.onOpenChange}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          type="button"
          data-testid="usage-capsule"
          data-pinned={pinnedIndex == null ? undefined : ''}
          aria-label={capsuleAriaLabel(items[shown], effectiveNow)}
          aria-haspopup="dialog"
          aria-expanded={hover.open}
          onClick={hover.togglePin}
          onPointerEnter={hover.onPointerEnter}
          onPointerLeave={hover.onPointerLeave}
          className={cn(
            'flex h-7 w-44 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg bg-sidebar-accent pr-1.5 pl-2.5 outline-none',
            'hover:bg-foreground/15 focus-visible:ring-2 focus-visible:ring-ring',
            hover.open && 'bg-foreground/15',
          )}
        >
          <span className="block h-5 min-w-0 flex-1 overflow-hidden">
            {items.length === 0 ? (
              <span className="flex h-5 items-center text-xs text-muted-foreground italic">quota unknown</span>
            ) : (
              <span
                className="flex flex-col transition-transform duration-320 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: `translateY(-${shown * ROW_PX}px)` }}
              >
                {items.map((item) => (
                  <CapsuleRow key={item.key} item={item} now={effectiveNow} />
                ))}
              </span>
            )}
          </span>
          {pinnedIndex == null && items.length > 1 ? (
            <CycleDots count={items.length} active={shown} />
          ) : (
            <span aria-hidden className="w-0.75 shrink-0" />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        data-testid="usage-capsule-popover"
        className="w-72 gap-0 p-3 pt-2.5 shadow-mf-pop"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onInteractOutside}
        onPointerEnter={hover.onPointerEnter}
        onPointerLeave={hover.onPointerLeave}
      >
        <UsagePopover byId={byId} now={effectiveNow} />
      </PopoverContent>
    </Popover>
  );
}
