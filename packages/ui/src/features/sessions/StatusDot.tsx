/**
 * The row's leading status indicator — status ONLY, now that the provider's
 * mark lives at the end of the meta line. One 24px slot so titles line up
 * with the draft row; inside it an 8px glyph:
 *   working            → `primary` spinner
 *   waiting            → pulsing `primary` dot (incl. a waiting side chat)
 *   idle + unread      → solid `primary` dot
 *   idle               → `muted-foreground` ring
 *   worktree-/transcript-missing → `warning` ring — the session still works,
 *                        its checkout or history is just gone (not on the
 *                        board; decided in the adoption plan, D15).
 */
import { Loader2Icon } from 'lucide-react';
import type { SessionBadge } from '@/features/sessions/view-model/session-status';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';

function dotLabel(badge: SessionBadge): string {
  switch (badge.base) {
    case 'worktree-missing':
      return 'Worktree missing';
    case 'transcript-missing':
      return 'Transcript missing';
    case 'working':
      return 'Working';
    case 'waiting':
      return 'Your turn';
    case 'idle':
      return badge.unread ? 'Unread response' : 'Idle';
  }
}

function Glyph({ badge }: { badge: SessionBadge }) {
  switch (badge.base) {
    case 'working':
      return <Loader2Icon aria-hidden className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />;
    case 'waiting':
      return <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />;
    case 'worktree-missing':
    case 'transcript-missing':
      return <span aria-hidden className="size-2 rounded-full border-[1.5px] border-warning" />;
    case 'idle':
      return badge.unread ? (
        <span aria-hidden className="size-2 rounded-full bg-primary" />
      ) : (
        <span aria-hidden className="size-2 rounded-full border-[1.5px] border-muted-foreground" />
      );
  }
}

export function StatusDot({ badge }: { badge: SessionBadge }) {
  return (
    <Hint label={dotLabel(badge)}>
      <span
        data-testid="sessions-row-status-dot"
        data-status={badge.base}
        data-unread={badge.unread || undefined}
        aria-label={badge.base}
        className={cn('inline-flex size-6 shrink-0 items-center justify-center')}
      >
        <Glyph badge={badge} />
      </span>
    </Hint>
  );
}
