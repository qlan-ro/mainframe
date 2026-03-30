import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGit = {
  branch: vi.fn(),
  status: vi.fn(),
  diff: vi.fn(),
  checkout: vi.fn(),
  checkoutLocalBranch: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  merge: vi.fn(),
  rebase: vi.fn(),
  raw: vi.fn(),
  deleteLocalBranch: vi.fn(),
  getRemotes: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

const { GitService } = await import('../../git/git-service.js');

describe('GitService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('branches()', () => {
    it('returns structured branch list', async () => {
      mockGit.branch.mockResolvedValue({
        current: 'main',
        all: ['main', 'feat/foo', 'remotes/origin/main', 'remotes/origin/feat/foo'],
        branches: {
          main: { current: true, name: 'main', linkedWorkTree: false, label: '' },
          'feat/foo': { current: false, name: 'feat/foo', linkedWorkTree: false, label: '' },
          'remotes/origin/main': { current: false, name: 'remotes/origin/main', linkedWorkTree: false, label: '' },
          'remotes/origin/feat/foo': {
            current: false,
            name: 'remotes/origin/feat/foo',
            linkedWorkTree: false,
            label: '',
          },
        },
      });
      mockGit.raw
        .mockResolvedValueOnce('') // worktree list
        .mockResolvedValue('origin/main\n');

      const svc = GitService.forProject('/fake/path');
      const result = await svc.branches();

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(2);
      expect(result.remote).toContain('origin/main');
      expect(result.worktrees).toEqual([]);
    });

    it('filters out remote HEAD pseudo-refs', async () => {
      mockGit.branch.mockResolvedValue({
        current: 'main',
        all: ['main', 'remotes/origin/HEAD -> origin/main', 'remotes/origin/main', 'remotes/origin/feat/bar'],
        branches: {},
      });
      mockGit.raw
        .mockResolvedValueOnce('') // worktree list
        .mockResolvedValue('origin/main\n');

      const svc = GitService.forProject('/fake/path');
      const result = await svc.branches();

      expect(result.remote).toEqual(['origin/main', 'origin/feat/bar']);
      expect(result.remote).not.toContainEqual(expect.stringContaining('HEAD'));
    });

    it('tags branches with their worktree directory name', async () => {
      mockGit.branch.mockResolvedValue({
        current: 'main',
        all: ['main', 'session/abc123'],
        branches: {},
      });
      mockGit.raw
        .mockResolvedValueOnce(
          [
            'worktree /project',
            'HEAD aaa',
            'branch refs/heads/main',
            '',
            'worktree /project/.worktrees/my-feature',
            'HEAD bbb',
            'branch refs/heads/session/abc123',
            '',
          ].join('\n'),
        )
        .mockResolvedValue('origin/main\n');

      const svc = GitService.forProject('/fake/path');
      const result = await svc.branches();

      expect(result.worktrees).toEqual(['my-feature']);
      const wtBranch = result.local.find((b) => b.name === 'session/abc123');
      expect(wtBranch?.worktree).toBe('my-feature');
      const mainBranch = result.local.find((b) => b.name === 'main');
      expect(mainBranch?.worktree).toBeUndefined();
    });
  });

  describe('currentBranch()', () => {
    it('returns current branch name', async () => {
      mockGit.branch.mockResolvedValue({ current: 'feat/test' });
      const svc = GitService.forProject('/fake/path');
      expect(await svc.currentBranch()).toBe('feat/test');
    });
  });

  describe('checkout()', () => {
    it('calls git checkout for a local branch', async () => {
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin' }]);
      const svc = GitService.forProject('/fake/path');
      await svc.checkout('main');
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
    });

    it('creates tracking branch when checking out a remote ref', async () => {
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin' }]);
      const svc = GitService.forProject('/fake/path');
      await svc.checkout('origin/feat/bar');
      expect(mockGit.checkout).toHaveBeenCalledWith(['-b', 'feat/bar', 'origin/feat/bar', '--track']);
    });

    it('does not create tracking branch for non-remote slash branch', async () => {
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin' }]);
      const svc = GitService.forProject('/fake/path');
      await svc.checkout('feat/foo');
      expect(mockGit.checkout).toHaveBeenCalledWith('feat/foo');
    });

    it('falls back to plain checkout when local branch already exists for remote ref', async () => {
      const err = new Error("A branch named 'feat/bar' already exists");
      mockGit.checkout.mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin' }]);
      const svc = GitService.forProject('/fake/path');
      await svc.checkout('origin/feat/bar');
      expect(mockGit.checkout).toHaveBeenCalledTimes(2);
      expect(mockGit.checkout).toHaveBeenNthCalledWith(1, ['-b', 'feat/bar', 'origin/feat/bar', '--track']);
      expect(mockGit.checkout).toHaveBeenNthCalledWith(2, 'feat/bar');
    });
  });

  describe('merge()', () => {
    it('returns success on clean merge', async () => {
      mockGit.merge.mockResolvedValue({
        merges: [],
        result: 'success',
        summary: { changes: 3, insertions: 10, deletions: 2 },
      });
      const svc = GitService.forProject('/fake/path');
      const result = await svc.merge('feat/foo');
      expect(result.status).toBe('success');
    });

    it('returns conflict on merge failure', async () => {
      const err = new Error('CONFLICTS');
      (err as any).git = {
        conflicts: ['src/index.ts', 'src/app.ts'],
        merges: [],
        result: 'CONFLICTS',
      };
      mockGit.merge.mockRejectedValue(err);
      const svc = GitService.forProject('/fake/path');
      const result = await svc.merge('feat/foo');
      expect(result.status).toBe('conflict');
      if (result.status === 'conflict') {
        expect(result.conflicts).toContain('src/index.ts');
      }
    });
  });

  describe('push()', () => {
    it('returns success with matching local/remote branch', async () => {
      mockGit.push.mockResolvedValue({ pushed: [{}] });
      mockGit.branch.mockResolvedValue({ current: 'main' });
      mockGit.raw.mockResolvedValue('origin/main\n');
      const svc = GitService.forProject('/fake/path');
      const result = await svc.push();
      expect(result.status).toBe('success');
      expect(mockGit.push).toHaveBeenCalledWith('origin', 'main:main');
    });

    it('uses correct refspec when remote branch name differs', async () => {
      mockGit.push.mockResolvedValue({ pushed: [{}] });
      mockGit.raw.mockResolvedValue('origin/session/imhoQVRy\n');
      const svc = GitService.forProject('/fake/path');
      const result = await svc.push('session/imhoQVRy-2');
      expect(result.status).toBe('success');
      expect(mockGit.push).toHaveBeenCalledWith('origin', 'session/imhoQVRy-2:session/imhoQVRy');
    });

    it('falls back to local branch name when no upstream configured', async () => {
      mockGit.push.mockResolvedValue({ pushed: [{}] });
      mockGit.branch.mockResolvedValue({ current: 'new-branch' });
      mockGit.raw.mockRejectedValue(new Error('no upstream'));
      const svc = GitService.forProject('/fake/path');
      const result = await svc.push();
      expect(result.status).toBe('success');
      expect(mockGit.push).toHaveBeenCalledWith('origin', 'new-branch:new-branch');
    });
  });

  describe('deleteBranch()', () => {
    it('returns success', async () => {
      mockGit.deleteLocalBranch.mockResolvedValue({ branch: 'feat/old', success: true });
      const svc = GitService.forProject('/fake/path');
      const result = await svc.deleteBranch('feat/old');
      expect(result.status).toBe('success');
    });
  });

  describe('abort()', () => {
    it('returns aborted:false when no merge or rebase is active', async () => {
      const svc = GitService.forProject('/fake/path');
      const result = await svc.abort();
      expect(result).toEqual({ aborted: false });
    });
  });
});
