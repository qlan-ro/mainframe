import { describe, expect, it } from 'vitest';
import { resolveCwd } from '../terminal-cwd';

describe('resolveCwd', () => {
  const homedir = '/Users/me';

  it('prefers worktreePath when set', () => {
    expect(resolveCwd({ worktreePath: '/wt', projectPath: '/proj', homedir })).toBe('/wt');
  });

  it('falls back to projectPath when no worktree', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: '/proj', homedir })).toBe('/proj');
  });

  it('falls back to homedir when no project is active', () => {
    expect(resolveCwd({ worktreePath: undefined, projectPath: undefined, homedir })).toBe(homedir);
  });

  it('treats whitespace-only paths as empty', () => {
    expect(resolveCwd({ worktreePath: '   ', projectPath: '/proj', homedir })).toBe('/proj');
  });

  it('trims the returned path', () => {
    expect(resolveCwd({ worktreePath: '  /wt  ', projectPath: undefined, homedir })).toBe('/wt');
  });
});
