/**
 * discarded-drafts — suppresses useNewThreadAutoConfig from instantly
 * re-arming a draft the user just explicitly discarded (✕) while a project
 * pill is active.
 *
 * Bug this guards against: discarding a draft clears its draft-config + ready
 * flag for the reused `__LOCALID_*` slot, then asynchronously switches the
 * active thread away — but `switchToThread` hasn't landed yet, so there is a
 * real render where the slot still looks like a fresh, unconfigured
 * `__LOCALID_*` thread. useNewThreadAutoConfig's only gate is "no draft, not
 * ready, still `__LOCALID_*`, still new" — all four are true again the
 * instant the discard's own resets land, so it immediately re-seeds the very
 * draft the user just closed. This never showed in the "All" view because
 * useNewThreadAutoConfig is already a no-op without an active project filter.
 *
 * Cleared by resetNewThreadDraft — the canonical "start a fresh New action"
 * reset point (SessionsNewButton's pill-active click, its project-picker
 * pick(), and the ⌘N hotkey all call it) — so a genuinely new New for the
 * recycled localId arms normally again.
 */
import { create } from 'zustand';

interface DiscardedDraftState {
  readonly ids: ReadonlySet<string>;
  mark: (localId: string) => void;
  clear: (localId: string) => void;
}

export const useDiscardedDraftStore = create<DiscardedDraftState>((set) => ({
  ids: new Set<string>(),
  mark: (localId) =>
    set((s) => {
      if (s.ids.has(localId)) return s; // stable ref — no churn
      const next = new Set(s.ids);
      next.add(localId);
      return { ids: next };
    }),
  clear: (localId) =>
    set((s) => {
      if (!s.ids.has(localId)) return s; // stable ref — no churn
      const next = new Set(s.ids);
      next.delete(localId);
      return { ids: next };
    }),
}));

// Imperative wrappers — mirrors draft-config.ts / new-thread-ready-store.ts:
// onDiscard and the auto-config effect both call these synchronously, outside
// of a render, so they read/write the store's getState() directly.
export const markDraftDiscarded = (localId: string): void => useDiscardedDraftStore.getState().mark(localId);
export const isDraftDiscarded = (localId: string): boolean => useDiscardedDraftStore.getState().ids.has(localId);
export const clearDraftDiscarded = (localId: string): void => useDiscardedDraftStore.getState().clear(localId);
