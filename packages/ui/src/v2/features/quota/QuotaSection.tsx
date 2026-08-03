/**
 * The ambient plan-quota surface in the sidebar footer, above the daemon
 * switcher. Always shows one row per quota-capable provider (Claude + Codex),
 * even when a provider reports nothing (designed "quota unknown" row). Pure
 * wiring: each row reads its own blob from the quota store and derives its view
 * via `quota-format`.
 *
 * The shipped surface is a bordered chip card; here the footer already sits on
 * `--sidebar`, so it is a plain labelled group.
 */
import { useEffect, useState } from 'react';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem } from '@v2/components/ui/sidebar';
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
export function QuotaSection({ now }: { now?: number }) {
  const ticking = useTickingNow();
  const effectiveNow = now ?? ticking;

  return (
    <SidebarGroup data-testid="provider-quota-card" className="p-0">
      <SidebarGroupLabel className="pl-2">Quota</SidebarGroupLabel>
      <SidebarMenu>
        {QUOTA_PROVIDERS.map((p) => (
          <SidebarMenuItem key={p.id}>
            <ConnectedQuotaRow providerId={p.id} label={p.label} now={effectiveNow} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
