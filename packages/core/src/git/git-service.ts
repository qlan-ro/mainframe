import { simpleGit } from 'simple-git';
import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createChildLogger } from '../logger.js';
import { acquireProjectLock } from './project-lock.js';
import { parseWorktreeList } from '../workspace/worktree.js';
import type {
  BranchListResult,
  BranchInfo,
  FetchResult,
  PullResult,
  PushResult,
  MergeResult,
  RebaseResult,
  DeleteBranchResult,
  UpdateAllResult,
} from '@qlan-ro/mainframe-types';

const logger = createChildLogger('git-service');

export class GitService {
  private constructor(private readonly projectPath: string) {}

  static forProject(projectPath: string): GitService {
    return new GitService(projectPath);
  }

  private git() {
    return simpleGit(this.projectPath);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await acquireProjectLock(this.projectPath);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async currentBranch(): Promise<string> {
    const result = await this.git().branch();
    return result.current;
  }

  async statusRaw(): Promise<string> {
    return this.git().raw(['status', '--porcelain']);
  }

  async status(): Promise<{ conflicted: string[]; files: { path: string; index: string; working_dir: string }[] }> {
    const result = await this.git().status();
    return { conflicted: result.conflicted, files: result.files };
  }

  async branches(): Promise<BranchListResult> {
    const result = await this.git().branch(['-a']);
    const local: BranchInfo[] = [];
    const remote: string[] = [];

    // Build branch → worktree dirname map from `git worktree list`
    const branchToWorktree = new Map<string, string>();
    const worktreeNames: string[] = [];
    try {
      const wtOutput = await this.git().raw(['worktree', 'list', '--porcelain']);
      const entries = parseWorktreeList(wtOutput);
      for (const entry of entries) {
        // Skip the main worktree (the project directory itself — always first entry)
        if (entry === entries[0]) continue;
        if (!entry.branch) continue;
        const branchName = entry.branch.replace(/^refs\/heads\//, '');
        const dirName = basename(entry.path);
        branchToWorktree.set(branchName, dirName);
        if (!worktreeNames.includes(dirName)) worktreeNames.push(dirName);
      }
    } catch {
      // Not a git repo or worktree command unavailable — proceed without worktree info
    }

    for (const name of result.all) {
      if (name.startsWith('remotes/')) {
        const remoteName = name.replace(/^remotes\//, '');
        remote.push(remoteName);
      } else {
        let tracking: string | undefined;
        try {
          const upstream = (await this.git().raw(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])).trim();
          if (upstream && upstream !== '') tracking = upstream;
        } catch {
          // No tracking branch — expected for local-only branches
        }
        local.push({ name, current: name === result.current, tracking, worktree: branchToWorktree.get(name) });
      }
    }

    return { current: result.current, local, remote, worktrees: worktreeNames };
  }

  async diff(args: string[]): Promise<string> {
    return this.git().raw(['diff', ...args]);
  }

  async show(ref: string): Promise<string> {
    return this.git().raw(['show', ref]);
  }

  async mergeBase(branch1: string, branch2: string): Promise<string | null> {
    try {
      return (await this.git().raw(['merge-base', branch1, branch2])).trim();
    } catch {
      /* expected — branches may share no common ancestor */
      return null;
    }
  }

  async checkout(branch: string): Promise<void> {
    return this.withLock(async () => {
      // If it looks like a remote ref (e.g. "origin/feat/foo"), strip the
      // remote name and checkout the local name so git creates a tracking branch.
      // The regex matches any "X/Y" — we verify X is an actual remote below
      // to avoid false positives on branches like "feat/foo".
      const remoteRefMatch = branch.match(/^([^/]+)\/(.+)$/);
      if (remoteRefMatch) {
        const [, remote, localName] = remoteRefMatch;
        const remotes = await this.git().getRemotes();
        if (remotes.some((r) => r.name === remote)) {
          try {
            await this.git().checkout(['-b', localName!, `${branch}`, '--track']);
          } catch {
            // Local branch already exists — just switch to it
            await this.git().checkout(localName!);
          }
          return;
        }
      }
      await this.git().checkout(branch);
    });
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    return this.withLock(async () => {
      if (startPoint) {
        await this.git().raw(['checkout', '-b', name, startPoint]);
      } else {
        await this.git().checkoutLocalBranch(name);
      }
    });
  }

  async fetch(remote?: string): Promise<FetchResult> {
    return this.withLock(async () => {
      if (remote) {
        await this.git().fetch(remote, { '--prune': null });
      } else {
        await this.git().fetch(['--all', '--prune']);
      }
      return { status: 'success', remote: remote ?? 'all' };
    });
  }

  async pull(remote?: string, branch?: string): Promise<PullResult> {
    return this.withLock(async () => {
      try {
        const result = await this.git().pull(remote, branch);
        if (result.summary.changes === 0 && result.summary.insertions === 0 && result.summary.deletions === 0) {
          return { status: 'up-to-date' };
        }
        return {
          status: 'success',
          summary: {
            changes: result.summary.changes,
            insertions: result.summary.insertions,
            deletions: result.summary.deletions,
          },
        };
      } catch (err: any) {
        if (err?.git?.conflicts?.length > 0) {
          return { status: 'conflict', conflicts: err.git.conflicts, message: err.message };
        }
        throw err;
      }
    });
  }

  async push(branch?: string, remote?: string): Promise<PushResult> {
    return this.withLock(async () => {
      try {
        const currentBranch = branch ?? (await this.git().branch()).current;
        const pushRemote = remote ?? 'origin';

        // Look up the tracking branch to build a correct refspec when the
        // local and remote branch names differ.
        let remoteBranch = currentBranch;
        try {
          const upstream = (await this.git().raw(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`])).trim();
          if (upstream) {
            const idx = upstream.indexOf('/');
            if (idx > 0) remoteBranch = upstream.slice(idx + 1);
          }
        } catch {
          // No upstream configured — push local name (may create new remote branch)
        }

        await this.git().push(pushRemote, `${currentBranch}:${remoteBranch}`);
        return { status: 'success', branch: currentBranch, remote: pushRemote };
      } catch (err: any) {
        if (err?.message?.includes('non-fast-forward') || err?.message?.includes('rejected')) {
          return { status: 'rejected', message: err.message };
        }
        throw err;
      }
    });
  }

  async merge(branch: string): Promise<MergeResult> {
    return this.withLock(async () => {
      try {
        const result = await this.git().merge([branch]);
        return {
          status: 'success',
          summary: {
            commits: result.merges?.length ?? 0,
            insertions: result.summary?.insertions ?? 0,
            deletions: result.summary?.deletions ?? 0,
          },
        };
      } catch (err: any) {
        if (err?.git?.conflicts?.length > 0) {
          return { status: 'conflict', conflicts: err.git.conflicts, message: err.message };
        }
        throw err;
      }
    });
  }

  async rebase(branch: string): Promise<RebaseResult> {
    return this.withLock(async () => {
      try {
        await this.git().rebase([branch]);
        return { status: 'success' };
      } catch (err: any) {
        try {
          await access(join(this.projectPath, '.git', 'rebase-merge'));
          const statusResult = await this.git().status();
          return { status: 'conflict', conflicts: statusResult.conflicted, message: err.message };
        } catch {
          throw err;
        }
      }
    });
  }

  async abort(): Promise<void> {
    return this.withLock(async () => {
      try {
        await access(join(this.projectPath, '.git', 'MERGE_HEAD'));
        await this.git().merge(['--abort']);
        return;
      } catch {
        /* expected — probing whether a merge is in progress */
      }
      try {
        await access(join(this.projectPath, '.git', 'rebase-merge'));
        await this.git().rebase(['--abort']);
        return;
      } catch {
        /* expected — probing whether an interactive rebase is in progress */
      }
      try {
        await access(join(this.projectPath, '.git', 'rebase-apply'));
        await this.git().rebase(['--abort']);
        return;
      } catch {
        /* expected — no active merge or rebase to abort */
      }
    });
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    return this.withLock(async () => {
      await this.git().raw(['branch', '-m', oldName, newName]);
    });
  }

  async deleteBranch(name: string, force = false, isRemote = false): Promise<DeleteBranchResult> {
    return this.withLock(async () => {
      if (isRemote) {
        const remoteMatch = name.match(/^([^/]+)\/(.+)$/);
        if (!remoteMatch) throw new Error(`Invalid remote branch name: ${name}`);
        const [, remote, branchName] = remoteMatch;
        await this.git().raw(['push', remote!, '--delete', branchName!]);
        return { status: 'success' };
      }
      try {
        await this.git().deleteLocalBranch(name, force);
        return { status: 'success' };
      } catch (err: any) {
        if (err?.message?.includes('not fully merged')) {
          return { status: 'not-merged', message: err.message };
        }
        throw err;
      }
    });
  }

  async updateAll(): Promise<UpdateAllResult> {
    return this.withLock(async () => {
      let fetched = false;
      try {
        await this.git().fetch(['--all', '--prune']);
        fetched = true;
      } catch (err) {
        logger.warn({ err }, 'fetch --all failed during updateAll');
      }

      let pull: PullResult;
      try {
        const result = await this.git().pull();
        if (result.summary.changes === 0 && result.summary.insertions === 0 && result.summary.deletions === 0) {
          pull = { status: 'up-to-date' };
        } else {
          pull = {
            status: 'success',
            summary: {
              changes: result.summary.changes,
              insertions: result.summary.insertions,
              deletions: result.summary.deletions,
            },
          };
        }
      } catch (err: any) {
        if (err?.git?.conflicts?.length > 0) {
          pull = { status: 'conflict', conflicts: err.git.conflicts, message: err.message };
        } else {
          throw err;
        }
      }

      return { fetched, pull };
    });
  }
}
