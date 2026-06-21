/**
 * TruncatedWithTooltip — a single-line truncating text span that reveals its
 * full value (or a richer `tooltip`) on hover. Use for clipped labels: session
 * titles, file paths, tab names, breadcrumb segments. Renders nothing for empty
 * text. Extra props (e.g. `data-testid`) are forwarded to the visible span.
 *
 * The inline `TooltipProvider` is for **test isolation** — each row renders
 * standalone in unit tests without a wrapper. It nests harmlessly under the
 * app's global provider (`app/main.tsx`); the only cost is losing cross-row
 * `skipDelayDuration`, which is fine for clipped labels. `delayDuration={0}`
 * matches the global provider so open-latency is consistent app-wide.
 *
 * Content defaults to sans + `break-words`. Path/identifier call sites opt into
 * monospace + hard breaks via `contentClassName="font-mono break-all"`.
 */
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { cn } from '@/lib/utils';

interface TruncatedWithTooltipProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** The (possibly truncated) text to render in the row. */
  text: string;
  /** What the tooltip shows; defaults to `text` (e.g. pass a full path here). */
  tooltip?: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  contentClassName?: string;
}

export function TruncatedWithTooltip({
  text,
  className,
  tooltip,
  side = 'top',
  contentClassName,
  ...rest
}: TruncatedWithTooltipProps) {
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('truncate', className)} {...rest}>
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className={cn('max-w-[min(60ch,80vw)] break-words', contentClassName)}>
          {tooltip ?? text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
