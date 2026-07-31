/**
 * The row's fixed PR affordance region — never yields (session-row-layout.ts).
 * Exactly one of a single inline PR chip or the PR count indicator renders:
 * one PR shows the chip, more than one always shows the indicator, never
 * both. Lives beside the decorative cluster, not inside it, so a PR can
 * never become unreachable under width pressure.
 */
import { useMemo } from 'react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { arrangeRowPrs } from './row-pr-chips';
import { SessionRowPrChips } from './SessionRowPrChips';
import { SessionRowPrOverflow } from './SessionRowPrOverflow';

export function SessionRowPrRegion({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  const { ordered } = useMemo(() => arrangeRowPrs(detectedPrs), [detectedPrs]);
  if (ordered.length === 0) return null;

  return (
    <div data-testid="sessions-row-pr-region" className="flex flex-shrink-0 items-center">
      {ordered.length === 1 ? (
        <SessionRowPrChips detectedPrs={detectedPrs} />
      ) : (
        <SessionRowPrOverflow detectedPrs={detectedPrs} />
      )}
    </div>
  );
}
