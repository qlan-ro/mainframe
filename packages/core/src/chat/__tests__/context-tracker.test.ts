import { describe, it, expect } from 'vitest';
import type { ContextFile, SkillFileEntry } from '@qlan-ro/mainframe-types';
import { dedupeSkillFiles, dedupeContextFiles, getSessionContext } from '../context-tracker.js';

describe('dedupeSkillFiles', () => {
  const plugin = '/home/me/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md';
  const fallback = '/home/me/.claude/skills/tdd/SKILL.md';

  it('drops the conventional fallback stub when the real skill path exists', () => {
    const skills: SkillFileEntry[] = [
      { path: plugin, displayName: 'tdd' },
      { path: fallback, displayName: 'tdd' },
      { path: '/home/me/.claude/skills/verify/SKILL.md', displayName: 'verify' },
    ];
    // Only the real plugin path (and verify) exist on disk; the fallback stub doesn't.
    const exists = (p: string) => p === plugin || p.endsWith('verify/SKILL.md');
    expect(dedupeSkillFiles(skills, exists)).toEqual([
      { path: plugin, displayName: 'tdd' },
      { path: '/home/me/.claude/skills/verify/SKILL.md', displayName: 'verify' },
    ]);
  });

  it('keeps the real path even when the non-existent fallback is listed first', () => {
    const skills: SkillFileEntry[] = [
      { path: fallback, displayName: 'tdd' },
      { path: plugin, displayName: 'tdd' },
    ];
    const exists = (p: string) => p === plugin;
    expect(dedupeSkillFiles(skills, exists)).toEqual([{ path: plugin, displayName: 'tdd' }]);
  });

  it('keeps two distinct real skills that happen to share a leaf name', () => {
    const personal = '/home/me/.claude/skills/tdd/SKILL.md';
    const skills: SkillFileEntry[] = [
      { path: personal, displayName: 'tdd' },
      { path: plugin, displayName: 'tdd' },
    ];
    const exists = () => true; // both are real skill files on disk
    expect(dedupeSkillFiles(skills, exists)).toEqual([
      { path: personal, displayName: 'tdd' },
      { path: plugin, displayName: 'tdd' },
    ]);
  });

  it('surfaces the name once when no candidate exists on disk (all fallbacks)', () => {
    const skills: SkillFileEntry[] = [
      { path: plugin, displayName: 'tdd' },
      { path: fallback, displayName: 'tdd' },
    ];
    const exists = () => false;
    expect(dedupeSkillFiles(skills, exists)).toEqual([{ path: plugin, displayName: 'tdd' }]);
  });

  it('removes exact-path repeats regardless of on-disk state', () => {
    const skills: SkillFileEntry[] = [
      { path: plugin, displayName: 'tdd' },
      { path: plugin, displayName: 'tdd' },
    ];
    expect(dedupeSkillFiles(skills, () => true)).toEqual([{ path: plugin, displayName: 'tdd' }]);
  });
});

describe('dedupeContextFiles', () => {
  const home = '/home/me';

  it('drops a project file that points at the same physical file as a global one', () => {
    const global: ContextFile[] = [{ path: '~/.claude/CLAUDE.md', content: 'g', source: 'global' }];
    // Project opened at the home dir: its .claude/CLAUDE.md IS the global file.
    const project: ContextFile[] = [{ path: '.claude/CLAUDE.md', content: 'g', source: 'project' }];

    const result = dedupeContextFiles(global, project, home, home);

    expect(result.global).toEqual(global);
    expect(result.project).toEqual([]);
  });

  it('keeps distinct project files and removes only exact within-list path repeats', () => {
    const global: ContextFile[] = [];
    const project: ContextFile[] = [
      { path: 'CLAUDE.md', content: 'a', source: 'project' },
      { path: 'CLAUDE.md', content: 'a', source: 'project' },
      { path: '.claude/AGENTS.md', content: 'b', source: 'project' },
    ];

    const result = dedupeContextFiles(global, project, '/proj', home);

    expect(result.project).toEqual([
      { path: 'CLAUDE.md', content: 'a', source: 'project' },
      { path: '.claude/AGENTS.md', content: 'b', source: 'project' },
    ]);
  });
});

describe('getSessionContext', () => {
  function makeDeps(skillFiles: SkillFileEntry[], contextFiles: { global: ContextFile[]; project: ContextFile[] }) {
    const db = {
      chats: {
        getMentions: () => [],
        getPlanFiles: () => [],
        getSkillFiles: () => skillFiles,
      },
    } as any;
    const adapters = {
      get: () => ({ getContextFiles: () => contextFiles }),
    } as any;
    return { db, adapters };
  }

  it('returns deduped skill files and drops project files that duplicate a global one', async () => {
    const home = process.env.HOME ?? '/home/me';
    // Skill paths under a root that cannot exist on any machine, so the on-disk
    // dedup is deterministic (neither resolves → the first is kept).
    const skillRoot = '/mf-nonexistent-test-root/.claude';
    const { db, adapters } = makeDeps(
      [
        { path: `${skillRoot}/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md`, displayName: 'tdd' },
        { path: `${skillRoot}/skills/tdd/SKILL.md`, displayName: 'tdd' },
      ],
      {
        global: [{ path: '~/.claude/CLAUDE.md', content: 'g', source: 'global' }],
        project: [{ path: '.claude/CLAUDE.md', content: 'g', source: 'project' }],
      },
    );

    const ctx = await getSessionContext(
      'chat-1',
      home, // project opened at home → its .claude/CLAUDE.md is the global file
      db,
      adapters,
      undefined,
      undefined,
      'claude',
    );

    expect(ctx.skillFiles).toEqual([
      { path: `${skillRoot}/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md`, displayName: 'tdd' },
    ]);
    expect(ctx.globalFiles).toHaveLength(1);
    expect(ctx.projectFiles).toEqual([]);
  });
});
