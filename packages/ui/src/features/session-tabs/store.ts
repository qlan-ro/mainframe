/**
 * session-tabs store — the OPEN SET of session tabs, as runtime thread ids in
 * display order.
 *
 * Deliberately not zustand-persist: runtime ids aren't boot-stable, and mapping
 * them to storable ids needs the live thread list. `useSessionTabsSync` owns
 * that translation (restore on hydrate, persist on change) via `tabs-model`.
 */
import { create } from 'zustand';

interface SessionTabsStore {
  /** Replaced wholesale on every change — the open set is never mutated in place. */
  tabIds: readonly string[];
  /** True once the persisted set has been restored against a loaded thread list. */
  hydrated: boolean;
  /** Restored ids lead; tabs opened before hydration (boot draft/auto-select) follow. */
  hydrate: (restored: readonly string[]) => void;
  /** Idempotent append — the membership seam calls this on every active-thread change. */
  ensureTab: (id: string) => void;
  closeTab: (id: string) => void;
  /**
   * Rewrite the open set through the sync hook's pure resolver — the store
   * knows neither which ids are still valid nor how a session's two identities
   * collapse into one.
   */
  reconcile: (resolve: (ids: readonly string[]) => readonly string[]) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export const useSessionTabsStore = create<SessionTabsStore>((set) => ({
  tabIds: [],
  hydrated: false,
  hydrate: (restored) =>
    set((s) => ({
      hydrated: true,
      tabIds: [...restored, ...s.tabIds.filter((id) => !restored.includes(id))],
    })),
  ensureTab: (id) => set((s) => (s.tabIds.includes(id) ? s : { tabIds: [...s.tabIds, id] })),
  closeTab: (id) => set((s) => ({ tabIds: s.tabIds.filter((t) => t !== id) })),
  reconcile: (resolve) =>
    set((s) => {
      // Resolve against the CURRENT ids: an array precomputed in the effect
      // body would be stale after a same-flush `hydrate`.
      const next = resolve(s.tabIds);
      // The caller allocates a fresh array on every thread-list tick, so
      // compare content — a new state object would re-render the whole strip
      // while a chat streams.
      return sameIds(next, s.tabIds) ? s : { tabIds: next };
    }),
}));
