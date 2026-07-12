import { cn } from '@/lib/utils';

export interface CountBadgeProps {
  count: number;
  variant?: 'info' | 'unread' | 'alert';
  onAccent?: boolean;
  tone?: 'primary' | 'destructive';
  /** Render a `0` instead of nothing — for section-size counts, not unread/alert badges. */
  showZero?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * macOS-style count indicator. `info`/`unread` are capsule-less gray/accent
 * numerals (Finder/Mail sidebar style); `alert` is a filled attention capsule.
 * Renders nothing when there is nothing to count.
 */
export function CountBadge({
  count,
  variant = 'info',
  onAccent,
  tone = 'primary',
  showZero,
  className,
  ...rest
}: CountBadgeProps) {
  if (count <= 0 && !showZero) return null;

  if (variant === 'alert') {
    return (
      <span
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1',
          'text-caption font-semibold tabular-nums',
          tone === 'destructive' ? 'bg-destructive' : 'bg-primary',
          'text-primary-foreground',
          className,
        )}
        {...rest}
      >
        {count}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'text-caption font-semibold tabular-nums',
        variant === 'unread' ? 'text-primary' : 'text-muted-foreground',
        onAccent && 'text-primary-foreground',
        className,
      )}
      {...rest}
    >
      {count}
    </span>
  );
}
