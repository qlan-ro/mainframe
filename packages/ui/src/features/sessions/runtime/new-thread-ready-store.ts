/**
 * new-thread-ready-store — the reactive bridge from the config picker to the
 * composer on a brand-new (__LOCALID_*) thread.
 *
 * The draft-config Map (`draft-config.ts`) is a plain module singleton — writing
 * to it does NOT re-render anything. So once project+adapter are chosen the picker
 * also marks the local id ready here; ChatSurface subscribes to this store and
 * switches the surface from the new-session picker / welcome flow to ChatThread
 * (which carries the real composer) so the user can type and send the first
 * message.
 *
 * Lifecycle: the picker marks ready; the new-thread coordinator clears it on the
 * first send (alongside clearing the draft) so a recycled local id starts fresh.
 * Used both as a React hook (ChatSurface/picker) and imperatively
 * (`useNewThreadReady.getState()`) from the non-React coordinator.
 */
import { create } from 'zustand';

interface NewThreadReadyState {
  /** Local thread ids whose draft config is complete (project+adapter chosen). */
  readonly readyIds: ReadonlySet<string>;
  isReady: (localId: string) => boolean;
  markReady: (localId: string) => void;
  clearReady: (localId: string) => void;
}

export const useNewThreadReady = create<NewThreadReadyState>((set, get) => ({
  readyIds: new Set<string>(),
  isReady: (localId) => get().readyIds.has(localId),
  markReady: (localId) =>
    set((state) => {
      if (state.readyIds.has(localId)) return state; // stable ref — no churn
      const next = new Set(state.readyIds);
      next.add(localId);
      return { readyIds: next };
    }),
  clearReady: (localId) =>
    set((state) => {
      if (!state.readyIds.has(localId)) return state; // stable ref — no churn
      const next = new Set(state.readyIds);
      next.delete(localId);
      return { readyIds: next };
    }),
}));
