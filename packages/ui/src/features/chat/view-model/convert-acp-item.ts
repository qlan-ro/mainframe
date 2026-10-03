/**
 * `AccumulatedItem[]` → `ThreadMessageLike[]` — the ONE message converter
 * (desktop-cutover pass; the legacy `convert-message.ts` is deleted).
 *
 * Reaggregation: the encoder flattens each `DisplayMessage` into items that
 * all carry the container's id in `_meta["_mainframe.dev"].containerId`
 * (`ItemMeta`). This module folds them back into one aui message per
 * container (`convert-acp-container.ts` builds each one) — parts in item
 * order, the daemon's tool-group membership echoed as
 * `partGroups`/`groupSummaries`, subagent transcripts rebuilt from the
 * `parentToolCallId` relation into a `Task` tool-call part carrying nested
 * `messages` — so the renderer (`AssistantMessage` GroupedParts, the tool
 * cards, `MessageTimestamp`) is byte-identical with what the legacy
 * projection produced.
 *
 * **Identity is load-bearing.** A streamed chunk touches one item, but the
 * session plane re-converts the whole accumulator on every frame, and
 * assistant-ui re-renders every message and part whose object identity
 * changed. `TranscriptConverter` therefore caches each container's message
 * against the exact item objects it was built from (the accumulator replaces
 * only the item a frame touched), so an untouched container returns the very
 * same `ThreadMessageLike` — and its parts — as last time. Conversion cost
 * and React work per frame then scale with what changed, not with the
 * transcript's length.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';
import { convertContainer, type ChildrenMap, type ParsedItem } from './convert-acp-container';
import { parseItemMeta } from './parse-item-meta';

interface Grouped {
  readonly containers: ReadonlyMap<string, readonly ParsedItem[]>;
  readonly children: ChildrenMap;
}

interface CacheEntry {
  /** Every item object this message was built from — the container's own items and, transitively, its tool calls' children. */
  readonly deps: readonly AccumulatedItem[];
  readonly message: ThreadMessageLike;
}

function sameDeps(a: readonly AccumulatedItem[], b: readonly AccumulatedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The container's items plus every descendant item a nested transcript would read, in a stable walk order. */
function collectDeps(items: readonly ParsedItem[], children: ChildrenMap, into: AccumulatedItem[]): void {
  for (const parsed of items) {
    into.push(parsed.item);
    if (parsed.item.kind !== 'tool-call') continue;
    const nested = children.get(parsed.item.id);
    if (nested) collectDeps(nested, children, into);
  }
}

export class TranscriptConverter {
  /** Items are immutable and replaced on change, so parsed meta can live for the item object's lifetime. */
  private readonly parsed = new WeakMap<AccumulatedItem, ParsedItem>();
  private cache = new Map<string, CacheEntry>();

  convert(items: readonly AccumulatedItem[], createdAtFor: (id: string) => Date): ThreadMessageLike[] {
    const { containers, children } = this.group(items);
    const next = new Map<string, CacheEntry>();
    const messages: ThreadMessageLike[] = [];
    for (const [containerId, group] of containers) {
      const deps: AccumulatedItem[] = [];
      collectDeps(group, children, deps);
      const prior = this.cache.get(containerId);
      const message =
        prior && sameDeps(prior.deps, deps)
          ? prior.message
          : convertContainer(containerId, group, children, createdAtFor);
      next.set(containerId, { deps, message });
      messages.push(message);
    }
    // Containers that vanished (a wipe, a replay rebuilding under new item objects) drop out with the old map.
    this.cache = next;
    return messages;
  }

  private parse(item: AccumulatedItem): ParsedItem {
    const existing = this.parsed.get(item);
    if (existing) return existing;
    const parsed: ParsedItem = { item, meta: parseItemMeta(item, MAINFRAME_META_NAMESPACE) };
    this.parsed.set(item, parsed);
    return parsed;
  }

  private group(items: readonly AccumulatedItem[]): Grouped {
    const children = new Map<string, ParsedItem[]>();
    const containers = new Map<string, ParsedItem[]>();
    for (const item of items) {
      const parsed = this.parse(item);
      const parentId = parsed.meta.parentToolCallId;
      if (parentId !== undefined) {
        const list = children.get(parentId) ?? [];
        list.push(parsed);
        children.set(parentId, list);
        continue;
      }
      const containerId = parsed.meta.containerId ?? item.id;
      const list = containers.get(containerId) ?? [];
      list.push(parsed);
      containers.set(containerId, list);
    }
    return { containers, children };
  }
}

/** One-shot conversion with no cache — the stateless entry tests and the nested-transcript builders use. */
export function convertAcpItems(
  items: readonly AccumulatedItem[],
  createdAtFor: (id: string) => Date,
): ThreadMessageLike[] {
  return new TranscriptConverter().convert(items, createdAtFor);
}
