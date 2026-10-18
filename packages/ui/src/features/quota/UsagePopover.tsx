/**
 * The usage capsule's popover body: every quota-capable provider in one card,
 * each window on its own 18px line (label, bar, percent, time to reset), a
 * hairline between providers and one refresh for all of them. Pure
 * presentation over the `quota-format` view-model; all reasoning lives there.
 */
import { useCallback, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { refreshQuota } from '@/lib/api/quota';
import { applyProviderQuota } from '@/store/quota';
import { deriveProviderStatus, isProviderStale } from '@/features/quota/quota-lifecycle';
import {
  QUOTA_PROVIDERS,
  deriveWindowList,
  formatAbsoluteReset,
  formatRelativeReset,
  formatUsedPercent,
  minutesAgo,
  type QuotaWindowVm,
} from '@/features/quota/quota-format';
import { ProviderDot } from '../shared/ProviderDot';
import { QUOTA_BAR_FILL, QUOTA_PERCENT_TEXT } from './quota-severity';

function RefreshAllButton() {
  const [pending, setPending] = useState(false);
  const onRefresh = useCallback(() => {
    setPending(true);
    const pulls = QUOTA_PROVIDERS.map((p) =>
      refreshQuota(p.id)
        .then((quota) => {
          if (quota) applyProviderQuota(p.id, quota);
        })
        .catch((err: unknown) => console.warn(`[quota] refresh failed for ${p.id}`, err)),
    );
    void Promise.all(pulls).finally(() => setPending(false));
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="usage-popover-refresh"
      onClick={onRefresh}
      disabled={pending}
      aria-label="Refresh usage"
      className="-ml-2 text-muted-foreground"
    >
      <RefreshCwIcon className={cn(pending && 'animate-spin')} />
      Refresh
    </Button>
  );
}

function WindowRow({
  providerId,
  label,
  window,
  now,
}: {
  providerId: string;
  label: string;
  window: QuotaWindowVm;
  now: number;
}) {
  const rel = formatRelativeReset(window.resetsAt, now);
  const percent = formatUsedPercent(window.usedPercent);
  return (
    <li
      data-testid={`usage-popover-window-${providerId}-${window.kind}`}
      aria-label={`${label} ${window.label}: ${percent}% used, ${rel ? `resets in ${rel}` : 'reset time unknown'}`}
      title={window.resetsAt != null ? `Resets ${formatAbsoluteReset(window.resetsAt)}` : undefined}
      className="flex h-4.5 items-center gap-2 text-xs tabular-nums"
    >
      <span className="w-20 shrink-0 truncate text-muted-foreground">{window.label}</span>
      <Progress
        value={window.usedPercent}
        className={cn('h-0.75 min-w-0 flex-1 bg-muted', QUOTA_BAR_FILL[window.severity])}
      />
      <span className={cn('w-8 shrink-0 text-right', QUOTA_PERCENT_TEXT[window.severity])}>{percent}%</span>
      <span className="w-20 shrink-0 text-right whitespace-nowrap text-muted-foreground">
        {rel ? `resets ${rel}` : '—'}
      </span>
    </li>
  );
}

function ProviderSection({
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
    <section data-testid={`usage-popover-provider-${providerId}`} className="flex flex-col gap-1.5">
      <div className="mt-0.5 flex items-center gap-1.5">
        <ProviderDot adapterId={providerId} />
        <span className="flex-1 font-medium text-foreground">{label}</span>
        <span data-testid={`usage-popover-freshness-${providerId}`} className="text-xs text-muted-foreground">
          {quota == null ? '—' : `${stale ? 'stale · ' : ''}${minutesAgo(quota.observedAt, now)}m ago`}
        </span>
      </div>
      {known ? (
        <ul className="flex flex-col gap-1.5">
          {windows.map((w) => (
            <WindowRow key={`${w.kind}-${w.label}`} providerId={providerId} label={label} window={w} now={now} />
          ))}
        </ul>
      ) : (
        <p
          data-testid={`usage-popover-unknown-${providerId}`}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          Quota unknown — no trustworthy plan quota (API-key auth, or the data has expired).
        </p>
      )}
    </section>
  );
}

export function UsagePopover({ byId, now }: { byId: Record<string, ProviderQuota | undefined>; now: number }) {
  return (
    <div data-testid="usage-popover" className="flex flex-col gap-1.5 text-sm">
      {QUOTA_PROVIDERS.map((p, i) => (
        <div key={p.id} className={cn(i > 0 && 'mt-1 border-t border-border pt-2.5')}>
          <ProviderSection providerId={p.id} label={p.label} quota={byId[p.id]} now={now} />
        </div>
      ))}
      <div className="mt-0.5">
        <RefreshAllButton />
      </div>
    </div>
  );
}
