/**
 * store/cli-update.ts — per-provider CLI version/update status (todo #405). Modeled on
 * `store/quota.ts`: seeded from GET /api/providers/cli-status (only the providers the
 * daemon knows how to update) and kept fresh by the `provider.cli.updated` subscriber
 * installed once at the app root. Keyed by `adapterId`.
 *
 * Unlike quota, both the REST seed and the WS event always carry the FULL status for a
 * provider — the contract is "replace the stored copy by status.adapterId" — so there is
 * no freshness guard here (no `observedAt` to order by, and nothing to merge).
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ProviderCliStatus } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';

interface CliUpdateState {
  byId: Record<string, ProviderCliStatus>;
}

export const useCliUpdateStore = create<CliUpdateState>(() => ({ byId: {} }));

/** The latest known CLI status for a provider, or `undefined` when the daemon doesn't
 *  know how to update it (that adapter renders no version section). */
export function useProviderCliStatus(adapterId: string): ProviderCliStatus | undefined {
  return useCliUpdateStore((s) => s.byId[adapterId]);
}

/** Providers with something to act on — an available update or a run in progress —
 *  sorted by id. Drives the rail update button's menu. */
export function useProviderCliUpdates(): ProviderCliStatus[] {
  return useCliUpdateStore(
    useShallow((s) =>
      Object.values(s.byId)
        .filter((status) => status.updateAvailable || status.update?.state === 'running')
        .sort((a, b) => a.adapterId.localeCompare(b.adapterId)),
    ),
  );
}

/** Replace one provider's status wholesale (REST reply or WS push alike). */
export function applyProviderCliStatus(status: ProviderCliStatus): void {
  useCliUpdateStore.setState((s) => ({ byId: { ...s.byId, [status.adapterId]: status } }));
}

/** Apply the POST cli/update reply unless a push for the same run already landed: the
 *  daemon emits `provider.cli.updated` before it replies, so progress (or even the
 *  finished state) can arrive first, and the "running" reply must not roll it back. */
export function applyProviderCliUpdateStarted(status: ProviderCliStatus): void {
  useCliUpdateStore.setState((s) => {
    const current = s.byId[status.adapterId]?.update?.startedAt;
    const started = status.update?.startedAt;
    if (current !== undefined && started !== undefined && current >= started) return s;
    return { byId: { ...s.byId, [status.adapterId]: status } };
  });
}

/** Seed the whole list (GET reply) in one state update. */
export function seedProviderCliStatuses(list: ProviderCliStatus[]): void {
  useCliUpdateStore.setState((s) => {
    const byId = { ...s.byId };
    for (const status of list) byId[status.adapterId] = status;
    return { byId };
  });
}

/** Hard clear — reserved for a genuine daemon SWITCH (disposeDaemonSession / resetDaemonScopedStores). */
export function resetProviderCliStatuses(): void {
  useCliUpdateStore.setState({ byId: {} });
}

/** Register the single always-on `provider.cli.updated` subscriber. Mount once at the app root. */
export function installProviderCliStatusSubscriber(): () => void {
  return daemonWs.onEvent((event) => {
    if (event.type !== 'provider.cli.updated') return;
    applyProviderCliStatus(event.status);
  });
}
