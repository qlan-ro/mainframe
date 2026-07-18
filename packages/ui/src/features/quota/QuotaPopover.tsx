/**
 * QuotaPopover — the expanded per-provider view: every window with its exact
 * (absolute) reset timestamp, a staleness hint, and a manual refresh. Pure
 * presentation over the `quota-format` view-model; all reasoning lives there.
 */
import { useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { ProviderLogo } from '@/features/shared/ProviderLogo';
import { refreshQuota } from '@/lib/api/quota';
import { applyProviderQuota } from '@/store/quota';
import {
  deriveProviderStatus,
  isProviderStale,
} from './quota-lifecycle';
import {
  deriveWindowList,
  formatAbsoluteReset,
  formatRelativeReset,
  minutesAgo,
  type QuotaSeverity,
} from './quota-format';

const PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-foreground',
  amber: 'text-mf-warning',
  red: 'text-destructive',
};

const BAR_FILL: Record<QuotaSeverity, string> = {
  normal: 'bg-mf-success',
  amber: 'bg-mf-warning',
  red: 'bg-destructive',
};

function RefreshButton({ providerId, label }: { providerId: string; label: string }) {
  const [pending, setPending] = useState(false);
  const onRefresh = useCallback(() => {
    setPending(true);
    refreshQuota(providerId)
      .then((quota) => {
        if (quota) applyProviderQuota(providerId, quota);
      })
      .catch((err: unknown) => console.warn(`[quota] refresh failed for ${providerId}`, err))
      .finally(() => setPending(false));
  }, [providerId]);
  return (
    <button
      type="button"
      data-testid={`provider-quota-refresh-${providerId}`}
      onClick={onRefresh}
      disabled={pending}
      aria-label={`Refresh ${label} quota`}
      className="flex items-center gap-[5px] rounded-md px-[6px] py-[3px] text-caption text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      <RefreshCw size={11} className={cn(pending && 'animate-spin')} aria-hidden />
      Refresh
    </button>
  );
}

export function QuotaPopover({
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
  const known = quota != null && deriveProviderStatus(quota, now) === 'ok';
  const stale = quota != null && isProviderStale(quota, now);
  const windows = quota && known ? deriveWindowList(quota) : [];

  return (
    <div data-testid={`provider-quota-popover-${providerId}`} className="w-[262px] p-[13px] text-caption">
      <div className="mb-[8px] flex items-center justify-between">
        <span className="flex items-center gap-[7px] font-semibold text-foreground">
          <ProviderLogo adapterId={providerId} testId={`provider-quota-popover-glyph-${providerId}`} className="size-[15px] rounded" />
          {label}
        </span>
        <span data-testid={`provider-quota-freshness-${providerId}`} className="text-micro text-mf-text-3">
          {quota == null ? '—' : `${stale ? 'stale · ' : ''}${minutesAgo(quota.observedAt, now)}m ago`}
        </span>
      </div>

      {!known ? (
        <p data-testid={`provider-quota-unknown-${providerId}`} className="leading-relaxed text-mf-text-3">
          Quota unknown — this provider reports no trustworthy plan quota (API-key auth, or the data has expired).
        </p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {windows.map((w) => {
            const rel = formatRelativeReset(w.resetsAt, now);
            const resetSpeech = w.resetsAt != null ? `resets in ${rel}` : 'reset time unknown';
            return (
              <li
                key={`${w.kind}-${w.label}`}
                data-testid={`provider-quota-window-${providerId}-${w.kind}`}
                aria-label={`${label} ${w.label}: ${w.usedPercent}% used, ${resetSpeech}`}
              >
                <div className="mb-[4px] flex items-baseline justify-between">
                  <span className="font-medium text-foreground">{w.label}</span>
                  <span className={cn('font-semibold tabular-nums', PERCENT_TEXT[w.severity])}>{w.usedPercent}%</span>
                </div>
                <div className="h-[5px] w-full overflow-hidden rounded-[3px] bg-border">
                  <span className={cn('block h-full rounded-[3px]', BAR_FILL[w.severity])} style={{ width: `${w.usedPercent}%` }} />
                </div>
                {w.resetsAt != null && (
                  <div className="mt-[4px] flex justify-between text-micro text-mf-text-3">
                    <span>resets in {rel}</span>
                    <span>{formatAbsoluteReset(w.resetsAt)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-[10px] flex justify-end border-t border-border pt-[8px]">
        <RefreshButton providerId={providerId} label={label} />
      </div>
    </div>
  );
}
