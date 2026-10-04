/**
 * The ambient plan-quota surface in the sidebar footer, above the daemon
 * switcher. Always shows one row per quota-capable provider (Claude + Codex),
 * even when a provider reports nothing (designed "quota unknown" row). Pure
 * wiring: each row reads its own blob from the quota store and derives its view
 * via `quota-format`.
 *
 * A footer component, not a section: no label and no `SidebarGroup`, since the
 * footer is already its own region and quota is ambient status rather than a
 * part of the panel's outline. One 22px row per provider, no card around them —
 * the footer's own hairlines do the separating.
 */
import { useEffect, useState } from 'react';
import { QUOTA_PROVIDERS } from '@/features/quota/quota-format';
import { useProviderQuota } from '@/store/quota';
import { QuotaProviderRow } from './QuotaProviderRow';

const TICK_INTERVAL_MS = 30_000;

/** Re-renders every 30s so an idle panel still crosses resetsAt/staleness thresholds. */
function useTickingNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ConnectedQuotaRow({ providerId, label, now }: { providerId: string; label: string; now: number }) {
  const quota = useProviderQuota(providerId);
  return <QuotaProviderRow providerId={providerId} label={label} quota={quota} now={now} />;
}

/** `now` is injectable so the derived staleness/expiry states are deterministic in tests. */
export function QuotaFooter({ now }: { now?: number }) {
  const ticking = useTickingNow();
  const effectiveNow = now ?? ticking;

  return (
    <div data-testid="provider-quota-card" className="flex flex-col gap-0.5 px-1">
      {QUOTA_PROVIDERS.map((p) => (
        <ConnectedQuotaRow key={p.id} providerId={p.id} label={p.label} now={effectiveNow} />
      ))}
    </div>
  );
}
