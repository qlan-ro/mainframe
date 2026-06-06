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
