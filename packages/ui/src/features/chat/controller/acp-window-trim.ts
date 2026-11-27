import { ItemMetaSchema, MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from '../view-model/acp-item-accumulator';

/** A visible user message the person sent: it opens a turn. A steered one and a sub-agent's prompt do not. */
function startsTurn(item: AccumulatedItem): boolean {
  if (item.kind !== 'message' || item.role !== 'user') return false;
  const meta = ItemMetaSchema.safeParse(item.meta?.[MAINFRAME_META_NAMESPACE]);
  if (!meta.success) return true;
  if (meta.data.parentToolCallId !== undefined) return false;
  return meta.data.messageMeta?.steered !== true;
}

/** A compaction or provider-switch divider: it leads the turn after it, as the daemon cuts pages. */
function isMarker(item: AccumulatedItem): boolean {
  const meta = ItemMetaSchema.safeParse(item.meta?.[MAINFRAME_META_NAMESPACE]);
  return meta.success && (meta.data.compaction !== undefined || meta.data.providerSwitch !== undefined);
}

/**
 * The item the newest page of `turns` turns starts at, or null when the window holds no more than
 * that. Pages are whole turns (the daemon cuts them the same way), so the cut is a user message
 * and never lands inside a turn. The running turn counts.
 */
export function newestPageStart(items: readonly AccumulatedItem[], turns: number): string | null {
  let seen = 0;
  for (let index = items.length - 1; index > 0; index--) {
    if (!startsTurn(items[index]!)) continue;
    seen += 1;
    if (seen < turns) continue;
    while (index > 0 && isMarker(items[index - 1]!)) index -= 1;
    return index > 0 ? items[index]!.id : null;
  }
  return null;
}
