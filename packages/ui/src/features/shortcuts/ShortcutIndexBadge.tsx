/**
 * The key cap a tab wears while the hint modifier is held — the same chip the
 * cheat sheet spells chords with, sized to sit in a leading avatar's slot so
 * revealing the hints never reflows the strip.
 */
import { cn } from '@/lib/utils';

interface ShortcutIndexBadgeProps {
  /** 1-based, as typed: the badge on the first tab reads `1`. */
  index: number;
  className?: string;
  'data-testid'?: string;
}

export function ShortcutIndexBadge({ index, className, ...rest }: ShortcutIndexBadgeProps) {
  return (
    <kbd
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-xs border bg-muted',
        'font-mono text-xs leading-none font-semibold tabular-nums text-foreground',
        className,
      )}
      {...rest}
    >
      {index}
    </kbd>
  );
}
