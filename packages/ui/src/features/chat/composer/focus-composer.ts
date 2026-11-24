/**
 * ⌘L's action: put the caret in the composer of the chat you are looking at.
 *
 * With the keyboard already in a workspace chat tab, that is the tab's own;
 * otherwise the conversation's. Failing both (chat hidden), the tab in front. A
 * no-op when no composer is on screen — the first-run hero and the initializing
 * state render none.
 */
const COMPOSER = '[data-mf-composer-input]';

export function focusVisibleComposer(): void {
  const tab = document.activeElement?.closest('[data-conversation-tab]');
  const input =
    tab?.querySelector<HTMLElement>(COMPOSER) ??
    [...document.querySelectorAll<HTMLElement>(COMPOSER)].find((el) => el.closest('[data-conversation-tab]') == null) ??
    document.querySelector<HTMLElement>(`[data-conversation-tab="active"] ${COMPOSER}`);
  input?.focus();
}

/**
 * The other direction: Escape from the composer parks focus on the transcript
 * it belongs to. Scoped through the input's own ancestors, so a workspace chat
 * tab hands focus to ITS viewport rather than the first one in the document.
 * False when there is no transcript above it — nothing to hand focus to.
 */
export function focusOwningTranscript(from: HTMLElement): boolean {
  const viewport = from.closest<HTMLElement>('[data-mf-chat-thread]');
  if (viewport == null) return false;
  viewport.focus();
  return true;
}
