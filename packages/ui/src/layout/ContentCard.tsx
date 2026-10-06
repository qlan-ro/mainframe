import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * ContentCard — the one card under the title bar and right of the nav rail,
 * holding the sidebar and the chat side by side. It is the card: the
 * `rounded-tl-[10px]` corner where it meets the chrome, a hairline on the two
 * edges that face the chrome (its right and bottom edges ARE the window's), a
 * `background` fill over the shell's `sidebar` ground, and `overflow-hidden`
 * so nothing inside paints over the corner. Global modal outlets portal to
 * the body, so the clip never touches them.
 */
export function ContentCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-testid="content-card"
      className={cn(
        'flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l bg-background',
        className,
      )}
      {...props}
    />
  );
}
