/**
 * The `@`-trigger hooks that make a session row behave like a session (todo #240):
 * its own test id, its own glyph, and the label/path recording that ties the
 * inserted `@session[label]` token to the transcript path the send will emit.
 */
import { MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TriggerItem } from '@/components/trigger-engine/types';
import { nextFreeLabel } from '@/features/chat/session-references/reference-label';
import { useSessionReferences } from './session-reference-store';

export function sessionItemTestId(item: TriggerItem): string | undefined {
  return item.type === 'session' ? `composer-mention-session-${item.id}` : undefined;
}

export function sessionItemGlyph(item: TriggerItem): ReactNode {
  // Sized by class, not by prop: the CommandItem recipe forces `size-4` on any
  // svg that carries no size class of its own.
  return item.type === 'session' ? <MessageSquare className="size-3 shrink-0 text-muted-foreground" /> : null;
}

/**
 * The label this pick will use in THIS draft. The picker's labels are unique
 * across the offered list, but the draft may already hold a reference the
 * picker no longer offers (the session was archived mid-draft), so the draft
 * gets the final say: reuse the preferred label when it is free or already
 * points at this session's own transcript, otherwise take the next `(n)`.
 */
export function resolveDraftLabel(args: {
  preferred: string;
  path: string | undefined;
  references: Readonly<Record<string, string>>;
}): string {
  const { preferred, path, references } = args;
  const bound = references[preferred];
  if (bound === undefined || (path !== undefined && bound === path)) return preferred;
  return nextFreeLabel(preferred, new Set(Object.keys(references)));
}

/**
 * Load-bearing ordering: `use-trigger-field`'s `selectEntry` calls
 * `formatter.serialize(entry)` and then `config.onInserted?.(entry)`
 * synchronously, with no store write between them, so both see the same
 * snapshot and derive the same label. Anything that lands a store write in
 * between silently desyncs the inserted token from the recorded path.
 */
export function createSessionInsertion(args: { threadId: string | null; pathByChatId: ReadonlyMap<string, string> }): {
  resolveSessionLabel: (item: TriggerItem) => string;
  onInserted: (item: TriggerItem) => void;
} {
  const { threadId, pathByChatId } = args;

  const labelFor = (item: TriggerItem): string =>
    resolveDraftLabel({
      preferred: item.label,
      path: pathByChatId.get(item.id),
      references: threadId == null ? {} : (useSessionReferences.getState().byThread[threadId] ?? {}),
    });

  return {
    resolveSessionLabel: labelFor,
    onInserted: (item) => {
      if (item.type !== 'session' || threadId == null) return;
      const path = pathByChatId.get(item.id);
      if (path === undefined) return;
      useSessionReferences.getState().record(threadId, labelFor(item), path);
    },
  };
}
