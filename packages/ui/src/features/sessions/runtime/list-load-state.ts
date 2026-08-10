/**
 * Did `adapter.list()` ever come back this app-run?
 *
 * Nothing in the aui thread-list state answers that: `isLoading` goes false on
 * the failure path too, and a `custom`-carrying entry can also be injected by
 * `adapter.fetch()` when a deep-link switches to a thread the failed list never
 * returned. Session-tab hydration needs the real answer — restoring against a
 * list that never loaded drops every persisted tab and then overwrites the
 * payload with the survivors (#312).
 *
 * Latches once and stays latched; a webview reload starts a fresh run.
 */
import { create } from 'zustand';

interface SessionListLoadState {
  loaded: boolean;
  markLoaded: () => void;
}

export const useSessionListLoadState = create<SessionListLoadState>((set) => ({
  loaded: false,
  markLoaded: () => set((s) => (s.loaded ? s : { loaded: true })),
}));
