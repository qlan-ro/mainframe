/**
 * Which conversation the user works in: the one that last had the focus, or a
 * press where nothing takes the focus (WebKit focuses no button on a click).
 * What a conversation opens in a portal counts as it, because React's events
 * reach the conversation from there. Everything else is another surface.
 *
 * A conversation is named by its chat, wherever it shows.
 */

/** Undefined: nothing yet. Null: another surface. */
type Holder = string | null | undefined;

let focused: Holder;
let pressed: Holder;
let anyYet = false;

/** Runs before React's own capture handlers, where a conversation claims the event. */
function onFocusIn(): void {
  focused = null;
  pressed = undefined;
}
function onPress(): void {
  pressed = null;
}

/** For as long as the app's shell is mounted. */
export function trackConversationFocus(): () => void {
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('pointerdown', onPress, true);
  return () => {
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('pointerdown', onPress, true);
    focused = pressed = undefined;
    anyYet = false;
  };
}

/** Handlers for an element whose React subtree, portals included, is `chatId`'s. */
export function claimsFor(chatId: string) {
  return {
    onFocusCapture: () => {
      focused = chatId;
      anyYet = true;
    },
    onPointerDownCapture: () => {
      pressed = chatId;
      anyYet = true;
    },
  };
}

/** Props of the element a conversation is drawn in. */
export function conversationProps(chatId: string | null | undefined) {
  return chatId ? { 'data-conversation': chatId, ...claimsFor(chatId) } : {};
}

/** The conversation an element is drawn in. */
export function conversationOf(element: Element | null): string | undefined {
  return element?.closest<HTMLElement>('[data-conversation]')?.dataset.conversation;
}

/** The chat worked in; null while that is another surface, undefined while no conversation has been. */
export function heldConversation(): string | null | undefined {
  const at = document.activeElement;
  const inside = at === null || at === document.body ? undefined : conversationOf(at);
  // The chat shown there now: the chat column's changes under the focus.
  if (inside !== undefined) return inside;
  if (!anyYet) return undefined;
  const nowhere = at === null || at === document.body;
  return (nowhere && pressed !== undefined ? pressed : focused) ?? null;
}
