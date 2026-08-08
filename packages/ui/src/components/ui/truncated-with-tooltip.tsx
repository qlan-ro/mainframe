import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsTruncated } from '@/lib/ui/use-is-truncated';
import { cn } from '@/lib/utils';

interface TruncatedWithTooltipProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  text: string;
  /** Defaults to `text`; pass something richer (a full path behind a basename) to always offer the tooltip. */
  tooltip?: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  contentClassName?: string;
}

/**
 * A single-line truncating span that reveals its full value on hover.
 *
 * The tooltip opens only when it adds information: with no `tooltip` prop it
 * would merely repeat the text, so it waits until the text is actually clipped;
 * a custom `tooltip` carries more than the visible span and opens regardless.
 */
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
  const canOpen = tooltip !== undefined || truncated;
  return (
    <TooltipProvider>
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
