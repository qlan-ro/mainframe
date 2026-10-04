/**
 * One provider's usage row in the sidebar footer, 22px: provider dot, name,
 * the window tag (`5h` / `wk`), a 3px bar, the percent and the relative reset.
 * Hover opens the per-window detail as a hover card to the right — every
 * "more about this row" surface in the panel comes out of the same edge.
 *
 * The card follows the pointer (wedge guard), the same discipline the session
 * rows use, so a card can never stay open over the chat after the pointer left.
 */
import { useCallback, useRef, useState } from 'react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  deriveQuotaRow,
  formatRelativeReset,
  formatUsedPercent,
  windowTag,
  type QuotaSeverity,
} from '@/features/quota/quota-format';
import { useHoverCardWedgeGuard } from '@/features/sessions/use-hover-card-wedge-guard';
import { ProviderDot } from '../shared/ProviderDot';
import { QuotaPopover } from './QuotaPopover';

/** Only the red band gets its own ink — the preset carries no amber. */
const PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-muted-foreground',
  amber: 'text-muted-foreground',
  red: 'text-destructive',
};

/** Re-tints `Progress`'s indicator rather than forking the primitive. */
const BAR_FILL: Record<QuotaSeverity, string> = {
  normal: '',
  amber: '',
  red: '*:data-[slot=progress-indicator]:bg-destructive',
};

function rowAriaLabel(label: string, quota: ProviderQuota | undefined, now: number): string {
  const row = deriveQuotaRow(quota, now);
  if (row.state === 'unknown') return `${label} quota: unknown`;
  const rel = formatRelativeReset(row.resetsAt, now);
  const reset = rel ? `, resets in ${rel}` : '';
  return `${label} quota: ${formatUsedPercent(row.usedPercent)}% used${reset}${row.stale ? ', stale' : ''}`;
}

export function QuotaProviderRow({
  providerId,
  label,
  quota,
  now,
}: {
  providerId: string;
  label: string;
  quota: ProviderQuota | undefined;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useHoverCardWedgeGuard(open, rowRef, close);
  const row = deriveQuotaRow(quota, now);
  const rel = row.state === 'ok' ? formatRelativeReset(row.resetsAt, now) : null;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={60}>
      <HoverCardTrigger asChild>
        <div
          ref={rowRef}
          data-testid={`provider-quota-row-${providerId}`}
          data-state-kind={row.state}
          aria-label={rowAriaLabel(label, quota, now)}
          tabIndex={0}
          className="flex h-5.5 items-center gap-2 rounded-md px-1 text-xs tabular-nums hover:bg-sidebar-accent"
        >
          <ProviderDot adapterId={providerId} testId={`provider-quota-glyph-${providerId}`} />
          <span className={cn('w-10 shrink-0 truncate', row.state === 'unknown' && 'text-muted-foreground italic')}>
            {label}
          </span>
          {row.state === 'ok' ? (
            <>
              <span className="w-5.5 shrink-0 text-muted-foreground">{windowTag(row.kind)}</span>
              <Progress
                value={row.usedPercent}
                className={cn('h-0.75 min-w-0 flex-1 bg-muted', BAR_FILL[row.severity])}
              />
              <span className={cn('w-7.5 shrink-0 text-right font-medium', PERCENT_TEXT[row.severity])}>
                {formatUsedPercent(row.usedPercent)}%
              </span>
              <span className="w-11 shrink-0 truncate text-right text-muted-foreground">{rel ?? '—'}</span>
            </>
          ) : (
            <>
              <span className="w-5.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">quota unknown</span>
              <span className="w-7.5 shrink-0 text-right text-muted-foreground">?</span>
              <span className="w-11 shrink-0 text-right text-muted-foreground">—</span>
            </>
          )}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-63 p-0 shadow-mf-pop">
        <QuotaPopover providerId={providerId} label={label} quota={quota} now={now} />
      </HoverCardContent>
    </HoverCard>
  );
}
