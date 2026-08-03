/**
 * The row's leading status indicator — its only one, since there is no text pill.
 * Provider shape identifies the adapter, colour carries attention, and lifecycle
 * adds motion.
 *
 * The shipped version tints across a 4-step ink ramp (`text-mf-text-3`); stock
 * has two usable inks, so this reads `primary` for anything wanting attention
 * and `muted-foreground` for everything else, per the locked decision.
 */
import type { SessionBadge } from '@/features/sessions/view-model/session-status';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@v2/lib/utils';
import { ProviderLogo } from '../shared/ProviderLogo';

/** Claude's mark is radially symmetric; a plain spin reads wrong on the others. */
function workingAnimation(adapterId: string): string {
  return adapterId === 'claude' ? 'animate-[mf-claude-logo-working_1.52s_linear_infinite]' : 'animate-spin';
}

function statusClass(badge: SessionBadge, adapterId: string): string {
  const active = badge.base === 'working' || badge.base === 'waiting';
  return cn(
    'inline-flex size-6 shrink-0 items-center justify-center',
    badge.unread || active ? 'text-primary' : 'text-muted-foreground',
    badge.base === 'working' && workingAnimation(adapterId),
    badge.base === 'waiting' && 'animate-pulse',
  );
}

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

export function StatusDot({ badge, adapterId = 'claude' }: { badge: SessionBadge; adapterId?: string }) {
  return (
    <Hint label={dotLabel(badge)}>
      <span data-testid="sessions-row-status-dot" aria-label={badge.base} className={statusClass(badge, adapterId)}>
        <ProviderLogo adapterId={adapterId} className="size-5" />
      </span>
    </Hint>
  );
}
