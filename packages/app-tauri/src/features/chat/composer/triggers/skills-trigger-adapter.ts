/**
 * Builds a synchronous trigger adapter over a preloaded skill list.
 * Categories: one "skills" group. Search: case-insensitive substring match
 * on name / displayName / description.
 */
import type { Skill } from '@qlan-ro/mainframe-types';
import type { Unstable_TriggerItem } from '@assistant-ui/react';

/** Structural shape of an assistant-ui TriggerAdapter (sync). */
export interface TriggerAdapter {
  categories(): readonly { id: string; label: string }[];
  categoryItems(categoryId: string): readonly Unstable_TriggerItem[];
  search?(query: string): readonly Unstable_TriggerItem[];
}

const toItem = (s: Skill): Unstable_TriggerItem => ({
  id: s.invocationName ?? s.name,
  type: 'skill',
  label: s.displayName || s.name,
  description: s.description,
});

export function buildSkillsTriggerAdapter(skills: Skill[]): TriggerAdapter {
  const items = skills.map(toItem);
  return {
    categories: () => [{ id: 'skills', label: 'Skills' }],
    categoryItems: () => items,
    search: (q) => {
      const needle = q.toLowerCase();
      return skills
        .filter((s) => `${s.name} ${s.displayName} ${s.description}`.toLowerCase().includes(needle))
        .map(toItem);
    },
  };
}
