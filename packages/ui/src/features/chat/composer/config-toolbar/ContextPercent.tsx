/**
 * ContextPercent — the context-window fill as a mono percentage at the end
 * of the composer toolbar (the rail's ring is gone). Null while nothing
 * trustworthy is known; the detail lives in the session panel's Context row.
 */
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useContextPercent } from '@/features/session-panel/use-context-percent';
import { QUOTA_RED_THRESHOLD } from '@/features/quota/quota-format';

export function ContextPercent() {
  const percent = useContextPercent();
  if (percent == null) return null;
  return (
    <Hint label={`Context: ${percent}% used`} side="top">
      <span
        data-testid="composer-context-percent"
        className={cn(
          'shrink-0 font-mono text-xs tabular-nums',
          percent >= QUOTA_RED_THRESHOLD ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {percent}%
      </span>
    </Hint>
  );
}
