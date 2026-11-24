import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * ContentCard — everything under the title bar and right of the nav rail: the
 * sidebar and the chat side by side, on the `background` fill with a hairline
 * under the title bar. The rail draws the hairline between the two (S2). Global
 * modal outlets portal to the body, so the clip never touches them.
 */
export function ContentCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-testid="content-card"
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden border-t bg-background', className)}
      {...props}
    />
  );
}
