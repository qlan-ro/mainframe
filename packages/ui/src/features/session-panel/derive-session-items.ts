import type { SessionContext } from '@qlan-ro/mainframe-types';

export interface SessionItem {
  path: string;
  badge?: string;
}

/**
 * Dedup mentions + modified files into one badged list for the Session context
 * group: a user/auto file mention wins its badge, modified-only files get 'plan'.
 * Insertion order is preserved.
 *
 * Skill files are deliberately absent — they are the Skills sub-group's rows, and
 * listing them here too showed every invoked skill twice.
 */
export function deriveSessionItems(context: SessionContext): SessionItem[] {
  const map = new Map<string, { badge?: string }>();

  for (const m of context.mentions) {
    if (m.kind === 'file' && m.path && m.source !== 'attachment') {
      map.set(m.path, { badge: m.source === 'user' ? '@' : 'auto' });
    }
  }
  for (const f of context.modifiedFiles) {
    map.set(f, { badge: map.get(f)?.badge ?? 'plan' });
  }

  return Array.from(map.entries()).map(([path, meta]) => ({ path, ...meta }));
}
