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
  tabIds: string[];
  /** True once the persisted set has been restored against a loaded thread list. */
  hydrated: boolean;
  /** Restored ids lead; tabs opened before hydration (boot draft/auto-select) follow. */
  hydrate: (restored: string[]) => void;
  /** Idempotent append — the membership seam calls this on every active-thread change. */
  ensureTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Drop tabs whose thread vanished (archived / deleted mid-run). */
  pruneTo: (valid: ReadonlySet<string>) => void;
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
  pruneTo: (valid) =>
    set((s) => {
      const next = s.tabIds.filter((id) => valid.has(id));
      return next.length === s.tabIds.length ? s : { tabIds: next };
    }),
}));
