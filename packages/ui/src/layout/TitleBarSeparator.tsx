import { cn } from '@/lib/utils';

/**
 * The hairline between two title-bar segments: 1 × 16, centred (W1). Darker
 * than `border`, because it has to read on the title bar's ground rather than
 * on a panel.
 */
export function TitleBarSeparator({ className, testId }: { className?: string; testId: string }) {
  return <span aria-hidden data-testid={testId} className={cn('h-4 w-px shrink-0 bg-foreground/18', className)} />;
}
