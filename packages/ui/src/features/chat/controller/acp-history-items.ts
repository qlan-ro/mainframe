import type { AccumulatedItem } from '../view-model/acp-item-accumulator';

export function isHeldHistoryItem(items: readonly AccumulatedItem[], id: string, floor?: string): boolean {
  const position = items.findIndex((item) => item.id === id);
  const boundary = floor ? items.findIndex((item) => item.id === floor) : -1;
  return position >= 0 && position >= boundary;
}
