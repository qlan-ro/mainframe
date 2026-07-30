/**
 * The session row's one starvation rule, in one place: the title has a
 * legibility floor, the trailing slot (timestamp at rest / hover actions on
 * hover) is a fixed reserved width, and the PR affordance never yields —
 * only the decorative cluster (worktree glyph, tag dots) gives up width,
 * one glyph at a time, present at natural width or entirely absent. Nothing
 * interactive lives in the yielding cluster, so nothing interactive can ever
 * wrap, clip, or render as a partial sliver.
 *
 * The four thresholds below are `@container` breakpoints on the row's own
 * container context (SidebarShell's `@container`), never a store-read
 * sidebar width — the persisted width is stale mid-drag, and a container
 * query re-renders for free. There are two PAIRS, not one: a row's true
 * width budget depends on whether it carries a PR affordance (an inline
 * chip or the count indicator), so applying the PR-carrying budget
 * unconditionally would starve a PR-less row of glyphs it can provably
 * afford. `SessionRowMetaIcons` picks the pair via its `hasPrAffordance`
 * prop, which SessionRow derives from `detectedPrs.length > 0` — exactly
 * the condition under which `SessionRowPrRegion` renders anything at all.
 *
 * With a PR affordance (worst case: pinned, one PR chip), from the #285
 * rework brief's budget table:
 *   - title-floor(44) + leading(32) + chip(40) + slot(78) + 3 gaps(27) = 221
 *   - + worktree(14) + 1 gap(9)  = 244  -> reveals at content-box 244, i.e.
 *     sidebar width 244 + 52 = 296
 *   - + dots(21) + 1 gap(9)     = 274  -> reveals at content-box 274, i.e.
 *     sidebar width 274 + 52 = 326
 *
 * Without a PR affordance (worst case: pinned, no PR region rendered at
 * all), the same method with the chip's 40px + its gap dropped:
 *   - title-floor(44) + leading(32) + slot(78) + 2 gaps(18) = 172
 *   - + worktree(14) + 1 gap(9) = 195  -> reveals at content-box 195, i.e.
 *     sidebar width 195 + 52 = 247
 *   - + dots(21) + 1 gap(9)    = 222  -> reveals at content-box 222, i.e.
 *     sidebar width 222 + 52 = 274
 * Both are below the 280px sidebar floor, so a PR-less row shows its
 * worktree glyph and tag dots unconditionally at the default width.
 *
 * Tag dots yield first (the wider threshold in each pair); the worktree
 * glyph survives further into the narrow end.
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
/** Hides the worktree glyph below SESSION_ROW_WORKTREE_THRESHOLD_PX, on a
 *  row that also carries a PR affordance. */
export const SESSION_ROW_WORKTREE_YIELD_CLASS = '@max-[295px]:hidden';

export const SESSION_ROW_DOT_THRESHOLD_PX = 326;
/** Hides the tag dots below SESSION_ROW_DOT_THRESHOLD_PX, on a row that
 *  also carries a PR affordance — the wider of the two thresholds, so dots
 *  yield before the worktree glyph does. */
export const SESSION_ROW_DOT_YIELD_CLASS = '@max-[325px]:hidden';

export const SESSION_ROW_WORKTREE_THRESHOLD_NO_PR_PX = 247;
/** Hides the worktree glyph below SESSION_ROW_WORKTREE_THRESHOLD_NO_PR_PX,
 *  on a row with no PR affordance at all — well under the 280px sidebar
 *  floor, so this glyph is unconditionally visible there. */
export const SESSION_ROW_WORKTREE_YIELD_CLASS_NO_PR = '@max-[246px]:hidden';

export const SESSION_ROW_DOT_THRESHOLD_NO_PR_PX = 274;
/** Hides the tag dots below SESSION_ROW_DOT_THRESHOLD_NO_PR_PX, on a row
 *  with no PR affordance at all — also under the 280px sidebar floor. */
export const SESSION_ROW_DOT_YIELD_CLASS_NO_PR = '@max-[273px]:hidden';

/** Purely decorative: no PR input lives here. Bounded content (one 14px
 *  glyph plus at most three 5px dots) means it never needs to shrink —
 *  each child is present at natural width or hidden by its own threshold
 *  class above, never partially painted. */
export const SESSION_ROW_META_CLUSTER = 'flex flex-shrink-0 items-center gap-x-[6px] text-muted-foreground';
