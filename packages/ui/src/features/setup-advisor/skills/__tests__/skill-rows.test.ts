/**
 * skill-rows.test.ts
 *
 * The merge is where "is this installed?" is decided, and getting it wrong is
 * invisible in the UI: a mismatched row offers Install for something already on
 * disk, or spends the button on something that isn't. So the matching rule —
 * source *and* id, never the bare name — is pinned here rather than through a
 * render.
 */
import { describe, it, expect } from 'vitest';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { buildSkillRows } from '../skill-rows';
import type { BrowseItem } from '../use-skills-browse-store';

const PDF: BrowseItem = {
  source: 'anthropic/skills',
  skillId: 'pdf',
  name: 'PDF',
  installs: 2_800_000,
  isOfficial: true,
};
const ACME_PDF: BrowseItem = {
  source: 'acme/skills',
  skillId: 'pdf',
  name: 'Acme PDF',
  installs: 42,
  isOfficial: false,
};

function entry(overrides: Partial<SkillsCliEntry> & { name: string; scope: 'project' | 'global' }): SkillsCliEntry {
  return { source: 'anthropic/skills', sourceType: 'github', skillPath: null, ...overrides };
}

describe('buildSkillRows — matching', () => {
  it('marks the matching source/id pair installed and leaves the other source available', () => {
    const rows = buildSkillRows([entry({ name: 'pdf', scope: 'project' })], [PDF, ACME_PDF], '');

    expect(rows.installed.map((r) => r.key)).toEqual(['anthropic/skills/pdf']);
    expect(rows.available.map((r) => r.key)).toEqual(['acme/skills/pdf']);
  });

  it('does not match on the bare name across sources', () => {
    const rows = buildSkillRows([entry({ name: 'pdf', scope: 'project', source: 'someone/else' })], [PDF], '');

    expect(rows.installed.map((r) => r.key)).toEqual(['someone/else/pdf']);
    expect(rows.available.map((r) => r.key)).toEqual(['anthropic/skills/pdf']);
  });

  it('takes the display name and install count from the registry match', () => {
    const rows = buildSkillRows([entry({ name: 'pdf', scope: 'project' })], [PDF], '');

    expect(rows.installed[0]).toMatchObject({
      skillId: 'pdf',
      name: 'PDF',
      source: 'anthropic/skills',
      installs: 2_800_000,
      isOfficial: true,
    });
  });

  it('keeps the CLI name and no counts when the registry has never heard of it', () => {
    const rows = buildSkillRows([entry({ name: 'pdf', scope: 'project', source: 'private/repo' })], [], '');

    expect(rows.installed[0]).toMatchObject({ name: 'pdf', source: 'private/repo' });
    expect(rows.installed[0]?.installs).toBeUndefined();
  });
});

describe('buildSkillRows — scopes', () => {
  it('collapses the same skill in both scopes into one row carrying both', () => {
    const rows = buildSkillRows(
      [entry({ name: 'pdf', scope: 'project' }), entry({ name: 'pdf', scope: 'global' })],
      [PDF],
      '',
    );

    expect(rows.installed).toHaveLength(1);
    expect(rows.installed[0]?.scopes).toEqual(['project', 'global']);
  });

  it('gives an available row no scopes at all', () => {
    const rows = buildSkillRows([], [PDF], '');

    expect(rows.available[0]?.scopes).toEqual([]);
  });
});

describe('buildSkillRows — local skills', () => {
  it('keeps a source-less entry under its own key rather than claiming a registry row', () => {
    const local: SkillsCliEntry = { name: 'pdf', scope: 'project', source: null, sourceType: null, skillPath: null };

    const rows = buildSkillRows([local], [PDF], '');

    expect(rows.installed.map((r) => r.key)).toEqual(['local:pdf']);
    expect(rows.installed[0]?.source).toBeUndefined();
    expect(rows.available.map((r) => r.key)).toEqual(['anthropic/skills/pdf']);
  });
});

describe('buildSkillRows — query', () => {
  it('filters installed rows by name and by source, and leaves available untouched', () => {
    const entries = [
      entry({ name: 'pdf', scope: 'project' }),
      entry({ name: 'linter', scope: 'project', source: 'yaml/tools' }),
    ];

    expect(buildSkillRows(entries, [ACME_PDF], 'pdf').installed.map((r) => r.name)).toEqual(['pdf']);
    expect(buildSkillRows(entries, [ACME_PDF], 'yaml').installed.map((r) => r.name)).toEqual(['linter']);
    // `available` is whatever the registry returned for that query — the store
    // already asked the API, so re-filtering here would drop legitimate hits.
    expect(buildSkillRows(entries, [ACME_PDF], 'yaml').available.map((r) => r.key)).toEqual(['acme/skills/pdf']);
  });

  it('sorts installed rows by display name', () => {
    const entries = [
      entry({ name: 'zebra', scope: 'project' }),
      entry({ name: 'alpha', scope: 'project' }),
      entry({ name: 'middle', scope: 'global' }),
    ];

    expect(buildSkillRows(entries, [], '').installed.map((r) => r.name)).toEqual(['alpha', 'middle', 'zebra']);
  });
});
