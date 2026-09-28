import { MIN_ZONE_WIDTH } from '@/features/chat/zones/zones-store';

/** Narrower than this, the side chat's composer toolbar stops fitting. */
export const MIN_SIDE_CHAT_WIDTH = 360;

/** The parent keeps the same usable floor a split zone has. */
export const MIN_PARENT_BESIDE_WIDTH = MIN_ZONE_WIDTH;

const DIVIDER_WIDTH = 8;

export type SideChatPlacement = 'beside' | 'below';

/**
 * Beside the parent when the column fits both at their floors; otherwise (a
 * split zone, a narrow window, not yet measured) docked below it.
 */
export function sideChatPlacement(columnWidth: number | null): SideChatPlacement {
  if (columnWidth == null) return 'below';
  return columnWidth >= MIN_PARENT_BESIDE_WIDTH + DIVIDER_WIDTH + MIN_SIDE_CHAT_WIDTH ? 'beside' : 'below';
}
