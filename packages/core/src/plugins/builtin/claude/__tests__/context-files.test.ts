import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeContextFiles } from '../context-files.js';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('collectClaudeContextFiles', () => {
  it('reports the global CLAUDE.md as an absolute ~/.claude path the daemon can open', () => {
    const home = tmp('home-');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'global rules');

    const { global } = collectClaudeContextFiles(tmp('proj-'), home);

    expect(global).toEqual([{ path: join(home, '.claude', 'CLAUDE.md'), content: 'global rules', source: 'global' }]);
  });

  it('reports project files with project-relative paths (root and .claude/)', () => {
    const project = tmp('proj-');
    writeFileSync(join(project, 'CLAUDE.md'), 'root');
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(join(project, '.claude', 'AGENTS.md'), 'nested');

    const { project: files } = collectClaudeContextFiles(project, tmp('home-'));

    expect(files).toEqual([
      { path: 'CLAUDE.md', content: 'root', source: 'project' },
      { path: '.claude/AGENTS.md', content: 'nested', source: 'project' },
    ]);
  });

  it('omits files that do not exist', () => {
    const { global, project } = collectClaudeContextFiles(tmp('proj-'), tmp('home-'));
    expect(global).toEqual([]);
    expect(project).toEqual([]);
  });
});
