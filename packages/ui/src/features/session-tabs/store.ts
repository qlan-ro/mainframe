/**
 * session-tabs store — the open session tabs, editor-style: an ordered PINNED
 * set, ONE preview slot, and ONE draft slot. Activating a session fills the
 * preview slot (replacing whatever was previewed); an unsent draft fills the
 * draft slot instead, where a peek at another session cannot displace it until
 * its first send demotes it to preview. Ids are runtime thread ids.
 *
 * Deliberately not zustand-persist: runtime ids aren't boot-stable, and mapping
 * them to storable ids needs the live thread list. `useSessionTabsSync` owns
 * that translation (restore on hydrate, persist on change) via `tabs-model`.
 */
import { create } from 'zustand';
import type { TabSlot, TabsState } from './tabs-model';

interface SessionTabsStore extends TabsState {
  /** Pinned tabs — replaced wholesale on every change, never mutated in place. */
  tabIds: readonly string[];
  /** The one temporary tab; the next activation of an unpinned session replaces it. */
  previewId: string | null;
  /** The unsent draft's tab — temporary too, but protected from replacement. */
  draftId: string | null;
  /** True once the persisted set has been restored against a loaded thread list. */
  hydrated: boolean;
  /** Restored pins lead; pins opened before hydration (boot draft) follow. The
   *  current boot's preview wins over the restored one — it is what's on screen. */
  hydrate: (restored: readonly string[], preview: string | null) => void;
  /**
   * The membership seam, called on every active-thread change. A session
   * already open is left alone; otherwise it lands in the slot the caller
   * names — `preview` for a peek at history, `draft` for the unsent draft the
   * user just created, `pinned` for a tab something else is keeping open.
   */
  ensureTab: (id: string, slot?: TabSlot) => void;
  /** Preview or draft → pinned. A no-op for anything already pinned or not open. */
  pinTab: (id: string) => void;
  closeTab: (id: string) => void;
  /**
   * Rewrite the open set through the sync hook's pure resolver — the store
   * knows neither which ids are still valid, nor how a session's two identities
   * collapse into one, nor when a draft has been sent. One resolver over all
   * three slots, because those transitions move ids BETWEEN slots.
   */
  reconcile: (resolve: (state: TabsState) => TabsState) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export const useSessionTabsStore = create<SessionTabsStore>((set) => ({
  tabIds: [],
  previewId: null,
  draftId: null,
  hydrated: false,
  hydrate: (restored, preview) =>
    set((s) => ({
      hydrated: true,
      tabIds: [...restored, ...s.tabIds.filter((id) => !restored.includes(id))],
      previewId: s.previewId ?? (preview !== null && !restored.includes(preview) ? preview : null),
    })),
  ensureTab: (id, slot = 'preview') =>
    set((s) => {
      if (s.tabIds.includes(id) || s.previewId === id || s.draftId === id) return s;
      if (slot === 'pinned') return { tabIds: [...s.tabIds, id] };
      if (slot === 'draft') return { draftId: id };
      return { previewId: id };
    }),
  pinTab: (id) =>
    set((s) => {
      if (s.tabIds.includes(id)) return s;
      if (s.previewId === id) return { tabIds: [...s.tabIds, id], previewId: null };
      if (s.draftId === id) return { tabIds: [...s.tabIds, id], draftId: null };
      return s;
    }),
  closeTab: (id) =>
    set((s) => {
      if (s.previewId === id) return { previewId: null };
      if (s.draftId === id) return { draftId: null };
      if (!s.tabIds.includes(id)) return s;
      return { tabIds: s.tabIds.filter((t) => t !== id) };
    }),
  reconcile: (resolve) =>
    set((s) => {
      // Resolve against the CURRENT state: a value precomputed in the effect
      // body would be stale after a same-flush `hydrate`.
      const next = resolve({ tabIds: s.tabIds, previewId: s.previewId, draftId: s.draftId });
      // The caller allocates a fresh array on every thread-list tick, so
      // compare content — a new state object would re-render the whole strip
      // while a chat streams.
      if (sameIds(next.tabIds, s.tabIds) && next.previewId === s.previewId && next.draftId === s.draftId) return s;
      return next;
    }),
}));
