import { ItemMetaSchema, MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from '../view-model/acp-item-accumulator';

export function isHeldHistoryItem(items: readonly AccumulatedItem[], id: string, floor?: string): boolean {
  const position = items.findIndex((item) => {
    if (item.id === id) return true;
    const meta = ItemMetaSchema.safeParse(item.meta?.[MAINFRAME_META_NAMESPACE]);
    return meta.success && meta.data.sourceToolCallId === id;
  });
  const boundary = floor ? items.findIndex((item) => item.id === floor) : -1;
  return position >= 0 && position >= boundary;
}
