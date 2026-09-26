/**
 * Per-row fork lineage (todo #343, variant D): whether this row nests under
 * its parent, the fallback glyph's Hint text and click behavior when it
 * doesn't, and the parent's resolved state for the hover card's "Forked from"
 * line (shown on a fork whether or not it happens to be nested).
 */
import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import {
  classifyParent,
  parentLineageInteractive,
  parentLineageText,
  type ParentLineageState,
} from '../view-model/fork-lineage';
import { useSessionLineage } from '../SessionLineageContext';
import { useParentChat } from '../use-parent-chat';
import type { ForkFallback } from '../SessionRowMetaLine';

export interface ForkRowLineage {
  /** True when the row's own `depth` (from the group's `nestForks` pass) places it under its parent. */
  nested: boolean;
  /**
   * The row's own indent depth, 0-2, straight from `nestForks`. Indentation
   * goes one step per level and stops at two — a depth-2 row (a fork of a
   * fork) renders two indent steps, not one, so it never reads as a sibling
   * of its own parent.
   */
  depth: 0 | 1 | 2;
  /** Set only for a non-nested fork — the row's own trailing fallback glyph. */
  fallback?: ForkFallback;
  /** Set whenever the item has a `parentChatId`, nested or not — the hover card's forked-from line. */
  parentState?: ParentLineageState;
}

export function useForkLineageRow(item: SessionItem, depth: 0 | 1 | 2): ForkRowLineage {
  const aui = useAui();
  const { allItems, listedIds, unfilteredIds } = useSessionLineage();
  const parentChatId = item.custom.parentChatId ?? null;

  const classification =
    depth === 0 && parentChatId != null ? classifyParent(parentChatId, listedIds, unfilteredIds) : 'none';
  // Only asks the daemon when nothing local resolves it (archived or deleted).
  const external = useParentChat(classification === 'unresolved' ? parentChatId : null);

  const activateParent = useCallback(() => {
    if (parentChatId != null) aui.threads.switchToThread(parentChatId);
  }, [aui, parentChatId]);

  if (parentChatId == null) return { nested: depth > 0, depth };

  if (depth > 0) {
    // nestForks only nests onto a parent present in this same group, so the
    // title always resolves locally — no daemon round trip for a nested row.
    const title = allItems.find((it) => it.id === parentChatId)?.title ?? 'Untitled session';
    return { nested: true, depth, parentState: { kind: 'linked', title } };
  }

  let state: ParentLineageState | undefined;
  if (classification === 'different-group' || classification === 'filtered-out') {
    const title = allItems.find((it) => it.id === parentChatId)?.title ?? 'Untitled session';
    state = { kind: classification, title };
  } else if (external?.kind === 'archived') {
    state = { kind: 'archived', title: external.title ?? 'Untitled session' };
  } else if (external?.kind === 'deleted') {
    state = { kind: 'deleted' };
  }

  if (state == null) return { nested: false, depth: 0 }; // still resolving — no placeholder glyph while pending
  return {
    nested: false,
    depth: 0,
    parentState: state,
    fallback: {
      hint: parentLineageText(state),
      onActivate: parentLineageInteractive(state) ? activateParent : undefined,
    },
  };
}
