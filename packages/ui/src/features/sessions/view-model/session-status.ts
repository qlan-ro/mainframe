/**
 * Pure badge-state derivation from SessionCustom + client unread flag.
 *
 * `base` is the dominant lifecycle status (precedence: worktree-missing >
 * transcript-missing > working > waiting > idle). `unread` is a MODIFIER
 * carried alongside it — the row tints idle / adds the answer-ready treatment
 * to waiting based on it. unread is NOT a field of SessionCustom; callers
 * inject it from the client store.
 */
import type { SessionCustom } from './chat-to-thread-custom';

export type SessionBase = 'worktree-missing' | 'transcript-missing' | 'working' | 'waiting' | 'idle';

export interface SessionBadge {
  base: SessionBase;
  unread: boolean;
}

export function deriveSessionBadge(custom: SessionCustom, unread: boolean): SessionBadge {
  if (custom.worktreeMissing) return { base: 'worktree-missing', unread };
  if (custom.transcriptMissing) return { base: 'transcript-missing', unread };
  if (custom.displayStatus === 'working') return { base: 'working', unread };
  if (custom.hasPending) return { base: 'waiting', unread };
  return { base: 'idle', unread };
}
