/**
 * The session row's one starvation rule, in one place: the title has a
 * legibility floor, the trailing slot (timestamp at rest / hover actions on
 * hover) is a fixed reserved width, and the PR affordance never yields —
 * only the decorative cluster (worktree glyph, tag dots) gives up width,
 * one glyph at a time, present at natural width or entirely absent. Nothing
 * interactive lives in the yielding cluster, so nothing interactive can ever
 * wrap, clip, or render as a partial sliver.
 *
 * The two thresholds below are `@container` breakpoints on the row's own
 * container context (SidebarShell's `@container`), never a store-read
 * sidebar width — the persisted width is stale mid-drag, and a container
 * query re-renders for free. Both are derived worst-case (a pinned row
 * showing a PR chip) from the #285 rework brief's budget table, so each
 * glyph is safe to reveal no matter what else the row is carrying:
 *   - title-floor(44) + leading(32) + chip(40) + slot(78) + 3 gaps(27) = 221
 *   - + worktree(14) + 1 gap(9)  = 244  -> reveals at content-box 244, i.e.
 *     sidebar width 244 + 52 = 296
 *   - + dots(21) + 1 gap(9)     = 274  -> reveals at content-box 274, i.e.
 *     sidebar width 274 + 52 = 326
 * Tag dots yield first (the wider threshold); the worktree glyph survives
 * further into the narrow end.
 */

/** The session title never shrinks below this. 44px is the largest floor
 *  that still fits the 280px sidebar floor with a pin glyph, the PR
 *  affordance at its widest, and the trailing slot all present. */
export const SESSION_ROW_TITLE_FLOOR = 'min-w-[44px]';

/** Width of the row's permanently reserved trailing region: the relative
 *  timestamp at rest, the three hover-action buttons painted over it
 *  (absolutely positioned) on hover. Never changes width or position. */
export const SESSION_ROW_TRAILING_SLOT_PX = 78;

export const SESSION_ROW_WORKTREE_THRESHOLD_PX = 296;
/** Hides the worktree glyph below SESSION_ROW_WORKTREE_THRESHOLD_PX. */
export const SESSION_ROW_WORKTREE_YIELD_CLASS = '@max-[295px]:hidden';

export const SESSION_ROW_DOT_THRESHOLD_PX = 326;
/** Hides the tag dots below SESSION_ROW_DOT_THRESHOLD_PX — the wider of the
 *  two thresholds, so dots yield before the worktree glyph does. */
export const SESSION_ROW_DOT_YIELD_CLASS = '@max-[325px]:hidden';

/** Purely decorative: no PR input lives here. Bounded content (one 14px
 *  glyph plus at most three 5px dots) means it never needs to shrink —
 *  each child is present at natural width or hidden by its own threshold
 *  class above, never partially painted. */
export const SESSION_ROW_META_CLUSTER = 'flex flex-shrink-0 items-center gap-x-[6px] text-muted-foreground';
