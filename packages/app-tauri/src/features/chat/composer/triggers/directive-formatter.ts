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
