import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/routes/exec-git.js', () => ({ execGit: vi.fn() }));
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return { ...actual, rm: vi.fn(async () => {}) };
});

import { execGit } from '../../server/routes/exec-git.js';
import { rm } from 'node:fs/promises';
import { removeWorktree } from '../../workspace/worktree.js';

const P = '/proj';
const W = '/proj/.worktrees/feat-x';
const B = 'feat/x';

beforeEach(() => vi.clearAllMocks());

describe('removeWorktree (async, non-blocking)', () => {
  it('returns a Promise (is async)', () => {
    vi.mocked(execGit).mockResolvedValue('');
    const r = removeWorktree(P, W, B);
    expect(typeof (r as Promise<void>).then).toBe('function');
    return r;
  });

  it('happy path: git worktree remove --force then branch -D, no rm/prune', async () => {
    vi.mocked(execGit).mockResolvedValue('');
    await removeWorktree(P, W, B);
    expect(vi.mocked(execGit)).toHaveBeenCalledWith(['worktree', 'remove', W, '--force'], P);
    expect(vi.mocked(execGit)).toHaveBeenCalledWith(['branch', '-D', B], P);
    expect(vi.mocked(execGit)).not.toHaveBeenCalledWith(['worktree', 'prune'], P);
    expect(vi.mocked(rm)).not.toHaveBeenCalled();
  });

  it('fallback: when remove fails, rm(recursive,force) + prune, then branch -D still attempted', async () => {
    vi.mocked(execGit).mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('locked');
      return '';
    });
    await removeWorktree(P, W, B);
    expect(vi.mocked(rm)).toHaveBeenCalledWith(W, { recursive: true, force: true });
    expect(vi.mocked(execGit)).toHaveBeenCalledWith(['worktree', 'prune'], P);
    expect(vi.mocked(execGit)).toHaveBeenCalledWith(['branch', '-D', B], P);
  });

  it('never rejects even if every git call and rm fail (best-effort)', async () => {
    vi.mocked(execGit).mockRejectedValue(new Error('boom'));
    vi.mocked(rm).mockRejectedValue(new Error('rm boom'));
    await expect(removeWorktree(P, W, B)).resolves.toBeUndefined();
  });

  it('does not block the event loop: a concurrently-scheduled task runs before it resolves', async () => {
    vi.mocked(execGit).mockResolvedValue('');
    const order: string[] = [];
    const p = removeWorktree(P, W, B).then(() => order.push('removeWorktree'));
    await Promise.resolve();
    order.push('concurrent');
    await p;
    expect(order).toEqual(['concurrent', 'removeWorktree']);
  });
});
