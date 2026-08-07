/**
 * The session panel's width rule, kept pure so the threshold is testable
 * without a DOM.
 *
 * The panel never takes width from the transcript. It floats over the right
 * gutter beside ChatThread's centred message column, so "is there room?" is a
 * question about that gutter, not about the surface as a whole: the column is
 * centred, so each gutter is half of whatever the surface has left over.
 *
 * The four states:
 *   gutter fits, not collapsed → `inline`  — the card floats in the gutter, alone
 *   gutter fits, collapsed     → `rail`    — a rail click takes it back inline
 *   gutter short               → `rail`    — the rail floats at the surface edge
 *   gutter short, asked for it → `overlay` — the same card, over the transcript
 */

/** ChatThread's message column: `max-w-3xl`, border-box, so its `px-5` is inside. */
const TRANSCRIPT_WIDTH = 768;
/** SessionPanel's card — `w-80`. */
const PANEL_WIDTH = 320;
/** The card's gap from the transcript — its `ml-2`. Its `mr-4` is separate. */
const PANEL_MARGIN = 8;
/** SessionPanelRail: a `w-8` control column, `px-1`, and a 1px border each side. */
const RAIL_WIDTH = 42;
/** The rail's `ml-1` from the card plus its `mr-2` from the surface edge. */
const RAIL_MARGINS = 12;

/**
 * What one gutter must hold for the panel to sit inline.
 *
 * The rail is counted even though inline mode hides it: collapsing must not
 * depend on the surface width, so the gutter that admitted the card has to
 * admit the rail the card collapses into.
 *
 * Deliberately conservative — neither state needs all 382. The card occupies
 * 344 (`ml-2` + `w-80` + `mr-4`) and the rail 54. Budgeting for both keeps the
 * threshold put when either one's margins are tuned, which is why stepping the
 * card's right inset from 8 to 16 did not move it.
 */
export const PANEL_BLOCK_WIDTH = PANEL_MARGIN + PANEL_WIDTH + RAIL_MARGINS + RAIL_WIDTH;

/** Surface width at which BOTH gutters clear a panel block — 1532px. */
export const INLINE_MIN_WIDTH = TRANSCRIPT_WIDTH + 2 * PANEL_BLOCK_WIDTH;

export type PanelMode = 'inline' | 'rail' | 'overlay';

export interface PanelModeInput {
  /** Width of the host row the panel floats over. */
  surfaceWidth: number;
  /** The persisted "I collapsed it" preference — only meaningful when it fits. */
  userCollapsed: boolean;
  overlayOpen: boolean;
}

/** True when the transcript's right gutter holds the panel block outright. */
export function gutterFitsPanel(surfaceWidth: number): boolean {
  return surfaceWidth >= INLINE_MIN_WIDTH;
}

export function derivePanelMode({ surfaceWidth, userCollapsed, overlayOpen }: PanelModeInput): PanelMode {
  // Room wins: a gutter that fits shows the card outright, or the rail the user
  // asked for — never the overlay, which exists only to borrow the transcript.
  if (gutterFitsPanel(surfaceWidth)) return userCollapsed ? 'rail' : 'inline';
  return overlayOpen ? 'overlay' : 'rail';
}
