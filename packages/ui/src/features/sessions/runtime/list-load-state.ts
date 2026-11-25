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
 * `loaded` latches once and stays latched; a webview reload starts a fresh run.
 */
import { create } from 'zustand';

interface SessionListLoadState {
  loaded: boolean;
  /** The last list request failed. Unlike `loaded`, this follows every request. */
  failed: boolean;
  markLoaded: () => void;
  markFailed: () => void;
}

export const useSessionListLoadState = create<SessionListLoadState>((set) => ({
  loaded: false,
  failed: false,
  markLoaded: () => set((s) => (s.loaded && !s.failed ? s : { loaded: true, failed: false })),
  markFailed: () => set((s) => (s.failed ? s : { failed: true })),
}));
