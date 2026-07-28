/**
 * Pure-logic contract for the Skills section's search, grouping, and
 * delete-affordance gating (plan T22).
 */
import { describe, it, expect } from 'vitest';
import type { Skill } from '@qlan-ro/mainframe-types';
import { matchesQuery, groupByScope, isDeletable, skillDirectory } from '../skill-filters';

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'claude:project:review',
    adapterId: 'claude',
    name: 'review',
    displayName: 'Review',
    description: 'Reviews code for correctness',
    scope: 'project',
    filePath: '/p/.claude/skills/review/SKILL.md',
    content: '# Review',
    invocationName: 'review',
    ...overrides,
  };
}

describe('matchesQuery', () => {
  it('matches case-insensitively on displayName', () => {
    expect(matchesQuery(skill({ displayName: 'Code Review' }), 'CODE review')).toBe(true);
  });

  it('matches case-insensitively on name', () => {
    expect(matchesQuery(skill({ name: 'tdd-helper' }), 'TDD')).toBe(true);
  });

  it('matches case-insensitively on description', () => {
    expect(matchesQuery(skill({ description: 'Finds edge cases' }), 'EDGE CASES')).toBe(true);
  });

  it('matches case-insensitively on invocationName', () => {
    expect(matchesQuery(skill({ invocationName: 'quick-review' }), 'quick-REVIEW')).toBe(true);
  });

  it('returns false when the query matches none of the four fields', () => {
    expect(matchesQuery(skill(), 'no-such-term')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery(skill({ displayName: 'anything' }), '')).toBe(true);
  });

  it('matches everything on a whitespace-only query', () => {
    expect(matchesQuery(skill({ displayName: 'anything' }), '   ')).toBe(true);
  });
});

describe('groupByScope', () => {
  it('orders groups project, then global, then plugin, regardless of input order', () => {
    const skills = [
      skill({ id: 'p', scope: 'plugin', name: 'p' }),
      skill({ id: 'g', scope: 'global', name: 'g' }),
      skill({ id: 'j', scope: 'project', name: 'j' }),
    ];

    expect(groupByScope(skills).map((g: { scope: Skill['scope'] }) => g.scope)).toEqual([
      'project',
      'global',
      'plugin',
    ]);
  });

  it('omits a scope with no members instead of returning an empty group', () => {
    const skills = [skill({ id: 'j', scope: 'project' })];

    expect(groupByScope(skills)).toEqual([{ scope: 'project', skills: [skills[0]] }]);
  });

  it('preserves input order of members within a group', () => {
    const b = skill({ id: 'b', scope: 'project', name: 'b' });
    const a = skill({ id: 'a', scope: 'project', name: 'a' });
    const skills = [b, a];

    const [group] = groupByScope(skills);
    expect(group.skills.map((s: Skill) => s.id)).toEqual(['b', 'a']);
  });

  it('returns no groups for an empty input', () => {
    expect(groupByScope([])).toEqual([]);
  });
});

describe('isDeletable', () => {
  it('is true for a project-scope SKILL.md-backed skill', () => {
    expect(isDeletable(skill({ scope: 'project', filePath: '/p/.claude/skills/review/SKILL.md' }))).toBe(true);
  });

  it('is true for a global-scope SKILL.md-backed skill', () => {
    expect(isDeletable(skill({ scope: 'global', filePath: '/home/u/.claude/skills/tdd/SKILL.md' }))).toBe(true);
  });

  it('is false for a plugin-scope SKILL.md-backed skill', () => {
    expect(
      isDeletable(
        skill({ scope: 'plugin', pluginName: 'acme', filePath: '/p/.claude/plugins/acme/skills/x/SKILL.md' }),
      ),
    ).toBe(false);
  });

  it('is false for a command-derived entry (backing file is not SKILL.md)', () => {
    expect(isDeletable(skill({ scope: 'project', filePath: '/p/.claude/commands/git/commit.md' }))).toBe(false);
  });

  it('is true across a Windows path separator', () => {
    expect(isDeletable(skill({ scope: 'project', filePath: 'C:\\p\\.claude\\skills\\review\\SKILL.md' }))).toBe(true);
  });

  it('is false for a file that merely ends with the SKILL.md characters as a suffix, not the whole segment', () => {
    expect(isDeletable(skill({ scope: 'project', filePath: '/p/.claude/skills/review/MY-SKILL.md' }))).toBe(false);
  });
});

describe('skillDirectory', () => {
  it('returns the parent directory of a project-scope filePath', () => {
    expect(skillDirectory(skill({ filePath: '/p/.claude/skills/review/SKILL.md' }))).toBe('/p/.claude/skills/review');
  });

  it('returns the parent directory across a Windows path separator', () => {
    expect(skillDirectory(skill({ filePath: 'C:\\p\\.claude\\skills\\review\\SKILL.md' }))).toBe(
      'C:\\p\\.claude\\skills\\review',
    );
  });
});
