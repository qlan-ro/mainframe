/**
 * Inserts a picked trigger item as LITERAL text (`<prefix><id>`) and never
 * parses chips back out, so the sent message carries plain `/skill` / `@path`
 * text that the CLI/daemon parses — no directive chip round-trip.
 *
 * NO trailing space here: assistant-ui's native insertion
 * (`TriggerSelectionResource.selectItem` → `insertDirective`) always appends
 * its own single separating space before the text after the cursor (unless
 * that text already starts with one) — `before + directive + (after.startsWith(" ")
 * ? after : " " + after)`. Adding a trailing space in serialize() on top of
 * that composed to a double space (`/skill  ` / `@path  `).
 */
import type { Unstable_DirectiveFormatter, Unstable_TriggerItem } from '@assistant-ui/react';

export function literalDirectiveFormatter(prefix: string): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => `${prefix}${item.id}`,
    parse: (text) => [{ kind: 'text', text }],
  };
}

/**
 * `@`-mention formatter. A DIRECTORY serializes to `@<path>/` with NO trailing
 * space, so the `@` trigger token stays active and the popover re-opens listing
 * that directory (drill-down) — the native insertion still adds its own single
 * space after it (see `dropDirectoryClosingSpace` below, which removes that one).
 * Files and agents also serialize with NO trailing space (the native insertion
 * supplies the single space that closes the token). Always inserts literal
 * text — no chips.
 */
export function mentionDirectiveFormatter(): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => (item.type === 'directory' ? `@${item.id}/` : `@${item.id}`),
    parse: (text) => [{ kind: 'text', text }],
  };
}

/**
 * After an `@`-mention DIRECTORY is inserted, the native trigger popover appends
 * a closing space (`triggerSelectionResource` always does) that ends the `@`
 * token and breaks directory drill-down. Drop that single trailing space — but
 * ONLY when `@<dirId>/ ` is the very end of the input (browsing at the end), so
 * we never glue the directory path to following text mid-input.
 */
export function dropDirectoryClosingSpace(text: string, dirId: string): string {
  const directive = `@${dirId}/`;
  return text.endsWith(`${directive} `) ? text.slice(0, -1) : text;
}

/**
 * Whether the trigger popover should close after this item is inserted. A
 * DIRECTORY pick keeps the `@` token open for drill-down (see
 * `mentionDirectiveFormatter` + `dropDirectoryClosingSpace`); every other item
 * type (file, agent, skill) closes the popover, matching the library's own
 * Escape-key `close()` behavior — see `ComposerTriggers.tsx`'s `onInserted`
 * wiring, which calls the trigger's `close()` only when this returns true.
 */
export function shouldCloseTriggerOnInsert(item: Unstable_TriggerItem): boolean {
  return item.type !== 'directory';
}
