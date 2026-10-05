import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsTruncated } from '@/lib/ui/use-is-truncated';
import { cn } from '@/lib/utils';

interface FadeLabelProps extends React.ComponentProps<'span'> {
  /**
   * Opt in to a full-text tooltip after this many ms of hover — only while the
   * label is actually clipped, so a label that fits never repeats itself.
   */
  tooltipDelay?: number;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>['side'];
}

/**
 * A single-line label that fades out at the right edge ONLY when it overflows.
 *
 * `truncate-fade` unconditionally masks the last 20px, which on a label that
 * fits lands the ramp on real glyphs. The hook measures the clip, so a label
 * that fits renders at full ink and one that does not gets the fade.
 * `min-w-0` is on by default: inside a flex row the label must be allowed to
 * shrink or it never overflows and never fades.
 */
export function FadeLabel({ className, children, tooltipDelay, tooltipSide = 'bottom', ...props }: FadeLabelProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const truncated = useIsTruncated(ref, children);
  const [hovered, setHovered] = React.useState(false);
  const label = (
    <span
      ref={ref}
      data-slot="fade-label"
      data-truncated={truncated || undefined}
      className={cn('min-w-0 overflow-hidden whitespace-nowrap', truncated && 'truncate-fade', className)}
      {...props}
    >
      {children}
    </span>
  );
  if (tooltipDelay == null) return label;
  return (
    // Controlled so a label that fits never opens; the delay is explicit because
    // the app-root provider runs at zero.
    <Tooltip open={hovered && truncated} onOpenChange={setHovered} delayDuration={tooltipDelay}>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-[min(60ch,80vw)] break-words">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
