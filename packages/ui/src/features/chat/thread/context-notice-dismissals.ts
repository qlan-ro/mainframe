/**
 * context-notice-dismissals — localStorage-backed dismissal for
 * ContextNotPreservedNotice, keyed by chat id (todo #346).
 *
 * The daemon stamps a fresh `contextLostAt` every time a no-persistence
 * temporary chat's vendor session is lost and respawned, so this stores the
 * dismissed VALUE, not a boolean: dismissing today's loss must not hide a
 * later, different loss for the same chat. The value survives a remount (a
 * reload) by design — the notice stays hidden until the underlying fact
 * changes, not merely because the component unmounted.
 */
const STORAGE_PREFIX = 'mf:context-notice-dismissed:';

function storageKey(chatId: string): string {
  return `${STORAGE_PREFIX}${chatId}`;
}

/** True when this exact `contextLostAt` value was already dismissed for this chat. */
export function isContextNoticeDismissed(chatId: string, contextLostAt: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(chatId)) === contextLostAt;
  } catch {
    // expected: localStorage can be unavailable (private mode) — treat as not dismissed.
    return false;
  }
}

export function dismissContextNotice(chatId: string, contextLostAt: string): void {
  try {
    window.localStorage.setItem(storageKey(chatId), contextLostAt);
  } catch {
    // expected: a failed write just means the notice reappears next render, which is safe.
  }
}
