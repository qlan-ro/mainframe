/**
 * The row's one inline PR chip is a fixed-width slice of the row's PR region
 * (see session-row-layout.ts) — an unbounded `detected_prs` list would
 * starve the title, so this caps what renders inline to a single PR: the
 * most recent session-created one, falling back to the most recent
 * merely-mentioned one when the session created none. `DetectedPr` carries
 * no timestamp, so "most recent" means last-appended in the daemon's
 * append-only, URL-deduped `detected_prs` array — its order IS detection
 * order.
 */
import type { DetectedPr } from '@qlan-ro/mainframe-types';

export const MAX_ROW_PR_CHIPS = 1;

export interface RowPrArrangement {
  /** At most MAX_ROW_PR_CHIPS entries: the most recent created PR, or the
   *  most recent mentioned one when the session created none. */
  inline: DetectedPr[];
  /** Everything the inline slice leaves out — the count indicator's popover
   *  lists `ordered` (inline included), not this. */
  overflow: DetectedPr[];
  /** All PRs, session-created first, append order preserved within each
   *  group — what the count indicator's popover lists in full. */
  ordered: DetectedPr[];
}

const EMPTY_ARRANGEMENT: RowPrArrangement = Object.freeze({ inline: [], overflow: [], ordered: [] });

const sourceRank = (pr: DetectedPr): number => (pr.source === 'created' ? 0 : 1);

function lastAppended(prs: readonly DetectedPr[], source: DetectedPr['source']): DetectedPr | undefined {
  for (let i = prs.length - 1; i >= 0; i--) {
    const pr = prs[i];
    if (pr != null && pr.source === source) return pr;
  }
  return undefined;
}

export function arrangeRowPrs(prs: readonly DetectedPr[]): RowPrArrangement {
  if (prs.length === 0) return EMPTY_ARRANGEMENT;

  const ordered = [...prs].sort((a, b) => sourceRank(a) - sourceRank(b));
  const picked = lastAppended(prs, 'created') ?? lastAppended(prs, 'mentioned');
  const inline = picked != null ? [picked].slice(0, MAX_ROW_PR_CHIPS) : [];
  const overflow = ordered.filter((pr) => pr !== picked);

  return { inline, overflow, ordered };
}
