/**
 * The session row's one starvation rule, in one place: the title has a
 * legibility floor, every meta glyph yields before it, and a glyph yields
 * whole rather than half-clipped. Anything that must stay clickable when the
 * row is at its tightest goes BESIDE the cluster, not inside it.
 *
 * A new meta glyph belongs inside SESSION_ROW_META_CLUSTER — that is what
 * keeps it from taking the title's width the way the uncapped PR chips did.
 * Both constants are literal strings so Tailwind's scanner sees the classes.
 */

/** The session title never shrinks below this. 44px is the largest floor that
 *  still fits the 280px sidebar with a pin glyph, the PR indicator at its
 *  widest label and the hover actions all showing. */
export const SESSION_ROW_TITLE_FLOOR = 'min-w-[44px]';

/** The meta cluster is the row's shock absorber: it shrinks (min-w-0, no
 *  flex-shrink-0) and drops whole glyphs by wrapping them onto a second line
 *  the fixed height clips away, rather than clipping one in half. */
export const SESSION_ROW_META_CLUSTER =
  'flex min-w-0 h-[17px] flex-wrap content-start items-center gap-x-[6px] gap-y-[8px] overflow-hidden text-muted-foreground';
