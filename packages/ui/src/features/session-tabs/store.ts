/**
 * session-tabs store — the open session tabs, editor-style: an ordered PINNED
 * set plus ONE preview slot. Activating a session fills the preview slot
 * (replacing whatever was previewed); pinning moves it into the pinned set,
 * where it stays until closed. Ids are runtime thread ids in display order.
 *
 * Deliberately not zustand-persist: runtime ids aren't boot-stable, and mapping
 * them to storable ids needs the live thread list. `useSessionTabsSync` owns
 * that translation (restore on hydrate, persist on change) via `tabs-model`.
 */
import { create } from 'zustand';

interface SessionTabsStore {
  /** Pinned tabs — replaced wholesale on every change, never mutated in place. */
  tabIds: readonly string[];
  /** The one temporary tab; the next activation of an unpinned session replaces it. */
  previewId: string | null;
  /** True once the persisted set has been restored against a loaded thread list. */
  hydrated: boolean;
  /** Restored pins lead; pins opened before hydration (boot draft) follow. The
   *  current boot's preview wins over the restored one — it is what's on screen. */
  hydrate: (restored: readonly string[], preview: string | null) => void;
  /**
   * The membership seam, called on every active-thread change. A session
   * already open (pinned or previewed) is left alone; otherwise it lands in
   * the preview slot — or straight in the pinned set when `pin` is true (a
   * draft the user just created is a deliberate tab, not a peek).
   */
  ensureTab: (id: string, opts?: { pin?: boolean }) => void;
  /** Preview → pinned. A no-op for anything already pinned or not open. */
  pinTab: (id: string) => void;
  closeTab: (id: string) => void;
  /**
   * Rewrite the open set through the sync hook's pure resolver — the store
   * knows neither which ids are still valid nor how a session's two identities
   * collapse into one. The preview id goes through its own resolver; a preview
   * whose canonical id is pinned dissolves into that pin.
   */
  reconcile: (
    resolvePinned: (ids: readonly string[]) => readonly string[],
    resolvePreview: (id: string | null) => string | null,
  ) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export const useSessionTabsStore = create<SessionTabsStore>((set) => ({
  tabIds: [],
  previewId: null,
  hydrated: false,
  hydrate: (restored, preview) =>
    set((s) => ({
      hydrated: true,
      tabIds: [...restored, ...s.tabIds.filter((id) => !restored.includes(id))],
      previewId: s.previewId ?? (preview !== null && !restored.includes(preview) ? preview : null),
    })),
  ensureTab: (id, opts) =>
    set((s) => {
      if (s.tabIds.includes(id) || s.previewId === id) return s;
      if (opts?.pin) return { tabIds: [...s.tabIds, id] };
      return { previewId: id };
    }),
  pinTab: (id) =>
    set((s) => {
      if (s.previewId !== id || s.tabIds.includes(id)) return s;
      return { tabIds: [...s.tabIds, id], previewId: null };
    }),
  closeTab: (id) =>
    set((s) => {
      if (s.previewId === id) return { previewId: null };
      if (!s.tabIds.includes(id)) return s;
      return { tabIds: s.tabIds.filter((t) => t !== id) };
    }),
  reconcile: (resolvePinned, resolvePreview) =>
    set((s) => {
      // Resolve against the CURRENT ids: an array precomputed in the effect
      // body would be stale after a same-flush `hydrate`.
      const nextPinned = resolvePinned(s.tabIds);
      const rawPreview = resolvePreview(s.previewId);
      const nextPreview = rawPreview !== null && nextPinned.includes(rawPreview) ? null : rawPreview;
      // The caller allocates a fresh array on every thread-list tick, so
      // compare content — a new state object would re-render the whole strip
      // while a chat streams.
      if (sameIds(nextPinned, s.tabIds) && nextPreview === s.previewId) return s;
      return { tabIds: nextPinned, previewId: nextPreview };
    }),
}));
