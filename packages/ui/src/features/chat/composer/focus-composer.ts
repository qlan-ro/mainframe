/**
 * ⌘L's action: put the caret in the composer of the chat you are looking at.
 *
 * While split, both zones render a composer, so the focused zone's is the one
 * the shortcut means (`ChatZone` marks it with `data-focused`). A no-op when
 * no composer is on screen — the first-run hero and the initializing state
 * render none.
 */
const FOCUSED_ZONE_COMPOSER = '[data-focused="true"] [data-mf-composer-input]';
const ANY_COMPOSER = '[data-mf-composer-input]';

export function focusVisibleComposer(): void {
  const input =
    document.querySelector<HTMLElement>(FOCUSED_ZONE_COMPOSER) ?? document.querySelector<HTMLElement>(ANY_COMPOSER);
  input?.focus();
}

/**
 * The other direction: Escape from the composer parks focus on the transcript
 * it belongs to. Scoped through the input's own ancestors, so a split hands
 * focus to THIS zone's viewport rather than the first one in the document.
 * False when there is no transcript above it — nothing to hand focus to.
 */
export function focusOwningTranscript(from: HTMLElement): boolean {
  const viewport = from.closest<HTMLElement>('[data-mf-chat-thread]');
  if (viewport == null) return false;
  viewport.focus();
  return true;
}
