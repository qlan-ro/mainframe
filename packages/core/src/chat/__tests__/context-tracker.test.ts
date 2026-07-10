import { describe, it, expect } from 'vitest';
import type { ContextFile, SkillFileEntry } from '@qlan-ro/mainframe-types';
import { dedupeSkillFiles, dedupeContextFiles, getSessionContext } from '../context-tracker.js';

describe('dedupeSkillFiles', () => {
  it('collapses the same skill resolved to different paths into one entry', () => {
    const skills: SkillFileEntry[] = [
      { path: '/home/me/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md', displayName: 'tdd' },
      { path: '/home/me/.claude/skills/tdd/SKILL.md', displayName: 'tdd' },
      { path: '/home/me/.claude/skills/verify/SKILL.md', displayName: 'verify' },
    ];
    expect(dedupeSkillFiles(skills)).toEqual([
      { path: '/home/me/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md', displayName: 'tdd' },
      { path: '/home/me/.claude/skills/verify/SKILL.md', displayName: 'verify' },
    ]);
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
    const { db, adapters } = makeDeps(
      [
        { path: `${home}/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md`, displayName: 'tdd' },
        { path: `${home}/.claude/skills/tdd/SKILL.md`, displayName: 'tdd' },
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
      { path: `${home}/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md`, displayName: 'tdd' },
    ]);
    expect(ctx.globalFiles).toHaveLength(1);
    expect(ctx.projectFiles).toEqual([]);
  });
});
