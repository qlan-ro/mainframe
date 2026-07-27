/**
 * The row's PR cluster is a fixed-width slice of a `flex-shrink-0`-free
 * cluster the title's floor depends on (see session-row-layout.ts) — an
 * unbounded `detected_prs` list would starve the title, so this caps what
 * renders inline and ranks the session's own PRs ahead of ones merely
 * mentioned in conversation.
 */
import type { DetectedPr } from '@qlan-ro/mainframe-types';

export const MAX_ROW_PR_CHIPS = 2;

export interface RowPrArrangement {
  /** Chips rendered inline on the row, session-owned ("created") first. */
  inline: DetectedPr[];
  /** Everything the cap leaves out — non-empty means the row shows the indicator. */
  overflow: DetectedPr[];
  /** All PRs in the same priority order — what the reveal lists, and whose length the indicator shows. */
  ordered: DetectedPr[];
}

const EMPTY_ARRANGEMENT: RowPrArrangement = Object.freeze({ inline: [], overflow: [], ordered: [] });

const sourceRank = (pr: DetectedPr): number => (pr.source === 'created' ? 0 : 1);

export function arrangeRowPrs(prs: readonly DetectedPr[]): RowPrArrangement {
  if (prs.length === 0) return EMPTY_ARRANGEMENT;

  const ordered = [...prs].sort((a, b) => sourceRank(a) - sourceRank(b));
  return {
    inline: ordered.slice(0, MAX_ROW_PR_CHIPS),
    overflow: ordered.slice(MAX_ROW_PR_CHIPS),
    ordered,
  };
}
