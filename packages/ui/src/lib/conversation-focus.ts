/**
 * Which conversation the user works in: where they last focused, typed or pressed,
 * whichever came last. A press counts by itself because it may leave the focus where
 * it was (WebKit focuses no button on a click).
 * What a conversation opens in a portal counts as it, because React's events
 * reach the conversation from there. Everything else is another surface.
 *
 * A conversation is named by its chat, wherever it shows.
 */

/** Undefined: nothing yet. Null: another surface. */
type Holder = string | null | undefined;

let focused: Holder;
/** A press since the last focus or typing. */
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
/** Typing is working where the focus is. A shortcut isn't: it may be the one asking. */
function onKeyDown(event: KeyboardEvent): void {
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !MODIFIERS.has(event.key)) pressed = undefined;
}
const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift']);

/** For as long as the app's shell is mounted. */
export function trackConversationFocus(): () => void {
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('pointerdown', onPress, true);
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('pointerdown', onPress, true);
    window.removeEventListener('keydown', onKeyDown, true);
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
  if (anyYet && pressed !== undefined) return pressed;
  // The chat shown there now: the chat column's changes under the focus.
  if (inside !== undefined) return inside;
  return anyYet ? (focused ?? null) : undefined;
}
