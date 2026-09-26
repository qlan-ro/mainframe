/**
 * Fork lineage view-model (todo #343, variant D — nested rows).
 *
 * `nestForks` reorders one already-sorted group's items so every fork sits
 * directly under its parent, in a contiguous depth-first block anchored at
 * the parent's own position, capped at two indent levels. A fork whose parent
 * isn't in this same array (a different group, filtered out, archived, or
 * deleted) is left in the group's own sort position at depth 0 — the row
 * layer renders the fallback glyph for those, via `classifyParent`.
 *
 * Pure and side-effect-free: no daemon calls, no React. `use-parent-chat.ts`
 * resolves the archived/deleted cases this module can't see (they aren't in
 * the sidebar's loaded item set at all).
 */
import type { SessionItem } from './chat-to-thread-custom';

const MAX_DEPTH = 2;

export interface LineageRow {
  item: SessionItem;
  /** 0 = not nested here (root, or a fork whose parent isn't in this array). */
  depth: 0 | 1 | 2;
}

function nextDepth(depth: 0 | 1 | 2): 0 | 1 | 2 {
  return depth >= MAX_DEPTH ? MAX_DEPTH : ((depth + 1) as 0 | 1 | 2);
}

/**
 * Reorders `items` (already sorted for the active mode) into contiguous
 * parent-then-descendants blocks. Self-references and cycles are treated as
 * having no local parent, so every item is visited at most once and the walk
 * always terminates.
 */
export function nestForks(items: readonly SessionItem[]): LineageRow[] {
  const byId = new Set(items.map((it) => it.id));
  const childrenOf = new Map<string, SessionItem[]>();
  const hasLocalParent = new Set<string>();

  for (const it of items) {
    const parentId = it.custom.parentChatId;
    if (parentId == null || parentId === it.id || !byId.has(parentId)) continue;
    hasLocalParent.add(it.id);
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(it);
    else childrenOf.set(parentId, [it]);
  }

  const visited = new Set<string>();
  const rows: LineageRow[] = [];

  // `ancestry` is the current DFS path, not the whole visited set: it's the
  // cycle guard (a child that is its own ancestor breaks the edge instead of
  // recursing forever), while `visited` stops an already-placed node from
  // being emitted twice by a second incoming edge.
  function emit(it: SessionItem, depth: 0 | 1 | 2, ancestry: ReadonlySet<string>): void {
    if (visited.has(it.id)) return;
    visited.add(it.id);
    rows.push({ item: it, depth });
    const nextAncestry = new Set(ancestry).add(it.id);
    for (const child of childrenOf.get(it.id) ?? []) {
      if (ancestry.has(child.id)) continue; // cycle guard
      emit(child, nextDepth(depth), nextAncestry);
    }
  }

  // Roots keep the group's own incoming order; each root's descendant block
  // is emitted immediately after it, so the block sits at the root's position.
  for (const it of items) {
    if (!hasLocalParent.has(it.id)) emit(it, 0, new Set());
  }
  // A pure cycle (every member has a local parent) leaves no root above: flush
  // whatever a cycle guard couldn't reach, flat, in the group's own order.
  for (const it of items) {
    if (!visited.has(it.id)) emit(it, 0, new Set());
  }
  return rows;
}

/** Listed, non-archived, direct forks of `id` — excludes `id` itself (defends the self-reference case). */
export function forkCount(allItems: readonly SessionItem[], id: string): number {
  let count = 0;
  for (const it of allItems) {
    if (it.id !== id && it.custom.parentChatId === id && it.status !== 'archived') count++;
  }
  return count;
}

export type ParentClassification =
  /** No `parentChatId` — not a fork. */
  | 'none'
  /** The parent is loaded and listed, but in a different group than this fork. */
  | 'different-group'
  /** The parent is loaded (unfiltered) but a filter hides it from every group. */
  | 'filtered-out'
  /** The parent isn't in the loaded set at all — the caller resolves archived vs. deleted. */
  | 'unresolved';

/**
 * Classifies a fork's parent for the FALLBACK glyph (the fork is not nested —
 * its parent isn't adjacent in its own group). `listedIds` is every id
 * rendered across all of the arranged groups (post-filter); `unfilteredIds`
 * is every regular, non-archived session the sidebar has loaded regardless of
 * the active filters.
 */
export function classifyParent(
  parentChatId: string | null | undefined,
  listedIds: ReadonlySet<string>,
  unfilteredIds: ReadonlySet<string>,
): ParentClassification {
  if (parentChatId == null) return 'none';
  if (listedIds.has(parentChatId)) return 'different-group';
  if (unfilteredIds.has(parentChatId)) return 'filtered-out';
  return 'unresolved';
}

/**
 * The parent's resolved state, for the copy table shared by the sidebar's
 * fallback glyph and the chat header's parent link (the Design direction's
 * "the sidebar and header never disagree on how lineage reads"). `linked` is
 * the header-only case: the parent is directly known and not archived, so it
 * reads exactly like `filtered-out`'s plain quoted title.
 */
export type ParentLineageState =
  | { kind: 'different-group'; title: string }
  | { kind: 'filtered-out'; title: string }
  | { kind: 'linked'; title: string }
  | { kind: 'archived'; title: string }
  | { kind: 'deleted' };

/**
 * Just the parent-naming half ("<title>", possibly suffixed) — the hover
 * card's `sessions-meta-card-forked-from` value, where a separate `FieldLabel`
 * already says "Forked from".
 */
export function parentLineageValue(state: ParentLineageState): string {
  switch (state.kind) {
    case 'different-group':
    case 'filtered-out':
    case 'linked':
      return `"${state.title}"`;
    case 'archived':
      return `"${state.title}" (archived)`;
    case 'deleted':
      return 'a deleted chat';
  }
}

/** The exact Hint / header copy from the spec's Sidebar and Chat header sections. */
export function parentLineageText(state: ParentLineageState): string {
  const suffix = state.kind === 'different-group' ? " — in a different group, so it can't nest here" : '';
  return `Forked from ${parentLineageValue(state)}${suffix}`;
}

/** Archived and deleted parents are never interactive (archived chats only reopen from the Archived dialog). */
export function parentLineageInteractive(state: ParentLineageState): boolean {
  return state.kind !== 'archived' && state.kind !== 'deleted';
}
