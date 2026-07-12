import { describe, it, expect, vi, beforeEach } from 'vitest';

// GitService now shells out through the execGit primitive; mock that instead of
// the former git-wrapper library. Each test drives execGit by dispatching on the
// git subcommand, so the behavioral assertions on GitService's return values are
// unchanged; the call-verification assertions target the exact git argv issued.
vi.mock('../../git/git-exec.js', () => ({ execGit: vi.fn() }));

const { execGit } = await import('../../git/git-exec.js');
const { GitService } = await import('../../git/git-service.js');

const mockExec = vi.mocked(execGit);
const PATH = '/fake/path';

describe('GitService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('branches()', () => {
    it('returns structured branch list', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* main\n  feat/foo\n  remotes/origin/main\n  remotes/origin/feat/foo\n';
        if (args[0] === 'worktree') return '';
        return 'origin/main\n';
      });

      const svc = GitService.forProject(PATH);
      const result = await svc.branches();

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(2);
      expect(result.remote).toContain('origin/main');
      expect(result.worktrees).toEqual([]);
    });

    it('filters out remote HEAD pseudo-refs', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch')
          return '* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n  remotes/origin/feat/bar\n';
        if (args[0] === 'worktree') return '';
        return 'origin/main\n';
      });

      const svc = GitService.forProject(PATH);
      const result = await svc.branches();

      expect(result.remote).toEqual(['origin/main', 'origin/feat/bar']);
      expect(result.remote).not.toContainEqual(expect.stringContaining('HEAD'));
    });

    it('tags branches with their worktree directory name', async () => {
      const worktreeList = [
        'worktree /project',
        'HEAD aaa',
        'branch refs/heads/main',
        '',
        'worktree /project/.worktrees/my-feature',
        'HEAD bbb',
        'branch refs/heads/session/abc123',
        '',
      ].join('\n');
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* main\n  session/abc123\n';
        if (args[0] === 'worktree') return worktreeList;
        return 'origin/main\n';
      });

      const svc = GitService.forProject(PATH);
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
      mockExec.mockImplementation(async (args) => (args[0] === 'branch' ? '* feat/test\n' : ''));
      const svc = GitService.forProject(PATH);
      expect(await svc.currentBranch()).toBe('feat/test');
    });
  });

  describe('checkout()', () => {
    it('calls git checkout for a local branch', async () => {
      mockExec.mockResolvedValue('');
      const svc = GitService.forProject(PATH);
      await svc.checkout('main');
      expect(mockExec).toHaveBeenCalledWith(['checkout', 'main'], PATH, undefined);
    });

    it('creates tracking branch when checking out a remote ref', async () => {
      mockExec.mockImplementation(async (args) => (args[0] === 'remote' ? 'origin\n' : ''));
      const svc = GitService.forProject(PATH);
      await svc.checkout('origin/feat/bar');
      expect(mockExec).toHaveBeenCalledWith(
        ['checkout', '-b', 'feat/bar', 'origin/feat/bar', '--track'],
        PATH,
        undefined,
      );
    });

    it('does not create tracking branch for non-remote slash branch', async () => {
      mockExec.mockImplementation(async (args) => (args[0] === 'remote' ? 'origin\n' : ''));
      const svc = GitService.forProject(PATH);
      await svc.checkout('feat/foo');
      expect(mockExec).toHaveBeenCalledWith(['checkout', 'feat/foo'], PATH, undefined);
    });

    it('falls back to plain checkout when local branch already exists for remote ref', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'remote') return 'origin\n';
        if (args[1] === '-b') throw new Error("A branch named 'feat/bar' already exists");
        return '';
      });
      const svc = GitService.forProject(PATH);
      await svc.checkout('origin/feat/bar');
      expect(mockExec).toHaveBeenCalledWith(
        ['checkout', '-b', 'feat/bar', 'origin/feat/bar', '--track'],
        PATH,
        undefined,
      );
      expect(mockExec).toHaveBeenCalledWith(['checkout', 'feat/bar'], PATH, undefined);
    });

    it('re-throws non-exists errors when checking out remote ref', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'remote') return 'origin\n';
        if (args[1] === '-b') throw new Error('fatal: invalid reference: origin/bad-ref');
        return '';
      });
      const svc = GitService.forProject(PATH);
      await expect(svc.checkout('origin/bad-ref')).rejects.toThrow('invalid reference');
      const checkoutCalls = mockExec.mock.calls.filter((c) => c[0][0] === 'checkout');
      expect(checkoutCalls).toHaveLength(1);
    });
  });

  describe('merge()', () => {
    it('returns success on clean merge', async () => {
      mockExec.mockResolvedValue(
        "Merge made by the 'ort' strategy.\n 3 files changed, 10 insertions(+), 2 deletions(-)\n",
      );
      const svc = GitService.forProject(PATH);
      const result = await svc.merge('feat/foo');
      expect(result.status).toBe('success');
    });

    it('returns conflict on merge failure', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'merge') throw new Error('CONFLICTS');
        if (args[0] === 'diff') return 'src/index.ts\nsrc/app.ts\n';
        return '';
      });
      const svc = GitService.forProject(PATH);
      const result = await svc.merge('feat/foo');
      expect(result.status).toBe('conflict');
      if (result.status === 'conflict') {
        expect(result.conflicts).toContain('src/index.ts');
      }
    });
  });

  describe('push()', () => {
    it('returns success with matching local/remote branch', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* main\n';
        if (args[0] === 'rev-parse') return 'origin/main\n';
        return '';
      });
      const svc = GitService.forProject(PATH);
      const result = await svc.push();
      expect(result.status).toBe('success');
      expect(mockExec).toHaveBeenCalledWith(['push', 'origin', 'main:main'], PATH, { timeout: 0 });
    });

    it('uses correct refspec when remote branch name differs', async () => {
      mockExec.mockImplementation(async (args) => (args[0] === 'rev-parse' ? 'origin/session/imhoQVRy\n' : ''));
      const svc = GitService.forProject(PATH);
      const result = await svc.push('session/imhoQVRy-2');
      expect(result.status).toBe('success');
      expect(mockExec).toHaveBeenCalledWith(['push', 'origin', 'session/imhoQVRy-2:session/imhoQVRy'], PATH, {
        timeout: 0,
      });
    });

    it('falls back to local branch name when no upstream configured', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* new-branch\n';
        if (args[0] === 'rev-parse') throw new Error('no upstream');
        return '';
      });
      const svc = GitService.forProject(PATH);
      const result = await svc.push();
      expect(result.status).toBe('success');
      expect(mockExec).toHaveBeenCalledWith(['push', 'origin', 'new-branch:new-branch'], PATH, { timeout: 0 });
    });
  });

  describe('pull()', () => {
    it('uses fetch refspec for non-current branch', async () => {
      let revParse = 0;
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* main\n';
        if (args[0] === 'rev-parse') return revParse++ === 0 ? 'aaa\n' : 'bbb\n';
        return '';
      });
      const svc = GitService.forProject(PATH);
      const result = await svc.pull('origin', 'feat/foo', 'feat/foo');
      expect(mockExec).toHaveBeenCalledWith(['fetch', 'origin', 'feat/foo:feat/foo'], PATH, { timeout: 0 });
      expect(result.status).toBe('success');
    });

    it('returns up-to-date when non-current branch ref unchanged', async () => {
      mockExec.mockImplementation(async (args) => {
        if (args[0] === 'branch') return '* main\n';
        if (args[0] === 'rev-parse') return 'aaa\n';
        return '';
      });
      const svc = GitService.forProject(PATH);
      const result = await svc.pull('origin', 'feat/foo', 'feat/foo');
      expect(result.status).toBe('up-to-date');
    });
  });

  describe('deleteBranch()', () => {
    it('returns success', async () => {
      mockExec.mockResolvedValue('Deleted branch feat/old (was abc123).\n');
      const svc = GitService.forProject(PATH);
      const result = await svc.deleteBranch('feat/old');
      expect(result.status).toBe('success');
    });
  });

  describe('abort()', () => {
    it('returns aborted:false when no merge or rebase is active', async () => {
      mockExec.mockResolvedValue('/fake/path/.git\n');
      const svc = GitService.forProject(PATH);
      const result = await svc.abort();
      expect(result).toEqual({ aborted: false });
    });
  });

  describe('detectBaseBranch()', () => {
    beforeEach(() => {
      // Reset implementation (not just calls) so prior tests' mockResolvedValue don't bleed in.
      mockExec.mockReset();
    });

    it('returns main branch when main has a merge-base with HEAD', async () => {
      mockExec.mockResolvedValueOnce('abc123\n'); // merge-base main HEAD succeeds

      const svc = GitService.forProject(PATH);
      const result = await svc.detectBaseBranch();

      expect(result).toEqual({ baseBranch: 'main', mergeBase: 'abc123' });
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(['merge-base', 'main', 'HEAD'], PATH, undefined);
    });

    it('falls back to master when main has no merge-base', async () => {
      mockExec
        .mockRejectedValueOnce(new Error('no common ancestor')) // main fails
        .mockResolvedValueOnce('def456\n'); // master succeeds

      const svc = GitService.forProject(PATH);
      const result = await svc.detectBaseBranch();

      expect(result).toEqual({ baseBranch: 'master', mergeBase: 'def456' });
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec).toHaveBeenNthCalledWith(1, ['merge-base', 'main', 'HEAD'], PATH, undefined);
      expect(mockExec).toHaveBeenNthCalledWith(2, ['merge-base', 'master', 'HEAD'], PATH, undefined);
    });

    it('returns null when neither main nor master has a merge-base', async () => {
      mockExec
        .mockRejectedValueOnce(new Error('no common ancestor')) // main fails
        .mockRejectedValueOnce(new Error('no common ancestor')); // master fails

      const svc = GitService.forProject(PATH);
      const result = await svc.detectBaseBranch();

      expect(result).toBeNull();
    });

    it('prefers main over master (main wins when both would resolve)', async () => {
      // Both would succeed, but main is checked first and short-circuits
      mockExec
        .mockResolvedValueOnce('sha999\n') // main succeeds
        .mockResolvedValueOnce('sha111\n'); // master (never reached)

      const svc = GitService.forProject(PATH);
      const result = await svc.detectBaseBranch();

      expect(result).toEqual({ baseBranch: 'main', mergeBase: 'sha999' });
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });
});
