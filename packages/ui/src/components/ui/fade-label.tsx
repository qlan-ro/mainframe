import * as React from 'react';
import { useIsTruncated } from '@/lib/ui/use-is-truncated';
import { cn } from '@/lib/utils';

/**
 * A single-line label that fades out at the right edge ONLY when it overflows.
 *
 * `truncate-fade` unconditionally masks the last 20px, which on a label that
 * fits lands the ramp on real glyphs. The hook measures the clip, so a label
 * that fits renders at full ink and one that does not gets the fade.
 * `min-w-0` is on by default: inside a flex row the label must be allowed to
 * shrink or it never overflows and never fades.
 */
export function FadeLabel({ className, children, ...props }: React.ComponentProps<'span'>) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const truncated = useIsTruncated(ref, children);
  return (
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
}
