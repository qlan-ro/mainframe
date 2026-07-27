/**
 * The inline PR chips on a session row — capped at MAX_ROW_PR_CHIPS, the
 * session's own PRs first (arrangeRowPrs). Renders a Fragment, not a wrapper,
 * so each chip is a direct child of the meta cluster and yields whole under
 * pressure (see session-row-layout.ts). Everything the cap leaves out is
 * reachable through SessionRowPrOverflow, which sits beside the cluster.
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
            className="inline-flex items-center font-mono text-caption font-semibold text-mf-success hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{pr.number}
          </a>
        </Hint>
      ))}
    </>
  );
}
