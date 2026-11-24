/**
 * The row's one trailing value (L3): a spinner while the session runs, "needs
 * you" while it waits on the user, otherwise the time. A status takes the
 * time's place, so the right edge is the only thing to scan.
 *
 * No count and no Unattended mark: those live in the composer.
 */
import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/use-now';
import { formatCompactTime } from './compact-time';
import type { SessionStatus } from './view-model/session-status';

interface SessionRowStatusProps {
  status: SessionStatus;
  updatedAt: number;
}

export function SessionRowStatus({ status, updatedAt }: SessionRowStatusProps) {
  return (
    <span
      data-testid="sessions-row-status"
      data-status={status}
      className={cn(
        'flex h-4 min-w-4 shrink-0 items-center justify-end text-xs text-muted-foreground',
        // The row's fills darken the ground under the meta ink; step up with them.
        'group-hover/menu-item:text-sidebar-foreground/80 group-data-active/menu-item:text-sidebar-foreground/80',
      )}
    >
      <StatusValue status={status} updatedAt={updatedAt} />
    </span>
  );
}

function StatusValue({ status, updatedAt }: SessionRowStatusProps) {
  const now = useNow();
  if (status === 'running') {
    return (
      <>
        <Loader2Icon aria-hidden className="size-3.5! animate-spin text-primary motion-reduce:animate-none" />
        <span className="sr-only">Running</span>
      </>
    );
  }
  if (status === 'needs-you') return <span className="font-medium text-warning">needs you</span>;
  return (
    <span data-testid="sessions-row-relative-time" className="tabular-nums">
      {formatCompactTime(updatedAt, now)}
    </span>
  );
}
