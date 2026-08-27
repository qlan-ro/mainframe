/**
 * Pure AND-match filter over the in-memory thread list.
 * All active filter dimensions must match (project ∧ tags ∧ synthetic).
 *
 * has-pr and has-worktree are client-only synthetic checks — not sent to
 * the server (D7).
 *
 * selectedSynthetic is typed Set<SyntheticTag> from @qlan-ro/mainframe-types.
 * No local literal-union re-declaration.
 */
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

export interface SessionFilters {
  /** Project scope; empty = all projects. */
  filterProjectIds: ReadonlySet<string>;
  selectedTags: Set<string>;
  selectedSynthetic: Set<SyntheticTag>;
}

function matchesTags(item: SessionItem, selectedTags: Set<string>): boolean {
  for (const tag of selectedTags) {
    if (!item.custom.tags.includes(tag)) return false;
  }
  return true;
}

function matchesSynthetic(item: SessionItem, selectedSynthetic: Set<SyntheticTag>): boolean {
  if (selectedSynthetic.has('has-pr') && item.custom.detectedPrs.length === 0) return false;
  if (selectedSynthetic.has('has-worktree') && item.custom.worktreePath === undefined) return false;
  return true;
}

export function applySessionFilters(items: SessionItem[], f: SessionFilters): SessionItem[] {
  return items.filter((item) => {
    if (f.filterProjectIds.size > 0 && !f.filterProjectIds.has(item.custom.projectId)) return false;
    if (!matchesTags(item, f.selectedTags)) return false;
    if (!matchesSynthetic(item, f.selectedSynthetic)) return false;
    return true;
  });
}
