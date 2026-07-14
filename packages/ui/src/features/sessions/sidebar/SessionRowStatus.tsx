/**
 * SessionRowStatus — the row's leading status indicator (StatusDot).
 *
 * Extracted out of SessionRow.tsx to keep it under the file-size limit after
 * the 2026-07 single-row compaction. Logic is untouched from the prior
 * two-line row — only the wrapper/logo sizing shrank (size-8/size-7 →
 * size-6/size-5) so the glyph sits within one compact row instead of
 * spanning a two-line card. The logo is the row's ONLY status indicator (no
 * text pill): provider shape identifies the adapter, unread controls
 * vividness, and lifecycle only adds motion.
 */
import type { SessionBadge } from '../view-model/session-status';
import { Hint } from '@/components/ui/hint';
import { ProviderLogo } from '@/features/shared/ProviderLogo';

function workingLogoAnimation(adapterId: string): string {
  return adapterId === 'claude' ? 'animate-[mf-claude-logo-working_1.52s_linear_infinite]' : 'animate-spin';
}

function statusLogoClass(badge: SessionBadge, adapterId: string): string {
  const base = 'inline-flex size-6 flex-shrink-0 items-center justify-center';
  const active = badge.base === 'working' || badge.base === 'waiting';
  const visual = badge.unread || active ? 'text-primary' : 'text-mf-text-3';
  switch (badge.base) {
    case 'worktree-missing':
    case 'transcript-missing':
      return `${base} ${visual}`;
    case 'working':
      return `${base} ${visual} ${workingLogoAnimation(adapterId)}`;
    case 'waiting':
      return `${base} ${visual} animate-pulse`;
    case 'idle':
      return `${base} ${visual}`;
  }
}

/** The dot is the row's ONLY status indicator (no text pill) — the tooltip carries the label. */
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
      <span data-testid="sessions-row-status-dot" aria-label={badge.base} className={statusLogoClass(badge, adapterId)}>
        <ProviderLogo adapterId={adapterId} className="size-5" />
      </span>
    </Hint>
  );
}
