/**
 * Pure badge-state derivation from SessionCustom + client unread flag.
 *
 * Precedence (highest → lowest):
 *   worktree-missing > working > waiting > unread > idle
 *
 * 'working' and 'waiting' are mutually exclusive in practice (displayStatus
 * can only hold one value), so the precedence order is a safety belt only.
 *
 * unread is NOT a field of SessionCustom; callers inject it from the
 * client-side unread store.
 */
import type { SessionCustom } from './chat-to-thread-custom';

export type SessionStatus = 'worktree-missing' | 'working' | 'waiting' | 'unread' | 'idle';

export function deriveSessionStatus(custom: SessionCustom, unread: boolean): SessionStatus {
  if (custom.worktreeMissing) return 'worktree-missing';
  if (custom.displayStatus === 'working') return 'working';
  if (custom.hasPending) return 'waiting';
  if (unread) return 'unread';
  return 'idle';
}
