/**
 * One collapsed provider row inside the quota section. Renders that provider's
 * tightest window (ring + % + relative reset) and opens a side="top" popover
 * with every window on click.
 */
import { useState } from 'react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@v2/components/ui/popover';
import { SidebarMenuButton } from '@v2/components/ui/sidebar';
import { cn } from '@v2/lib/utils';
import {
  deriveQuotaRow,
  formatRelativeReset,
  formatUsedPercent,
  type QuotaSeverity,
} from '@/features/quota/quota-format';
import { ProviderLogo } from '../shared/ProviderLogo';
import { QuotaPopover } from './QuotaPopover';
import { QuotaRing, QuotaUnknownRing } from './QuotaRing';

/** Only the red band gets its own ink — the preset carries no amber. */
const PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-foreground',
  amber: 'text-foreground',
  red: 'text-destructive',
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
  const row = deriveQuotaRow(quota, now);
  const rel = row.state === 'ok' ? formatRelativeReset(row.resetsAt, now) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          size="sm"
          data-testid={`provider-quota-row-${providerId}`}
          data-state-kind={row.state}
          data-active={open}
          aria-label={rowAriaLabel(label, quota, now)}
        >
          {row.state === 'ok' ? (
            <QuotaRing usedPercent={row.usedPercent} severity={row.severity} />
          ) : (
            <QuotaUnknownRing />
          )}
          <ProviderLogo
            adapterId={providerId}
            testId={`provider-quota-glyph-${providerId}`}
            className="size-4 rounded"
          />
          <span className={cn('flex-1 truncate', row.state === 'unknown' ? 'text-muted-foreground italic' : undefined)}>
            {label}
          </span>
          {row.state === 'ok' ? (
            <>
              <span className={cn('font-semibold tabular-nums', PERCENT_TEXT[row.severity])}>
                {formatUsedPercent(row.usedPercent)}%
              </span>
              <span className="w-10 text-right text-[10px] text-muted-foreground">{rel ?? '—'}</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-muted-foreground">?</span>
              <span className="w-10 text-right text-[10px] text-muted-foreground">—</span>
            </>
          )}
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto p-0">
        <QuotaPopover providerId={providerId} label={label} quota={quota} now={now} />
      </PopoverContent>
    </Popover>
  );
}
