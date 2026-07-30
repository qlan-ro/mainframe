/**
 * The row's one inline PR chip — MAX_ROW_PR_CHIPS caps it at 1 (arrangeRowPrs
 * picks the most recent). Lives in the row's fixed PR region beside the count
 * indicator (session-row-layout.ts), never in the yielding decorative
 * cluster, so it can never wrap, clip, or become unreachable. The label
 * clamps at 5 glyphs so its width is part of the row's fixed budget.
 */
import { useMemo } from 'react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { arrangeRowPrs } from './row-pr-chips';

function prHintLabel(pr: DetectedPr): string {
  const suffix = pr.source === 'mentioned' ? ' — mentioned' : '';
  return `${pr.owner}/${pr.repo} #${pr.number}${suffix}`;
}

export function SessionRowPrChips({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  const { inline } = useMemo(() => arrangeRowPrs(detectedPrs), [detectedPrs]);
  if (inline.length === 0) return null;

  return (
    <>
      {inline.map((pr) => (
        <Hint key={pr.url} label={prHintLabel(pr)}>
          <a
            data-testid={`sessions-row-meta-icon-pr-${pr.number}`}
            data-pr-url={pr.url}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[5ch] items-center truncate font-mono text-caption font-semibold text-mf-success hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{pr.number}
          </a>
        </Hint>
      ))}
    </>
  );
}
