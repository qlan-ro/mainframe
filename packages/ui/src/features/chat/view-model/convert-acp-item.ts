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
import { MAINFRAME_META_NAMESPACE, StructuredDiffSchema } from '@qlan-ro/mainframe-types';
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
 * Rebuild the legacy `mapToolResult` shape from the item's content entries:
 * `content` blocks join into the result text, and a `diff` entry carrying
 * the `_mainframe.dev` fidelity payload (spec Decision 15) contributes the
 * structured hunks and before/after file text the Edit/Write cards consume —
 * the facade path's parity with the legacy structured-diff rendering.
 */
function toolCallResult(item: Extract<AccumulatedItem, { kind: 'tool-call' }>): unknown {
  const text = item.content
    .filter((entry) => entry.type === 'content')
    .map((entry) => entry.content.text)
    .join('');
  const diff = item.content.find((entry) => entry.type === 'diff');
  const fidelity = diff ? StructuredDiffSchema.safeParse(diff._meta?.[MAINFRAME_META_NAMESPACE]) : undefined;
  if (fidelity?.success) {
    return {
      content: text,
      structuredPatch: fidelity.data.structuredPatch,
      originalFile: fidelity.data.originalFile,
      modifiedFile: fidelity.data.modifiedFile,
    };
  }
  return text.length > 0 ? text : undefined;
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
          result: toolCallResult(item),
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
