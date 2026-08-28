/**
 * `AccumulatedItem` → `ThreadMessageLike` (todo #350, plan task 21) — the
 * facade-path sibling of `convert-message.ts`. A separate module, not a
 * rewrite: `convert-message.ts`'s legacy invariants are load-bearing (package
 * CLAUDE.md) and the default chat path still runs through it — the facade
 * has no production call site yet either (`acp-client.ts`'s module doc).
 *
 * One ACP item → one aui message, id-for-id: stable item ids double as
 * message ids, so aui's `MessageRepository` (which dedupes by id) sees a
 * revised item as an update to the same message rather than a new one — the
 * property this module's tests exist to pin.
 *
 * The wire grammar carries no per-item timestamp (`EncodedItem` in
 * `mainframe-acp::encoder` has none); the caller supplies `createdAt`
 * (typically "first time this id was seen") rather than this module
 * inventing one.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AccumulatedItem } from './acp-item-accumulator';
import { type ContentPart, ensureNonEmpty, toJsonArgs } from './content';

/** `_meta["_mainframe.dev"].parentToolCallId` — subagent attribution, in place of `task_group` nesting. */
function parentToolCallId(meta: Record<string, unknown> | undefined): string | undefined {
  const namespaced = meta?.['_mainframe.dev'];
  if (typeof namespaced !== 'object' || namespaced === null) return undefined;
  const id = (namespaced as Record<string, unknown>).parentToolCallId;
  return typeof id === 'string' ? id : undefined;
}

function withParentAttribution(id: string | undefined): { metadata: Record<string, unknown> } | Record<string, never> {
  return id ? { metadata: { custom: { mainframe: { parentToolCallId: id } } } } : {};
}

/**
 * The vendored `ContentBlock` is text-only (`content.ts`'s module doc), so a
 * tool call's result content — unlike the legacy `mapToolResult` — has no
 * structured-diff/truncation shape yet on this wire grammar; joining its text
 * blocks is the whole of what the facade can express today.
 */
function toolCallResultText(item: Extract<AccumulatedItem, { kind: 'tool-call' }>): string | undefined {
  if (item.content.length === 0) return undefined;
  return item.content.map((entry) => entry.content.text).join('');
}

export function convertAcpItem(item: AccumulatedItem, createdAt: Date): ThreadMessageLike {
  const base = { id: item.id, createdAt };
  const attribution = withParentAttribution(parentToolCallId(item.meta));

  switch (item.kind) {
    case 'message': {
      const parts: ContentPart[] = [{ type: 'text', text: item.text }];
      return {
        role: item.role === 'user' ? 'user' : 'assistant',
        content: ensureNonEmpty(parts),
        ...base,
        ...attribution,
      };
    }
    case 'thought': {
      const parts: ContentPart[] = [{ type: 'reasoning', text: item.text }];
      return { role: 'assistant', content: ensureNonEmpty(parts), ...base, ...attribution };
    }
    case 'tool-call': {
      const parts: ContentPart[] = [
        {
          type: 'tool-call',
          toolCallId: item.id,
          toolName: item.title ?? item.id,
          args: toJsonArgs((item.rawInput ?? {}) as object),
          result: toolCallResultText(item),
          isError: item.status === 'failed',
        },
      ];
      return { role: 'assistant', content: parts, ...base, ...attribution };
    }
  }
}

export function convertAcpItems(
  items: readonly AccumulatedItem[],
  createdAtFor: (id: string) => Date,
): ThreadMessageLike[] {
  return items.map((item) => convertAcpItem(item, createdAtFor(item.id)));
}
