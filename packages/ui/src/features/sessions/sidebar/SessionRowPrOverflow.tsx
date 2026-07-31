/**
 * The session row's PR count indicator — a glyph plus the TOTAL detected-PR
 * count, revealing every PR in a popover. Renders whenever more than one PR
 * is detected, replacing the single inline chip (never both at once).
 *
 * It lives in the row's fixed PR region, never the decorative cluster
 * (session-row-layout.ts): squeezed away exactly when the row is tightest, an
 * affordance a mouse user cannot reach is worse than none. It shows the
 * total, not a "+N hidden" count, since only one PR is ever inline. The label
 * clamps at 99+ so its width stays part of the row's fixed budget.
 */
import { useMemo } from 'react';
import { GitPullRequest } from 'lucide-react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { arrangeRowPrs } from './row-pr-chips';

function PrOverflowItem({ pr }: { pr: DetectedPr }) {
  return (
    <a
      data-testid={`sessions-row-pr-overflow-item-${pr.number}`}
      data-pr-url={pr.url}
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-[6px] rounded-sm px-[8px] py-[5px] text-caption hover:bg-accent"
    >
      <span className="flex-shrink-0 font-mono font-semibold text-mf-success">#{pr.number}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {pr.owner}/{pr.repo}
      </span>
      {pr.source === 'mentioned' && <span className="flex-shrink-0 text-micro text-muted-foreground">mentioned</span>}
    </a>
  );
}

export function SessionRowPrOverflow({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  const { ordered } = useMemo(() => arrangeRowPrs(detectedPrs), [detectedPrs]);
  if (ordered.length <= 1) return null;

  return (
    <Popover>
      <Hint label={`${ordered.length} pull requests on this session`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="sessions-row-pr-overflow"
            aria-label={`Show all ${ordered.length} pull requests`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex flex-shrink-0 items-center gap-[3px] rounded-xs px-[3px] text-caption font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <GitPullRequest size={11} aria-hidden />
            {ordered.length > 99 ? '99+' : ordered.length}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="start"
        side="bottom"
        className="max-h-[240px] w-[210px] overflow-y-auto"
        data-testid="sessions-row-pr-overflow-panel"
      >
        <div className="flex flex-col">
          {ordered.map((pr) => (
            <PrOverflowItem key={pr.url} pr={pr} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
