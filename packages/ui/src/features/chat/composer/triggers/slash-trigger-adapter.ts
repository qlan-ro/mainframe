/**
 * The chat composer's `/` data source: daemon slash commands, then the
 * adapter's skills.
 *
 * Commands lead because there is a handful of them against potentially
 * hundreds of skills — ordered the other way they would never be visible on a
 * bare `/`. Skills keep their own adapter, which the automations `/` field
 * still uses on its own: an automation step invokes a skill, never a chat
 * command.
 */
import type { CustomCommand, Skill } from '@qlan-ro/mainframe-types';
import type { TriggerAdapter, TriggerItem } from '@/components/trigger-engine/types';
import { buildSkillsTriggerAdapter } from './skills-trigger-adapter';

const toItem = (c: CustomCommand): TriggerItem => ({
  id: c.name,
  type: 'command',
  label: c.name,
  description: c.description,
});

export function buildSlashTriggerAdapter(skills: Skill[], commands: CustomCommand[]): TriggerAdapter {
  const skillsAdapter = buildSkillsTriggerAdapter(skills);
  const commandItems = commands.map(toItem);
  return {
    // Search-first, like the skills adapter: no categories, so `computeNavigation`
    // calls `search()` even for `query === ''` and a bare `/` lists everything.
    categories: () => [],
    categoryItems: (categoryId) => [...commandItems, ...skillsAdapter.categoryItems(categoryId)],
    search: (q) => {
      const needle = q.toLowerCase();
      const matched = commands.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(needle));
      return [...matched.map(toItem), ...(skillsAdapter.search?.(q) ?? [])];
    },
  };
}
