/**
 * store/quota.ts — account-wide provider quota (plan rate-limit headroom, NOT
 * per-chat context usage). Modeled on `store/adapters.ts`: seeded from
 * GET /api/providers/:id/quota for both quota-capable providers and kept fresh
 * by the `provider.quota.updated` subscriber installed once at the app root.
 *
 * Keyed by adapter id. Only-if-newer by `observedAt` so a late REST seed can't
 * clobber a fresher WS push (or vice-versa). No quota logic here — pure wiring;
 * the render layer derives its view via `features/quota/quota-format.ts`.
 */
import { create } from 'zustand';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';

interface QuotaState {
  byId: Record<string, ProviderQuota>;
}

export const useQuotaStore = create<QuotaState>(() => ({ byId: {} }));

/** The latest known quota for a provider, or `undefined` when none is known. */
export function useProviderQuota(adapterId: string): ProviderQuota | undefined {
  return useQuotaStore((s) => s.byId[adapterId]);
}

/** Apply a quota blob, keeping the existing one when it is at least as fresh. */
export function applyProviderQuota(adapterId: string, quota: ProviderQuota): void {
  useQuotaStore.setState((s) => {
    const cur = s.byId[adapterId];
    if (cur && cur.observedAt >= quota.observedAt) return s;
    return { byId: { ...s.byId, [adapterId]: quota } };
  });
}

/** Hard clear — reserved for a genuine daemon SWITCH (disposeDaemonSession). */
export function resetQuota(): void {
  useQuotaStore.setState({ byId: {} });
}

/** Register the single always-on `provider.quota.updated` subscriber. Mount once at the app root. */
export function installProviderQuotaSubscriber(): () => void {
  return daemonWs.onEvent((event) => {
    if (event.type !== 'provider.quota.updated') return;
    applyProviderQuota(event.adapterId, event.quota);
  });
}
