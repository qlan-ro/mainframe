import { describe, it, expect, vi } from 'vitest';
import { makeSpoolValidator } from '../spool-validator.js';

describe('makeSpoolValidator (linux)', () => {
  const realpath = vi.fn(async (p: string) => p);
  const v = makeSpoolValidator({
    platform: 'linux',
    getuid: () => 501,
    env: {},
    realpath,
  });

  it('accepts a well-formed spool path', async () => {
    realpath.mockImplementation(async (p) => p);
    const ok = await v('/tmp/claude-501/project-slug/session-abc/tasks/task-xyz.output', 'task-xyz');
    expect(ok).toBe(true);
  });

  it('rejects basename mismatch (taskId does not match filename)', async () => {
    const ok = await v('/tmp/claude-501/project-slug/session-abc/tasks/other.output', 'task-xyz');
    expect(ok).toBe(false);
  });

  it('rejects path outside spool root (traversal attempt)', async () => {
    const ok = await v('/etc/passwd', 'task-xyz');
    expect(ok).toBe(false);
  });

  it('rejects path missing /tasks/ segment', async () => {
    const ok = await v('/tmp/claude-501/project-slug/session-abc/task-xyz.output', 'task-xyz');
    expect(ok).toBe(false);
  });

  it('rejects when realpath escapes the root (symlink to elsewhere)', async () => {
    realpath.mockImplementation(async (p) => {
      if (p === '/tmp/claude-501/project/s/tasks/task-xyz.output') return '/etc/passwd';
      return p;
    });
    const ok = await v('/tmp/claude-501/project/s/tasks/task-xyz.output', 'task-xyz');
    expect(ok).toBe(false);
  });
});

describe('makeSpoolValidator (macos /private/tmp symlink)', () => {
  it('accepts when /tmp realpaths to /private/tmp', async () => {
    const realpath = vi.fn(async (p: string) => p.replace(/^\/tmp/, '/private/tmp'));
    const v = makeSpoolValidator({ platform: 'darwin', getuid: () => 501, env: {}, realpath });
    const ok = await v('/private/tmp/claude-501/p/s/tasks/task-xyz.output', 'task-xyz');
    expect(ok).toBe(true);
  });
});

describe('makeSpoolValidator (windows)', () => {
  const realpath = vi.fn(async (p: string) => p);
  const tmpdir = 'C:\\Users\\me\\AppData\\Local\\Temp';
  const v = makeSpoolValidator({
    platform: 'win32',
    getuid: undefined,
    env: {},
    tmpdir: () => tmpdir,
    realpath,
  });

  it('uses claude (no uid suffix) as the dir name', async () => {
    const ok = await v(`${tmpdir}\\claude\\proj\\sess\\tasks\\task-xyz.output`, 'task-xyz');
    expect(ok).toBe(true);
  });

  it('rejects a unix-style claude-501 path on windows', async () => {
    const ok = await v(`${tmpdir}\\claude-501\\proj\\sess\\tasks\\task-xyz.output`, 'task-xyz');
    expect(ok).toBe(false);
  });
});

describe('makeSpoolValidator (CLAUDE_CODE_TMPDIR override)', () => {
  it('honors CLAUDE_CODE_TMPDIR env var', async () => {
    const realpath = vi.fn(async (p: string) => p);
    const v = makeSpoolValidator({
      platform: 'linux',
      getuid: () => 501,
      env: { CLAUDE_CODE_TMPDIR: '/var/cache' },
      realpath,
    });
    const ok = await v('/var/cache/claude-501/p/s/tasks/task-xyz.output', 'task-xyz');
    expect(ok).toBe(true);
  });
});
