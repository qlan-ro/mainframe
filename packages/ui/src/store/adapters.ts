/**
 * store/adapters.ts — the shared adapter catalog. Seeded from GET /api/adapters and kept
 * fresh by `adapter.models.updated`, applied only-if-newer by `modelsRevision`. Reset on
 * daemon switch/reconnect (module-level store survives the AppShell remount).
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';

interface AdaptersState {
  byId: Record<string, AdapterInfo>;
}

export const useAdaptersStore = create<AdaptersState>(() => ({ byId: {} }));

const EMPTY: readonly AdapterInfo[] = [];
/** Memoized: callers pass this array as a `useEffect` dep, and a fresh
 *  `Object.values()` each render re-armed those effects until React threw #185. */
export function useAdapters(): AdapterInfo[] {
  const byId = useAdaptersStore((s) => s.byId);
  return useMemo(() => (Object.keys(byId).length ? Object.values(byId) : (EMPTY as AdapterInfo[])), [byId]);
}

function isNewer(current: number | undefined, incoming: number | undefined): boolean {
  if (incoming === undefined) return false;
  return current === undefined || incoming > current;
}

export function seedAdapters(list: AdapterInfo[]): void {
  useAdaptersStore.setState((s) => {
    const byId = { ...s.byId };
    for (const inc of list) {
      const cur = byId[inc.id];
      if (!cur) {
        byId[inc.id] = inc;
        continue;
      }
      const takeModels = isNewer(cur.modelsRevision, inc.modelsRevision);
      byId[inc.id] = {
        ...inc,
        models: takeModels ? inc.models : cur.models,
        modelsRevision: takeModels ? inc.modelsRevision : cur.modelsRevision,
        catalogSource: takeModels ? inc.catalogSource : cur.catalogSource,
      };
    }
    return { byId };
  });
}

export function applyAdapterModels(adapterId: string, models: AdapterModel[], modelsRevision: number): void {
  useAdaptersStore.setState((s) => {
    const cur = s.byId[adapterId];
    if (cur) {
      if (!isNewer(cur.modelsRevision, modelsRevision)) return s;
      return { byId: { ...s.byId, [adapterId]: { ...cur, models, modelsRevision, catalogSource: 'probed' } } };
    }
    // Placeholder identity (installed:true / planMode:false / id-as-name) that BRIEFLY lies until
    // the seed that follows reset-on-connect refreshes it via seedAdapters (blocker #11). The
    // ordering guarantee: seedAdaptersFor always fires getAdapters right after resetRevisionBaseline,
    // so the real snapshot overwrites identity within a few ms.
    const partial: AdapterInfo = {
      id: adapterId,
      name: adapterId,
      description: '',
      installed: true,
      models,
      modelsRevision,
      catalogSource: 'probed',
      capabilities: { planMode: false },
    };
    return { byId: { ...s.byId, [adapterId]: partial } };
  });
}

/** Drop the revision baseline (accept-anything) but KEEP models visible — used on reconnect/reseed
 *  so a restarted same-port daemon's tied-revision snapshot still applies without a blank flash. */
export function resetRevisionBaseline(): void {
  useAdaptersStore.setState((s) => {
    const byId: Record<string, AdapterInfo> = {};
    for (const [id, a] of Object.entries(s.byId)) byId[id] = { ...a, modelsRevision: undefined };
    return { byId };
  });
}

/** Hard clear — visible blank. Reserved for a genuine daemon SWITCH (disposeDaemonSession). */
export function resetAdapters(): void {
  useAdaptersStore.setState({ byId: {} });
}

/** Register the single always-on `adapter.models.updated` subscriber. Mount once at the app root. */
export function installAdapterModelsSubscriber(): () => void {
  return daemonWs.onEvent((event) => {
    if (event.type !== 'adapter.models.updated') return;
    applyAdapterModels(event.adapterId, event.models, event.modelsRevision);
  });
}
