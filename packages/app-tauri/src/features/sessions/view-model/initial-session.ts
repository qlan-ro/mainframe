/**
 * pickInitialSession — which session the app opens on boot.
 *
 * Mirrors the desktop boot rule (renderer `useAppInit.ts`: fall back to the most
 * recently updated non-archived chat) so the app never starts on the empty
 * new-thread picker when real sessions exist. assistant-ui's
 * useRemoteThreadListRuntime boots on a fresh `__LOCALID_*` draft and does NOT
 * auto-open a listed thread; this picks the thread the boot effect switches to.
 *
 * Pure: most-recently-updated non-archived item by `custom.updatedAt`. Returns
 * null when there is nothing to open (no sessions, or all archived) — the caller
 * then leaves the new-thread picker up, which is the correct empty state.
 *
 * Pinned state intentionally does NOT influence the default selection (matching
 * desktop) — pinning affects list ordering/grouping, not which chat auto-opens.
 */
import type { SessionItem } from './chat-to-thread-custom';

export function pickInitialSession(items: readonly SessionItem[]): string | null {
  let best: SessionItem | null = null;
  for (const item of items) {
    if (item.status === 'archived') continue;
    if (best === null || item.custom.updatedAt > best.custom.updatedAt) {
      best = item;
    }
  }
  return best?.id ?? null;
}
