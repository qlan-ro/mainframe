/**
 * TitleBarButton — the title bar's plain icon button. With `on` it is a toggle:
 * no outlined track, just a soft fill and ink icon while lit (W3), so two lit
 * toggles side by side read as two toggles rather than an odd double selection.
 */
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';

interface TitleBarButtonProps extends Omit<ComponentProps<typeof Button>, 'variant'> {
  testId: string;
  /** Accessible name: an icon-only control has no other. */
  label: string;
  /** Tooltip text, when it says more than the name (a chord, the next state). */
  hint?: string;
  /** Pressed state; leave out for a button that is not a toggle. */
  on?: boolean;
}

export function TitleBarButton({
  testId,
  label,
  hint,
  on,
  size = 'icon-sm',
  className,
  ...props
}: TitleBarButtonProps) {
  return (
    <Hint label={hint ?? label}>
      <Button
        data-testid={testId}
        aria-label={label}
        aria-pressed={on}
        variant="ghost"
        size={size}
        className={cn(
          // Over the title bar's ground, where `muted` would barely show.
          'text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/5',
          on && 'bg-foreground/8 text-foreground hover:bg-foreground/8 dark:hover:bg-foreground/8',
          className,
        )}
        {...props}
      />
    </Hint>
  );
}
