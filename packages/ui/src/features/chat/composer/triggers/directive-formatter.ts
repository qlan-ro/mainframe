/**
 * Renders a picked trigger item as literal text (`<prefix><id>`) — no chip
 * round-trip. The engine's own `insertDirective` (see
 * `@/components/trigger-engine/selection.ts`) owns the trailing-space /
 * reopen-for-drill-down behavior via `TriggerConfig.closeOnInsert`, so these
 * formatters only ever serialize.
 */
import type { DirectiveFormatter, TriggerItem } from '@/components/trigger-engine/types';

export function literalDirectiveFormatter(prefix: string): DirectiveFormatter {
  return { serialize: (item) => `${prefix}${item.id}` };
}

/**
 * `@`-mention formatter. A directory serializes to `@<path>/` — paired with
 * `shouldCloseTriggerOnInsert` below (`closeOnInsert: false` for it), which
 * keeps the `@` token open so the popover re-lists that directory.
 *
 * A session serializes to the bare `@<label>` — the draft spelling. The
 * `session[…]` scaffolding the wire body needs would otherwise sit on screen
 * while typing, since the composer overlay shows a token verbatim;
 * `expandSessionMentions` puts it back at submit (see `session-mention.ts`).
 * `resolveSessionLabel` lets the composer hand back the draft-unique label it
 * will record the transcript path under, so the token and the reference line
 * agree.
 */
export function mentionDirectiveFormatter(resolveSessionLabel?: (item: TriggerItem) => string): DirectiveFormatter {
  return {
    serialize: (item) => {
      if (item.type === 'session') return `@${resolveSessionLabel?.(item) ?? item.label}`;
      return item.type === 'directory' ? `@${item.id}/` : `@${item.id}`;
    },
  };
}

/**
 * Whether the trigger closes after this item is inserted — false for a
 * directory (kept open for drill-down), true for everything else. Passed
 * directly as `TriggerConfig.closeOnInsert` (see `ComposerTriggers.tsx`).
 */
export function shouldCloseTriggerOnInsert(item: TriggerItem): boolean {
  return item.type !== 'directory';
}
