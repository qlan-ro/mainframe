import { create } from 'zustand';
import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';
import { applyIfNewer } from './revision-merge.js';

interface AdaptersState {
  adapters: AdapterInfo[];
  loading: boolean;
  setAdapters: (adapters: AdapterInfo[]) => void;
  setLoading: (loading: boolean) => void;
  updateAdapterModels: (adapterId: string, models: AdapterModel[], modelsRevision: number) => void;
  /** Drop the revision baseline (accept-anything) but KEEP models visible. Used on reconnect. */
  resetRevisionBaseline: () => void;
  /** Hard clear — visible blank. Reserved for a genuine daemon switch (desktop has one daemon). */
  resetAdapters: () => void;
}

/** Merge an HTTP snapshot: identity/meta always refresh; models apply only-if-newer. */
function mergeSnapshot(existing: AdapterInfo[], incoming: AdapterInfo[]): AdapterInfo[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      continue;
    }
    const takeModels = applyIfNewer(cur.modelsRevision, inc.modelsRevision);
    byId.set(inc.id, {
      ...inc, // identity/meta from the snapshot
      models: takeModels ? inc.models : cur.models,
      modelsRevision: takeModels ? inc.modelsRevision : cur.modelsRevision,
      catalogSource: takeModels ? inc.catalogSource : cur.catalogSource,
    });
  }
  return [...byId.values()];
}

export const useAdaptersStore = create<AdaptersState>((set) => ({
  adapters: [],
  loading: false,
  setAdapters: (adapters) => set((state) => ({ adapters: mergeSnapshot(state.adapters, adapters) })),
  setLoading: (loading) => set({ loading }),
  updateAdapterModels: (adapterId, models, modelsRevision) =>
    set((state) => {
      const cur = state.adapters.find((a) => a.id === adapterId);
      if (cur) {
        if (!applyIfNewer(cur.modelsRevision, modelsRevision)) return state;
        return {
          adapters: state.adapters.map((a) =>
            a.id === adapterId ? { ...a, models, modelsRevision, catalogSource: 'probed' } : a,
          ),
        };
      }
      // Partial entry so a connect-replay arriving before the HTTP seed is not dropped. The
      // installed:true / planMode:false / id-as-name values are placeholders that BRIEFLY lie;
      // reset-on-connect always fires the full-snapshot fetch right after, and mergeSnapshot
      // overwrites identity from that snapshot, so the window is a few ms.
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
      return { adapters: [...state.adapters, partial] };
    }),
  // Keep last-known models visible; only drop the revision baseline so the next snapshot/replay
  // applies even if it ties the stored revision (a restarted same-port daemon reuses revision 2).
  resetRevisionBaseline: () =>
    set((state) => ({ adapters: state.adapters.map((a) => ({ ...a, modelsRevision: undefined })) })),
  resetAdapters: () => set({ adapters: [] }),
}));
