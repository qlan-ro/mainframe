/**
 * session-nav — a module-level seam for switching the active session by chat id.
 *
 * Callers outside the React tree (the global `mfToast`, WS event routers) can
 * request opening a session without reaching through to the assistant-ui
 * runtime. A root component inside the AssistantRuntimeProvider registers the
 * real navigator (`runtime.threads.switchToThread`, which resolves a remoteId
 * via the thread-id map); everything else calls `openSessionById`.
 */

type SessionNavigator = (chatId: string) => void;

let navigator: SessionNavigator | null = null;

/** Register (or clear, with `null`) the active session navigator. */
export function setSessionNavigator(fn: SessionNavigator | null): void {
  navigator = fn;
}

/**
 * Switch the active session to `chatId`. Returns `false` (and warns) when no
 * navigator is registered yet — e.g. a toast fired before the shell mounted.
 */
export function openSessionById(chatId: string): boolean {
  if (!navigator) {
    console.warn(`[session-nav] no navigator registered; cannot open ${chatId}`);
    return false;
  }
  navigator(chatId);
  return true;
}
