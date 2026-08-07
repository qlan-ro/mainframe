import { describe, expect, it } from 'vitest';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { deriveContextFiles } from '../context-groups';

const context = (over: Partial<SessionContext> = {}): SessionContext => ({
  globalFiles: [],
  projectFiles: [],
  mentions: [],
  attachments: [],
  modifiedFiles: [],
  skillFiles: [],
  ...over,
});

describe('deriveContextFiles', () => {
  it('returns nothing for a null context', () => {
    expect(deriveContextFiles(null)).toEqual([]);
  });

  it('returns nothing when the payload carries no memory files', () => {
    expect(deriveContextFiles(context())).toEqual([]);
  });

  it('renders globals before project files', () => {
    const rows = deriveContextFiles(
      context({
        globalFiles: [{ path: '/Users/me/.claude/CLAUDE.md', content: 'x'.repeat(400), source: 'global' }],
        projectFiles: [{ path: 'CLAUDE.md', content: 'y'.repeat(800), source: 'project' }],
      }),
    );
    expect(rows).toEqual([
      { path: '/Users/me/.claude/CLAUDE.md', label: 'CLAUDE.md', scope: 'global', tokens: 100 },
      { path: 'CLAUDE.md', label: 'CLAUDE.md', scope: 'project', tokens: 200 },
    ]);
  });

  it('keeps the full payload path and labels with the basename', () => {
    const rows = deriveContextFiles(
      context({ projectFiles: [{ path: '.claude/AGENTS.md', content: '', source: 'project' }] }),
    );
    expect(rows[0]?.path).toBe('.claude/AGENTS.md');
    expect(rows[0]?.label).toBe('AGENTS.md');
    expect(rows[0]?.tokens).toBe(0);
  });

  it('emits a row per collected file — the daemon collects up to four', () => {
    const rows = deriveContextFiles(
      context({
        globalFiles: [
          { path: '/Users/me/CLAUDE.md', content: '', source: 'global' },
          { path: '/Users/me/.claude/AGENTS.md', content: '', source: 'global' },
        ],
        projectFiles: [
          { path: 'CLAUDE.md', content: '', source: 'project' },
          { path: '.claude/AGENTS.md', content: '', source: 'project' },
        ],
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(['CLAUDE.md', 'AGENTS.md', 'CLAUDE.md', 'AGENTS.md']);
    expect(rows.map((r) => r.scope)).toEqual(['global', 'global', 'project', 'project']);
  });
});
