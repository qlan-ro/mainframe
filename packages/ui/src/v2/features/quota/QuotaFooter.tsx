/**
 * The ambient plan-quota surface in the sidebar footer, above the daemon
 * switcher. Always shows one row per quota-capable provider (Claude + Codex),
 * even when a provider reports nothing (designed "quota unknown" row). Pure
 * wiring: each row reads its own blob from the quota store and derives its view
 * via `quota-format`.
 *
 * A footer component, not a section: no label and no `SidebarGroup`, since the
 * footer is already its own region and quota is ambient status rather than a
 * part of the panel's outline. It reads as a `Card` instead, matching the
 * shipped surface's bordered chip. Stock `Card` is a page-level container, so
 * three of its base classes are dialled down here: no shadow, no row gap, and a
 * 4px inset instead of 24px — the rows carry their own padding.
 */
import { useEffect, useState } from 'react';
import { Card } from '@v2/components/ui/card';
import { SidebarMenu, SidebarMenuItem } from '@v2/components/ui/sidebar';
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
    <Card data-testid="provider-quota-card" className="gap-0 p-1 shadow-none">
      <SidebarMenu>
        {QUOTA_PROVIDERS.map((p) => (
          <SidebarMenuItem key={p.id}>
            <ConnectedQuotaRow providerId={p.id} label={p.label} now={effectiveNow} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </Card>
  );
}
