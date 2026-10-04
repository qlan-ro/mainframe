/**
 * PanelEyebrow — the docked panel's section header: an uppercase eyebrow
 * label, an optional live dot (something in the section is running) and an
 * optional count. Static, not a trigger — the panel is one scrolling column
 * and only Context keeps a collapse (`PanelSection`).
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const EYEBROW = 'text-xs font-semibold tracking-wide text-muted-foreground uppercase';

interface PanelEyebrowProps {
  label: string;
  /** Omitted renders no badge — a section with nothing to count shows nothing. */
  count?: number;
  /** Something in this section is live; the tooltip on the rows says what. */
  live?: boolean;
  liveTestId?: string;
  className?: string;
}

export function PanelEyebrow({ label, count, live = false, liveTestId, className }: PanelEyebrowProps) {
  return (
    <div className={cn('flex h-8 shrink-0 items-center gap-2 px-2', className)}>
      <span className={cn(EYEBROW, 'min-w-0 truncate')}>{label}</span>
      {live && (
        <span
          data-testid={liveTestId}
          aria-label="running"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
        />
      )}
      {count != null && <Badge variant="secondary">{count}</Badge>}
    </div>
  );
}
