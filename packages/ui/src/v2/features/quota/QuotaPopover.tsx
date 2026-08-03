/**
 * The expanded per-provider view: every window with its exact (absolute) reset
 * timestamp, a staleness hint, and a manual refresh. Pure presentation over the
 * `quota-format` view-model; all reasoning lives there.
 */
import { useCallback, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { Button } from '@v2/components/ui/button';
import { cn } from '@v2/lib/utils';
import { refreshQuota } from '@/lib/api/quota';
import { applyProviderQuota } from '@/store/quota';
import { deriveProviderStatus, isProviderStale } from '@/features/quota/quota-lifecycle';
import {
  deriveWindowList,
  formatAbsoluteReset,
  formatRelativeReset,
  formatUsedPercent,
  minutesAgo,
  type QuotaSeverity,
} from '@/features/quota/quota-format';
import { ProviderLogo } from '../shared/ProviderLogo';

/** Only the red band gets its own ink — the preset carries no amber. */
const PERCENT_TEXT: Record<QuotaSeverity, string> = {
  normal: 'text-foreground',
  amber: 'text-foreground',
  red: 'text-destructive',
};

const BAR_FILL: Record<QuotaSeverity, string> = {
  normal: 'bg-primary',
  amber: 'bg-primary',
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid={`provider-quota-refresh-${providerId}`}
      onClick={onRefresh}
      disabled={pending}
      aria-label={`Refresh ${label} quota`}
      className="text-muted-foreground"
    >
      <RefreshCwIcon className={cn(pending && 'animate-spin')} />
      Refresh
    </Button>
  );
}

function QuotaWindowRow({
  providerId,
  label,
  window,
  now,
}: {
  providerId: string;
  label: string;
  window: ReturnType<typeof deriveWindowList>[number];
  now: number;
}) {
  const rel = formatRelativeReset(window.resetsAt, now);
  const resetSpeech = window.resetsAt != null ? `resets in ${rel}` : 'reset time unknown';

  return (
    <li
      data-testid={`provider-quota-window-${providerId}-${window.kind}`}
      aria-label={`${label} ${window.label}: ${formatUsedPercent(window.usedPercent)}% used, ${resetSpeech}`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className={cn('font-semibold tabular-nums', PERCENT_TEXT[window.severity])}>
          {formatUsedPercent(window.usedPercent)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', BAR_FILL[window.severity])}
          style={{ width: `${window.usedPercent}%` }}
        />
      </div>
      {window.resetsAt != null && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>resets in {rel}</span>
          <span>{formatAbsoluteReset(window.resetsAt)}</span>
        </div>
      )}
    </li>
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
    <div data-testid={`provider-quota-popover-${providerId}`} className="w-64 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold text-foreground">
          <ProviderLogo
            adapterId={providerId}
            testId={`provider-quota-popover-glyph-${providerId}`}
            className="size-4 rounded"
          />
          {label}
        </span>
        <span data-testid={`provider-quota-freshness-${providerId}`} className="text-[10px] text-muted-foreground">
          {quota == null ? '—' : `${stale ? 'stale · ' : ''}${minutesAgo(quota.observedAt, now)}m ago`}
        </span>
      </div>

      {!known ? (
        <p data-testid={`provider-quota-unknown-${providerId}`} className="leading-relaxed text-muted-foreground">
          Quota unknown — this provider reports no trustworthy plan quota (API-key auth, or the data has expired).
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {windows.map((w) => (
            <QuotaWindowRow key={`${w.kind}-${w.label}`} providerId={providerId} label={label} window={w} now={now} />
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex justify-end border-t border-border pt-2">
        <RefreshButton providerId={providerId} label={label} />
      </div>
    </div>
  );
}
