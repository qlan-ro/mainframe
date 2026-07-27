/**
 * Builds a synchronous trigger adapter over a preloaded skill list.
 * Categories: one "skills" group. Search: case-insensitive substring match
 * on name / displayName / description.
 */
import type { Skill } from '@qlan-ro/mainframe-types';
import type { TriggerAdapter, TriggerItem } from '@/components/trigger-engine/types';

const toItem = (s: Skill): TriggerItem => ({
  id: s.invocationName ?? s.name,
  type: 'skill',
  label: s.displayName || s.name,
  description: s.description,
});

export function buildSkillsTriggerAdapter(skills: Skill[]): TriggerAdapter {
  const items = skills.map(toItem);
  return {
    // Search-first: no categories, so `computeNavigation` always calls
    // `search()` (even for `query === ''`) — bare `/` lists all skills.
    categories: () => [],
    categoryItems: () => items,
    search: (q) => {
      const needle = q.toLowerCase();
      return skills
        .filter((s) => `${s.name} ${s.displayName} ${s.description}`.toLowerCase().includes(needle))
        .map(toItem);
    },
  };
}
