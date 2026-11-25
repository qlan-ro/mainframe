import type { SessionContext } from '@qlan-ro/mainframe-types';

/** Why a file is in the session: the user mentioned it, the agent picked it up, or the session changed it. */
export type SessionItemReason = 'mentioned' | 'auto' | 'edited';

export interface SessionItem {
  path: string;
  reason: SessionItemReason;
}

/**
 * Mentions and modified files as one list: a mention keeps its own reason, and
 * a file that was only modified reads `edited`. Insertion order is preserved.
 *
 * Skill files are deliberately absent — they are the Skills section's rows, and
 * listing them here too showed every invoked skill twice.
 */
export function deriveSessionItems(context: SessionContext): SessionItem[] {
  const reasons = new Map<string, SessionItemReason>();
  for (const m of context.mentions) {
    if (m.kind === 'file' && m.path && m.source !== 'attachment') {
      reasons.set(m.path, m.source === 'user' ? 'mentioned' : 'auto');
    }
  }
  for (const path of context.modifiedFiles) {
    if (!reasons.has(path)) reasons.set(path, 'edited');
  }
  return Array.from(reasons, ([path, reason]) => ({ path, reason }));
}
