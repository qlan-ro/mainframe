/**
 * installed-index.test.ts
 *
 * The join between the CLI manifest and the registry list. Its failure mode is
 * silent and wrong either way: a missed match offers a skill the user already
 * has, a false match marks one they don't.
 */
import { describe, it, expect } from 'vitest';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { buildInstalledIndex, installedScopesFor } from '../installed-index';
import type { BrowseItem } from '../use-skills-browse-store';

const entry = (over: Partial<SkillsCliEntry>): SkillsCliEntry => ({
  name: 'pdf',
  scope: 'project',
  source: 'anthropic/skills',
  sourceType: 'github',
  skillPath: null,
  ...over,
});

const item = (over: Partial<BrowseItem>): BrowseItem => ({
  source: 'anthropic/skills',
  skillId: 'pdf',
  name: 'PDF',
  installs: 10,
  ...over,
});

describe('buildInstalledIndex', () => {
  it('matches a registry row on its source and skill id', () => {
    const index = buildInstalledIndex([entry({})]);

    expect(installedScopesFor(index, item({}))).toEqual(['project']);
  });

  it('does not match a same-named skill from a different source', () => {
    const index = buildInstalledIndex([entry({})]);

    expect(installedScopesFor(index, item({ source: 'acme/skills' }))).toEqual([]);
  });

  it('collects both scopes for a skill installed twice', () => {
    const index = buildInstalledIndex([entry({ scope: 'project' }), entry({ scope: 'global' })]);

    expect(installedScopesFor(index, item({}))).toEqual(['project', 'global']);
  });

  it('ignores a source-less manifest row, so a local skill never marks a registry one', () => {
    const index = buildInstalledIndex([entry({ source: null })]);

    expect(installedScopesFor(index, item({}))).toEqual([]);
  });

  it('returns the same empty array for every unmatched row', () => {
    const index = buildInstalledIndex([]);

    expect(installedScopesFor(index, item({}))).toBe(installedScopesFor(index, item({ skillId: 'other' })));
  });
});
