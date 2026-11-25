/**
 * Did `adapter.list()` ever come back for this daemon connection?
 *
 * Nothing in the aui thread-list state answers that: `isLoading` goes false on
 * the failure path too, and a `custom`-carrying entry can also be injected by
 * `adapter.fetch()` when a deep-link switches to a thread the failed list never
 * returned. Session-tab hydration needs the real answer — restoring against a
 * list that never loaded drops every persisted tab and then overwrites the
 * payload with the survivors (#312).
 *
 * `loaded` latches once and stays latched; a daemon switch or webview reload starts a fresh run.
 * `failed` is about the latest request only: what is on screen may be out of date.
 */
import { create } from 'zustand';

interface SessionListLoadState {
  loaded: boolean;
  failed: boolean;
  setFailed: (failed: boolean) => void;
  markLoaded: () => void;
}

export const useSessionListLoadState = create<SessionListLoadState>((set) => ({
  loaded: false,
  failed: false,
  setFailed: (failed) => set((s) => (s.failed === failed ? s : { failed })),
  markLoaded: () => set((s) => (s.loaded ? s : { loaded: true })),
}));

let epoch = 0;
export const sessionListEpoch = (): number => epoch;

export function resetSessionListLoadState(): void {
  epoch += 1;
  useSessionListLoadState.setState({ loaded: false, failed: false });
}
