/**
 * Inserts a picked trigger item as LITERAL text (`<prefix><id> `) and never
 * parses chips back out, so the sent message carries plain `/skill` / `@path`
 * text that the CLI/daemon parses — no directive chip round-trip.
 */
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';

export function literalDirectiveFormatter(prefix: string): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => `${prefix}${item.id} `,
    parse: (text) => [{ kind: 'text', text }],
  };
}

/**
 * `@`-mention formatter. A DIRECTORY serializes to `@<path>/` with NO trailing
 * space, so the `@` trigger token stays active and the popover re-opens listing
 * that directory (drill-down). Files and agents serialize to `@<id> ` (trailing
 * space closes the token). Always inserts literal text — no chips.
 */
export function mentionDirectiveFormatter(): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => (item.type === 'directory' ? `@${item.id}/` : `@${item.id} `),
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
