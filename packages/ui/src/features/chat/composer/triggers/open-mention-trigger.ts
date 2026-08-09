/**
 * Opening the mention trigger from the composer's add-mention button.
 *
 * The button must land in the same state typing "@" does: the draft grows an
 * "@" that detect.ts can see (index 0 or after whitespace) and the trigger
 * engine's tracked cursor moves with it.
 */

/** The draft a click produces: an "@" the detector can see, so it needs whitespace before it. */
export function mentionDraft(text: string): string {
  return text.length > 0 && !/\s$/u.test(text) ? `${text} @` : `${text}@`;
}

/**
 * Write `next` into the composer textarea the way a keystroke would.
 *
 * The prototype setter and the bubbling `input` event are both load-bearing:
 * assistant-ui's ComposerPrimitive.Input derives `setText` AND the trigger
 * engine's `setCursorPosition` from that event, React's value tracker swallows
 * it unless the write bypasses the own accessor React installs, and the caret
 * must already be in place because the handler reads `selectionStart` off the
 * target during dispatch.
 */
export function writeComposerDraft(el: HTMLTextAreaElement, next: string): void {
  el.focus();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setValue) {
    setValue.call(el, next);
  } else {
    el.value = next;
  }
  el.setSelectionRange(next.length, next.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
