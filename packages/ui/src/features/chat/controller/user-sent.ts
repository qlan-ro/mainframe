/**
 * "The user sent something in this chat", keyed by chat id.
 *
 * Every send the user makes goes through the chat controller: the composer's
 * send, queue and steer, Compact conversation and review-panel comments (all
 * `aui.thread.append` → `onNew` → `sendMessage`), Send now on a held row
 * (`sendHeld`) and Resume on a paused queue (`resumeQueue`). The controller
 * emits here; the transcript's bottom pin and the older-page prepend anchor
 * listen. A prompt the daemon dispatches by itself (a queued prompt released
 * at turn end) or one another agent sends never passes through those methods,
 * so it never fires this.
 */
const listeners = new Map<string, Set<() => void>>();

/**
 * Notifies the listeners of every id in `chatIds` once each. A controller
 * passes both its thread id and its daemon id: a chat created this session is
 * reachable under either.
 */
export function emitUserSent(chatIds: readonly string[]): void {
  const notified = new Set<() => void>();
  for (const chatId of chatIds) {
    for (const listener of [...(listeners.get(chatId) ?? [])]) {
      if (notified.has(listener)) continue;
      notified.add(listener);
      listener();
    }
  }
}

export function onUserSent(chatId: string, listener: () => void): () => void {
  let forChat = listeners.get(chatId);
  if (!forChat) {
    forChat = new Set();
    listeners.set(chatId, forChat);
  }
  forChat.add(listener);
  return () => {
    forChat.delete(listener);
    if (forChat.size === 0 && listeners.get(chatId) === forChat) listeners.delete(chatId);
  };
}
