/**
 * Pure helpers for computing the tag filter bar options.
 *
 * tagsInUse: union of custom.tags for items in scope, sorted and deduped.
 *   Real tags are project-scoped (or all when filterProjectId is null).
 *
 * hasSynthetic: presence of 'has-pr' / 'has-worktree' ACROSS ALL items
 *   (synthetic chips are global, not project-scoped — matches desktop
 *   SessionFilterBar.tsx:26,34).
 *
 * SyntheticTag is imported from @qlan-ro/mainframe-types — no local
 * re-declaration.
 */
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

export function tagsInUse(items: SessionItem[], projectId: string | null): string[] {
  const scoped = projectId === null ? items : items.filter((i) => i.custom.projectId === projectId);
  const seen = new Set<string>();
  for (const item of scoped) {
    for (const tag of item.custom.tags) {
      seen.add(tag);
    }
  }
  return Array.from(seen).sort();
}

export function hasSynthetic(items: SessionItem[], kind: SyntheticTag): boolean {
  if (kind === 'has-pr') {
    return items.some((i) => i.custom.detectedPrs.length > 0);
  }
  return items.some((i) => i.custom.worktreePath !== undefined);
}
