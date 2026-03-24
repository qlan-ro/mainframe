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
      mockGit.raw.mockResolvedValue('origin/main\n');

      const svc = GitService.forProject('/fake/path');
      const result = await svc.branches();

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(2);
      expect(result.remote).toContain('origin/main');
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
    it('calls git checkout', async () => {
      mockGit.checkout.mockResolvedValue(undefined);
      const svc = GitService.forProject('/fake/path');
      await svc.checkout('main');
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
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
    it('returns success', async () => {
      mockGit.push.mockResolvedValue({ pushed: [{}] });
      mockGit.branch.mockResolvedValue({ current: 'main' });
      const svc = GitService.forProject('/fake/path');
      const result = await svc.push();
      expect(result.status).toBe('success');
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
});
