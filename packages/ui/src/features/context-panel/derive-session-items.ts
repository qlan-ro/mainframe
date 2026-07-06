import type { SessionContext } from '@qlan-ro/mainframe-types';

export interface SessionItem {
  path: string;
  badge?: string;
  displayName?: string;
}

/**
 * Dedup mentions + modified files + skill files into one badged list for the
 * Session context group. Mirrors desktop ContextTab's dedup: a user/auto file
 * mention wins its badge, modified-only files get 'plan', skill files get 'skill'
 * unless already present. Insertion order is preserved.
 */
export function deriveSessionItems(context: SessionContext): SessionItem[] {
  const map = new Map<string, { badge?: string; displayName?: string }>();

  for (const m of context.mentions) {
    if (m.kind === 'file' && m.path && m.source !== 'attachment') {
      map.set(m.path, { badge: m.source === 'user' ? '@' : 'auto' });
    }
  }
  for (const f of context.modifiedFiles) {
    const existing = map.get(f);
    map.set(f, { badge: existing?.badge ?? 'plan', displayName: existing?.displayName });
  }
  for (const f of context.skillFiles) {
    if (!map.has(f.path)) {
      map.set(f.path, { badge: 'skill', displayName: f.displayName });
    }
  }

  return Array.from(map.entries()).map(([path, meta]) => ({ path, ...meta }));
}

export function sessionItemCount(context: SessionContext): number {
  return deriveSessionItems(context).length + context.attachments.length;
}
