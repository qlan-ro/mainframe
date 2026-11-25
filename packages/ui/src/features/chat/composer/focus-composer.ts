const COMPOSER = '[data-mf-composer-input]';

/** The conversation's composer: the one that is not a workspace tab's. */
function conversationComposer(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(COMPOSER)].find(
    (el) => el.closest('[data-conversation-tab]') == null,
  );
}

function frontTabComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-conversation-tab="active"] ${COMPOSER}`);
}

/**
 * ⌘L's action: put the caret in the composer of the chat you are looking at.
 *
 * With the keyboard already in a workspace chat tab, that is the tab's own;
 * otherwise the conversation's. Failing both (chat hidden), the tab in front. A
 * no-op when no composer is on screen — the first-run hero and the initializing
 * state render none.
 */
export function focusVisibleComposer(): void {
  const tab = document.activeElement?.closest('[data-conversation-tab]');
  const input = tab?.querySelector<HTMLElement>(COMPOSER) ?? conversationComposer() ?? frontTabComposer();
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

/** The composer of the chat an element is in. None for a sub-agent's tab, which has no composer. */
export function focusComposerOf(from: Element | undefined): void {
  const tab = from?.closest('[data-conversation-tab]');
  (tab ? tab.querySelector<HTMLElement>(COMPOSER) : conversationComposer())?.focus();
}

/**
 * Where the keyboard goes when the chat tab it was in closes: the chat tab that
 * came in front, else the conversation, else the workspace's selected tab or,
 * with nothing left open, the toggle that opens it.
 */
export function focusAfterClosedTab(): void {
  const target =
    frontTabComposer() ??
    conversationComposer() ??
    document.querySelector<HTMLElement>(
      '[role="tablist"][aria-label="Workspace tabs"] [role="tab"][aria-selected="true"]',
    ) ??
    document.querySelector<HTMLElement>('[data-tut="workspace"]');
  target?.focus();
}
