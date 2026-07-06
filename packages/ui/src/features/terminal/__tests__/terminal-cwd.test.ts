import { afterEach, describe, expect, it } from 'vitest';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { resolveCwd } from '../terminal-cwd';

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local' as const,
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
};
const REMOTE_DAEMON = {
  id: 'ssh-1',
  kind: 'remote' as const,
  label: 'Remote',
  baseUrl: 'https://tunnel.example.com',
  token: 'jwt-abc',
};

describe('resolveCwd', () => {
  const homedir = '/Users/me';

  afterEach(() => {
    setActiveDaemon(LOCAL_DAEMON);
  });

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

  describe('remote daemon', () => {
    it('returns homedir when active daemon is remote and worktreePath is set', () => {
      setActiveDaemon(REMOTE_DAEMON);
      expect(resolveCwd({ worktreePath: '/srv/agent/x', projectPath: '/srv/project', homedir })).toBe(homedir);
    });

    it('returns homedir when active daemon is remote and only projectPath is set', () => {
      setActiveDaemon(REMOTE_DAEMON);
      expect(resolveCwd({ worktreePath: undefined, projectPath: '/srv/project', homedir })).toBe(homedir);
    });

    it('returns worktreePath normally when active daemon is local', () => {
      setActiveDaemon(LOCAL_DAEMON);
      expect(resolveCwd({ worktreePath: '/srv/agent/x', projectPath: '/srv/project', homedir })).toBe('/srv/agent/x');
    });
  });
});
