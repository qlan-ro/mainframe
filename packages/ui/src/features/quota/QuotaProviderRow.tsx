/**
 * QuotaProviderRow — one collapsed provider row inside the quota card. Renders
 * that provider's tightest window (ring + % + relative reset) and opens a
 * side="top" popover with every window on click. Keyboard-reachable and
 * dismissible like the daemon switcher (it is a Radix Popover trigger button).
 */
import { useState } from 'react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ProviderLogo } from '@/features/shared/ProviderLogo';
import { QuotaRing, QuotaUnknownRing } from './QuotaRing';
import { QuotaPopover } from './QuotaPopover';
import { deriveQuotaRow, formatRelativeReset, type QuotaSeverity } from './quota-format';

const PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-foreground',
  amber: 'text-mf-warning',
  red: 'text-destructive',
};

function rowAriaLabel(label: string, quota: ProviderQuota | undefined, now: number): string {
  const row = deriveQuotaRow(quota, now);
  if (row.state === 'unknown') return `${label} quota: unknown`;
  const rel = formatRelativeReset(row.resetsAt, now);
  const reset = rel ? `, resets in ${rel}` : '';
  return `${label} quota: ${row.usedPercent}% used${reset}${row.stale ? ', stale' : ''}`;
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
  const row = deriveQuotaRow(quota, now);
  const rel = row.state === 'ok' ? formatRelativeReset(row.resetsAt, now) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`provider-quota-row-${providerId}`}
          data-state-kind={row.state}
          aria-label={rowAriaLabel(label, quota, now)}
          className={cn(
            'flex h-[24px] w-full items-center gap-[8px] rounded-md px-[4px] text-left transition-colors hover:bg-accent',
            open && 'bg-accent',
          )}
        >
          {row.state === 'ok' ? (
            <QuotaRing usedPercent={row.usedPercent} severity={row.severity} />
          ) : (
            <QuotaUnknownRing />
          )}
          <ProviderLogo
            adapterId={providerId}
            testId={`provider-quota-glyph-${providerId}`}
            className="size-[15px] rounded"
          />
          <span className={cn('flex-1 text-caption', row.state === 'unknown' ? 'italic text-mf-text-3' : 'text-muted-foreground')}>
            {label}
          </span>
          {row.state === 'ok' ? (
            <>
              <span className={cn('text-caption font-semibold tabular-nums', PERCENT_TEXT[row.severity])}>
                {row.usedPercent}%
              </span>
              <span className="w-[46px] text-right text-micro text-mf-text-4">{rel ?? '—'}</span>
            </>
          ) : (
            <>
              <span className="text-caption font-semibold text-mf-text-3">?</span>
              <span className="w-[46px] text-right text-micro text-mf-text-4">—</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto p-0">
        <QuotaPopover providerId={providerId} label={label} quota={quota} now={now} />
      </PopoverContent>
    </Popover>
  );
}
