import { describe, it, expect } from 'vitest';
import { resolveCwd } from '../terminal-cwd.js';

describe('resolveCwd', () => {
  const homedir = '/Users/testuser';

  it('uses worktreePath when present', () => {
    expect(resolveCwd({ worktreePath: '/repos/project/worktrees/feat', projectPath: '/repos/project', homedir })).toBe(
      '/repos/project/worktrees/feat',
    );
  });

  it('uses projectPath when worktreePath is absent', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: '/repos/project', homedir })).toBe('/repos/project');
  });

  it('falls back to homedir when both worktreePath and projectPath are absent', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: undefined, homedir })).toBe('/Users/testuser');
  });

  it('falls back to homedir when projectPath is an empty string', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: '', homedir })).toBe('/Users/testuser');
  });

  it('falls back to homedir when projectPath is whitespace only', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: '   ', homedir })).toBe('/Users/testuser');
  });

  it('falls back to homedir when worktreePath is an empty string', () => {
    expect(resolveCwd({ worktreePath: '', projectPath: '/repos/project', homedir })).toBe('/repos/project');
  });

  it('never returns / regardless of inputs', () => {
    const result = resolveCwd({ worktreePath: undefined, projectPath: undefined, homedir: '/Users/testuser' });
    expect(result).not.toBe('/');
  });
});
