/**
 * The session panel's width rule, kept pure so the threshold is testable
 * without a DOM: the panel sits inline while the chat surface is wide enough,
 * collapses to the rail when it is not, and floats over the surface when a rail
 * click asked for it.
 */

/** Chat-surface width at which the panel is wide enough to sit inline. */
export const INLINE_MIN_WIDTH = 1000;

export type PanelMode = 'inline' | 'rail' | 'overlay';

export interface PanelModeInput {
  /** Width of the host row the panel shares with the thread column. */
  surfaceWidth: number;
  overlayOpen: boolean;
}

export function derivePanelMode({ surfaceWidth, overlayOpen }: PanelModeInput): PanelMode {
  // Width wins: a surface wide enough for the inline card has nothing to float.
  if (surfaceWidth >= INLINE_MIN_WIDTH) return 'inline';
  return overlayOpen ? 'overlay' : 'rail';
}
