/**
 * pickInitialSession — which session the app opens on boot.
 *
 * Two-tier rule:
 *   1. Restore the last session the user had open before the app closed, when a
 *      `preferredRemoteId` (the persisted daemon chat id) still maps to a live,
 *      non-archived session. Matched on `remoteId` — the stable daemon chat id —
 *      NOT the aui thread id, which can be a per-run `__LOCALID_*` value that
 *      doesn't survive a reboot.
 *   2. Otherwise fall back to the most-recently-updated non-archived session
 *      (desktop parity, renderer `useAppInit.ts`), so the app never starts on the
 *      empty new-thread picker when real sessions exist.
 *
 * Returns the aui thread id to switch to (the caller passes it to
 * `switchToThread`), or null when there is nothing to open (no sessions, or all
 * archived) — the caller then leaves the new-thread picker up.
 *
 * Pure. Pinned state intentionally does NOT influence the default selection
 * (matching desktop) — pinning affects list ordering/grouping, not auto-open.
 */
import type { SessionItem } from './chat-to-thread-custom';

export function pickInitialSession(items: readonly SessionItem[], preferredRemoteId?: string | null): string | null {
  if (preferredRemoteId != null) {
    const restored = items.find((item) => item.status !== 'archived' && item.remoteId === preferredRemoteId);
    if (restored != null) return restored.id;
  }

  let best: SessionItem | null = null;
  for (const item of items) {
    if (item.status === 'archived') continue;
    if (best === null || item.custom.updatedAt > best.custom.updatedAt) {
      best = item;
    }
  }
  return best?.id ?? null;
}
