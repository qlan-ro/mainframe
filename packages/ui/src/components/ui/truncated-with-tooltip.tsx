/**
 * TruncatedWithTooltip — a single-line truncating text span that reveals its
 * full value (or a richer `tooltip`) on hover. Use for clipped labels: session
 * titles, file paths, tab names, breadcrumb segments. Renders nothing for empty
 * text. Extra props (e.g. `data-testid`) are forwarded to the visible span.
 *
 * The tooltip only opens when it adds information:
 *   - no `tooltip` prop (it would just repeat the text) → opens ONLY when the
 *     text is actually truncated, revealing the cut-off remainder;
 *   - a custom `tooltip` prop (e.g. a full path while the span shows a basename)
 *     → opens on hover regardless, since it carries more than the visible text.
 *
 * The inline `TooltipProvider` is for **test isolation** — each row renders
 * standalone in unit tests without a wrapper. It nests harmlessly under the
 * app's global provider (`app/main.tsx`); the only cost is losing cross-row
 * `skipDelayDuration`, which is fine for clipped labels. It uses the shared
 * `TOOLTIP_DELAY_MS` so open-latency is consistent app-wide.
 *
 * Content defaults to sans + `break-words`. Path/identifier call sites opt into
 * monospace + hard breaks via `contentClassName="font-mono break-all"`.
 */
import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TOOLTIP_DELAY_MS } from './tooltip';
import { useIsTruncated } from '@/lib/ui/use-is-truncated';
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
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useIsTruncated(ref, text);
  const [hovered, setHovered] = useState(false);
  if (!text) return null;
  // A custom tooltip adds info beyond the visible text → always offer it; a
  // default tooltip merely repeats the text → only when the text is clipped.
  const canOpen = tooltip !== undefined || truncated;
  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <Tooltip open={hovered && canOpen} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <span ref={ref} className={cn('truncate', className)} {...rest}>
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
