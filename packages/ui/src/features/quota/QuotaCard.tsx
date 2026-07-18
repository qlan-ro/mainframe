/**
 * QuotaCard — the ambient plan-quota surface in the sidebar footer, directly
 * above the daemon switcher. Mirrors the daemon button's chrome (bordered card)
 * and always shows one row per quota-capable provider (Claude + Codex), even
 * when a provider reports nothing (designed "quota unknown" row). Pure wiring:
 * each row reads its own blob from the quota store and derives its view via
 * `quota-format`.
 */
import { useProviderQuota } from '@/store/quota';
import { QUOTA_PROVIDERS } from './quota-format';
import { QuotaProviderRow } from './QuotaProviderRow';

function ConnectedQuotaRow({ providerId, label, now }: { providerId: string; label: string; now: number }) {
  const quota = useProviderQuota(providerId);
  return <QuotaProviderRow providerId={providerId} label={label} quota={quota} now={now} />;
}

/** `now` is injectable so the derived staleness/expiry states are deterministic in tests. */
export function QuotaCard({ now = Date.now() }: { now?: number }) {
  return (
    <div
      data-testid="provider-quota-card"
      className="flex flex-col gap-[2px] rounded-xl border border-border bg-mf-chip/40 px-[9px] py-[8px]"
    >
      <span className="px-[4px] pb-[3px] text-micro font-bold uppercase tracking-wide text-mf-text-3">Quota</span>
      {QUOTA_PROVIDERS.map((p) => (
        <ConnectedQuotaRow key={p.id} providerId={p.id} label={p.label} now={now} />
      ))}
    </div>
  );
}
