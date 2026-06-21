/**
 * TruncatedWithTooltip — a single-line truncating text span that reveals its
 * full value (or a richer `tooltip`) on hover. Use for clipped labels: session
 * titles, file paths, tab names, breadcrumb segments. Renders nothing for empty
 * text. The Radix `Tooltip.Root` works without a wrapping provider (the app
 * mounts one globally; tests render fine without it).
 */
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { cn } from '@/lib/utils';

interface TruncatedWithTooltipProps {
  /** The (possibly truncated) text to render in the row. */
  text: string;
  /** Classes for the visible span (always truncates). */
  className?: string;
  /** What the tooltip shows; defaults to `text` (e.g. pass a full path here). */
  tooltip?: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  contentClassName?: string;
}

export function TruncatedWithTooltip({ text, className, tooltip, side = 'top', contentClassName }: TruncatedWithTooltipProps) {
  if (!text) return null;
  // Self-contained provider: callers (and tests rendering a single row in
  // isolation) need not mount a global TooltipProvider. Nesting under the app's
  // global provider is fine.
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('truncate', className)}>{text}</span>
        </TooltipTrigger>
        <TooltipContent side={side} className={cn('max-w-[min(60ch,80vw)] break-all font-mono', contentClassName)}>
          {tooltip ?? text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
