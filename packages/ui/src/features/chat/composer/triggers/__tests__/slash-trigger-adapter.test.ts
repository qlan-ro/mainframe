import { describe, it, expect } from 'vitest';
import type { CustomCommand, Skill } from '@qlan-ro/mainframe-types';
import { buildSlashTriggerAdapter } from '../slash-trigger-adapter';

const skills: Skill[] = [
  {
    id: 's1',
    adapterId: 'claude',
    name: 'code-review',
    displayName: 'Code Review',
    description: 'Reviews code for quality issues',
    scope: 'global',
    filePath: '/skills/code-review.md',
    content: '# Code Review',
    invocationName: 'plugin:code-review',
  },
  {
    id: 's2',
    adapterId: 'claude',
    name: 'launcher',
    displayName: 'Launcher',
    description: 'Unrelated skill that also mentions launch',
    scope: 'project',
    filePath: '/skills/launcher.md',
    content: '# Launcher',
  },
];

const commands: CustomCommand[] = [
  { name: 'launch-config', description: 'Generate .mainframe/launch.json for this project', source: 'mainframe' },
];

describe('buildSlashTriggerAdapter', () => {
  const adapter = buildSlashTriggerAdapter(skills, commands);

  it('is search-first, so a bare `/` lists everything', () => {
    expect(adapter.categories()).toEqual([]);
    expect(adapter.search?.('')).toHaveLength(3);
  });

  it('puts commands ahead of skills — a handful must not sink under hundreds', () => {
    const items = adapter.search?.('') ?? [];
    expect(items[0]).toMatchObject({ id: 'launch-config', type: 'command' });
    expect(items.slice(1).every((i) => i.type === 'skill')).toBe(true);
  });

  it('matches a command on its name', () => {
    expect(adapter.search?.('launch-con')).toMatchObject([{ id: 'launch-config', type: 'command' }]);
  });

  it('matches a command on its description', () => {
    expect(adapter.search?.('launch.json')).toMatchObject([{ id: 'launch-config', type: 'command' }]);
  });

  it('returns both kinds when a query hits each', () => {
    expect(adapter.search?.('launch')).toMatchObject([
      { id: 'launch-config', type: 'command' },
      { id: 'launcher', type: 'skill' },
    ]);
  });

  it('uses the command name as the id, so the picker inserts `/<name>`', () => {
    expect(adapter.search?.('launch-config')?.[0]?.id).toBe('launch-config');
  });

  it('degrades to skills-only when the daemon offers no commands', () => {
    const noCommands = buildSlashTriggerAdapter(skills, []);
    expect(noCommands.search?.('')).toHaveLength(2);
    expect(noCommands.categoryItems('skills')).toHaveLength(2);
  });

  it('lists commands first in categoryItems too', () => {
    expect(adapter.categoryItems('skills')[0]).toMatchObject({ id: 'launch-config', type: 'command' });
  });
});
