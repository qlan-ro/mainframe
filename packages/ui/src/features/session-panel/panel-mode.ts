/**
 * The session panel's width rule, kept pure so the threshold is testable
 * without a DOM.
 *
 * The panel DOCKS: it is a 300px flex sibling of the transcript column when
 * the column has room for both, and an overlay over the transcript's right
 * edge when it does not. (This reverses the older "the panel never takes
 * width" rule — a docked panel reads as a normal inspector; the floating stack
 * competed with the transcript for the same gutter.)
 *
 * The states:
 *   closed                       → `hidden`
 *   open, column fits             → `inline`  — docked beside the transcript
 *   open, column short, floated   → `overlay` — over the transcript's right edge
 *   open, column short, parked    → `hidden`  — the details toggle floats it
 *   unmeasured (width 0)          → `hidden`  — nothing flashes before the first measure
 */

/** The transcript's capped message column (`max-w-[680px]`) plus the
 *  viewport's 2 × 20px padding. Conservative by the padding the capped boxes
 *  carry themselves; accepted in the plan's review. */
export const TRANSCRIPT_MIN = 720;
/** The docked panel's width. */
export const PANEL_WIDTH = 300;
/** Breathing room between the transcript column and the docked panel. */
export const GAP = 24;

/** Column width at which the panel docks — 1044px. */
export const INLINE_MIN_WIDTH = TRANSCRIPT_MIN + GAP + PANEL_WIDTH;

export type PanelMode = 'inline' | 'overlay' | 'hidden';

export interface PanelModeInput {
  /** Width of the chat column the panel shares — measured BEFORE the panel takes its 300. */
  columnWidth: number;
  /** The persisted open bit. */
  open: boolean;
  /** The transient float, per column. */
  overlayOpen: boolean;
}

/** True when the column holds the transcript and the docked panel side by side. */
export function columnFitsPanel(columnWidth: number): boolean {
  return columnWidth >= INLINE_MIN_WIDTH;
}

export function derivePanelMode({ columnWidth, open, overlayOpen }: PanelModeInput): PanelMode {
  // Pre-measurement only — the panel never flashes before the first measure.
  if (columnWidth <= 0 || !open) return 'hidden';
  // Room wins: a column that fits docks outright — never the overlay, which
  // exists only to borrow the transcript.
  if (columnFitsPanel(columnWidth)) return 'inline';
  return overlayOpen ? 'overlay' : 'hidden';
}
