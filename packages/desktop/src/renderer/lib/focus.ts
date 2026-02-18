/**
 * Programmatically focus the composer textarea.
 *
 * assistant-ui v0.12.x removed `ComposerRuntime.focus()`, so we target
 * the underlying DOM element via a data attribute added to ComposerPrimitive.Input.
 */
export function focusComposerInput(): void {
  (document.querySelector('[data-mf-composer-input]') as HTMLElement | null)?.focus();
}
