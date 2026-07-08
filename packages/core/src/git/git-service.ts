import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createChildLogger } from '../logger.js';
import { acquireProjectLock } from './project-lock.js';
import { parseWorktreeList } from '../workspace/worktree.js';
import { execGit } from './git-exec.js';
// prettier-ignore
import {
  parseBranchList, parseRemotes, parseCommitHash, parseDiffStatSummary,
  parseStatusZ, countAutoMerges, type BranchList, type PorcelainStatus,
} from './git-parse.js';
import type {
  BranchListResult,
  BranchInfo,
  BranchUpdateStatus,
  FetchResult,
  PullResult,
  PushResult,
  MergeResult,
  RebaseResult,
  DeleteBranchResult,
  UpdateAllResult,
  WorkingStat,
  WorkingStatFile,
} from '@qlan-ro/mainframe-types';

const logger = createChildLogger('git-service');

/** Network/mutation ops may run past the read-command default timeout; leave uncapped. */
const NO_TIMEOUT = { timeout: 0 } as const;

export class GitService {
  private constructor(private readonly projectPath: string) {}

  static forProject(projectPath: string): GitService {
    return new GitService(projectPath);
  }

  private git(args: string[], opts?: { timeout?: number }): Promise<string> {
    return execGit(args, this.projectPath, opts);
  }

  private async branchInfo(all: boolean): Promise<BranchList> {
    return parseBranchList(await this.git(all ? ['branch', '--no-color', '-a'] : ['branch', '--no-color']));
  }

  /** Unmerged (conflicted) paths in the working tree, used to classify failures. */
  private async unmergedPaths(): Promise<string[]> {
    return (await this.git(['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
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
    return (await this.branchInfo(false)).current;
  }

  async statusRaw(): Promise<string> {
    return this.git(['status', '--porcelain']);
  }

  async status(): Promise<PorcelainStatus> {
    return parseStatusZ(await this.git(['status', '--porcelain', '-z']));
  }

  async branches(): Promise<BranchListResult> {
    const info = await this.branchInfo(true);
    const local: BranchInfo[] = [];
    const remote: string[] = [];

    // Build branch → worktree dirname map from `git worktree list`
    const branchToWorktree = new Map<string, string>();
    const worktreeNames: string[] = [];
    try {
      const wtOutput = await this.git(['worktree', 'list', '--porcelain']);
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

    for (const name of info.all) {
      if (name.startsWith('remotes/')) {
        // Skip pseudo-refs like "remotes/origin/HEAD -> origin/main"
        if (name.includes(' -> ') || name.endsWith('/HEAD')) continue;
        const remoteName = name.replace(/^remotes\//, '');
        remote.push(remoteName);
      } else {
        let tracking: string | undefined;
        let ahead: number | undefined;
        let behind: number | undefined;
        try {
          const upstream = (await this.git(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])).trim();
          if (upstream && upstream !== '') {
            tracking = upstream;
            const counts = (await this.git(['rev-list', '--left-right', '--count', `${name}...${upstream}`])).trim();
            const [a, b] = counts.split(/\s+/);
            ahead = parseInt(a!, 10) || 0;
            behind = parseInt(b!, 10) || 0;
          }
        } catch {
          // No tracking branch — expected for local-only branches
        }
        local.push({
          name,
          current: name === info.current,
          tracking,
          ahead,
          behind,
          worktree: branchToWorktree.get(name),
        });
      }
    }

    // Detect active merge/rebase operation
    let activeOperation: 'merge' | 'rebase' | undefined;
    try {
      const gitDir = (await this.git(['rev-parse', '--git-dir'])).trim();
      try {
        await access(join(gitDir, 'MERGE_HEAD'));
        activeOperation = 'merge';
      } catch {
        /* no merge */
      }
      if (!activeOperation) {
        try {
          await access(join(gitDir, 'rebase-merge'));
          activeOperation = 'rebase';
        } catch {
          /* no interactive rebase */
        }
      }
      if (!activeOperation) {
        try {
          await access(join(gitDir, 'rebase-apply'));
          activeOperation = 'rebase';
        } catch {
          /* no rebase */
        }
      }
    } catch {
      /* git-dir resolution failed */
    }

    return { current: info.current, local, remote, worktrees: worktreeNames, activeOperation };
  }

  async stage(files: string[]): Promise<void> {
    await this.git(['add', ...files]);
  }

  async unstage(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.git(['reset', 'HEAD', '--', ...files]);
  }

  // `-c core.abbrev=40` forces the full 40-char SHA in `git commit`'s output line
  // instead of git's repo-size-dependent abbreviation, so parseCommitHash returns a
  // deterministic hash. This intentionally widens the return vs simple-git's short
  // hash; no consumer relies on the short form (a full SHA is a display superset).
  async commit(message: string): Promise<string> {
    return parseCommitHash(await this.git(['-c', 'core.abbrev=40', 'commit', '-m', message]));
  }

  /**
   * Stage every change (tracked edits, new files, and deletions) and commit.
   * Throws when there is nothing to commit. Used by the Review panel's
   * "Commit N files" action, which commits the whole working tree at once.
   */
  async commitAll(message: string): Promise<string> {
    await this.git(['add', '-A']);
    const commit = parseCommitHash(await this.git(['-c', 'core.abbrev=40', 'commit', '-m', message]));
    if (!commit) throw new Error('Nothing to commit');
    return commit;
  }

  /**
   * Per-file addition/deletion counts for the working tree (vs HEAD), plus
   * totals. Tracked changes come from `git diff --numstat HEAD`; untracked
   * files are line-counted directly (git omits them from numstat). Binary
   * files report 0/0. Feeds the Review panel's stat meters and header totals.
   */
  async workingStat(): Promise<WorkingStat> {
    const files: WorkingStatFile[] = [];

    const numstat = await this.git(['diff', '--numstat', 'HEAD']);
    for (const line of numstat.split('\n').filter(Boolean)) {
      const [addStr, delStr, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      if (!path) continue;
      files.push({
        path,
        additions: addStr === '-' ? 0 : parseInt(addStr ?? '', 10) || 0,
        deletions: delStr === '-' ? 0 : parseInt(delStr ?? '', 10) || 0,
      });
    }

    // Untracked files (`-uall` lists individual files inside new directories).
    const status = await this.git(['status', '--porcelain', '-uall']);
    for (const line of status.split('\n').filter(Boolean)) {
      if (!line.startsWith('??')) continue;
      const path = line.slice(3);
      if (!path || path.endsWith('/')) continue;
      files.push({ path, additions: await this.countUntrackedAdditions(path), deletions: 0 });
    }

    const totalAdditions = files.reduce((a, f) => a + f.additions, 0);
    const totalDeletions = files.reduce((a, f) => a + f.deletions, 0);
    return { files, totalAdditions, totalDeletions };
  }

  /** Lines in an untracked file; 0 for binary (null-byte) or empty files. */
  private async countUntrackedAdditions(relPath: string): Promise<number> {
    try {
      const buf = await readFile(join(this.projectPath, relPath));
      if (buf.includes(0)) return 0;
      const text = buf.toString('utf8');
      if (text.length === 0) return 0;
      return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    } catch {
      /* expected — file may have vanished between status and read */
      return 0;
    }
  }

  async diff(args: string[]): Promise<string> {
    return this.git(['diff', ...args]);
  }

  async show(ref: string): Promise<string> {
    return this.git(['show', ref]);
  }

  async mergeBase(branch1: string, branch2: string): Promise<string | null> {
    try {
      return (await this.git(['merge-base', branch1, branch2])).trim();
    } catch {
      /* expected — branches may share no common ancestor */
      return null;
    }
  }

  /**
   * Tries 'main' then 'master' to find a common merge-base with HEAD.
   * Returns the first match or null when neither resolves.
   */
  async detectBaseBranch(): Promise<{ baseBranch: string; mergeBase: string } | null> {
    for (const base of ['main', 'master']) {
      const sha = await this.mergeBase(base, 'HEAD');
      if (sha) return { baseBranch: base, mergeBase: sha };
    }
    return null;
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
        const remotes = parseRemotes(await this.git(['remote']));
        if (remotes.includes(remote!)) {
          try {
            await this.git(['checkout', '-b', localName!, `${branch}`, '--track']);
          } catch (err: any) {
            if (err?.message?.includes('already exists')) {
              await this.git(['checkout', localName!]);
            } else {
              throw err;
            }
          }
          return;
        }
      }
      await this.git(['checkout', branch]);
    });
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    return this.withLock(async () => {
      if (startPoint) {
        await this.git(['checkout', '-b', name, startPoint]);
      } else {
        await this.git(['checkout', '-b', name]);
      }
    });
  }

  async fetch(remote?: string): Promise<FetchResult> {
    return this.withLock(async () => {
      if (remote) {
        await this.git(['fetch', remote, '--prune'], NO_TIMEOUT);
      } else {
        await this.git(['fetch', '--all', '--prune'], NO_TIMEOUT);
      }
      return { status: 'success', remote: remote ?? 'all' };
    });
  }

  async pull(remote?: string, branch?: string, localBranch?: string): Promise<PullResult> {
    return this.withLock(async () => {
      // When a local branch is specified and it differs from the current branch,
      // use `git fetch remote remoteBranch:localBranch` to fast-forward the target
      // ref without switching the working tree.
      if (localBranch && branch) {
        const currentBranch = (await this.branchInfo(false)).current;
        if (currentBranch !== localBranch) {
          const pullRemote = remote ?? 'origin';
          const refBefore = (await this.git(['rev-parse', localBranch])).trim();
          await this.git(['fetch', pullRemote, `${branch}:${localBranch}`], NO_TIMEOUT);
          const refAfter = (await this.git(['rev-parse', localBranch])).trim();
          if (refBefore === refAfter) return { status: 'up-to-date' };
          return { status: 'success', summary: { changes: 0, insertions: 0, deletions: 0 } };
        }
      }

      try {
        const args = ['pull', ...(remote ? [remote] : []), ...(branch ? [branch] : []), '--ff-only'];
        const summary = parseDiffStatSummary(await this.git(args, NO_TIMEOUT));
        if (summary.changes === 0 && summary.insertions === 0 && summary.deletions === 0)
          return { status: 'up-to-date' };
        return { status: 'success', summary };
      } catch (err: any) {
        const conflicts = await this.unmergedPaths();
        if (conflicts.length > 0) {
          return { status: 'conflict', conflicts, message: err?.message ?? String(err) };
        }
        throw err;
      }
    });
  }

  async push(branch?: string, remote?: string): Promise<PushResult> {
    return this.withLock(async () => {
      try {
        const currentBranch = branch ?? (await this.branchInfo(false)).current;
        const pushRemote = remote ?? 'origin';

        // Look up the tracking branch to build a correct refspec when the
        // local and remote branch names differ.
        let remoteBranch = currentBranch;
        try {
          const upstream = (await this.git(['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`])).trim();
          if (upstream) {
            const idx = upstream.indexOf('/');
            if (idx > 0) remoteBranch = upstream.slice(idx + 1);
          }
        } catch {
          // No upstream configured — push local name (may create new remote branch)
        }

        await this.git(['push', pushRemote, `${currentBranch}:${remoteBranch}`], NO_TIMEOUT);
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
        const output = await this.git(['merge', branch], NO_TIMEOUT);
        const summary = parseDiffStatSummary(output);
        return {
          status: 'success',
          summary: {
            commits: countAutoMerges(output),
            insertions: summary.insertions,
            deletions: summary.deletions,
          },
        };
      } catch (err: any) {
        const conflicts = await this.unmergedPaths();
        if (conflicts.length > 0) {
          return { status: 'conflict', conflicts, message: err?.message ?? String(err) };
        }
        throw err;
      }
    });
  }

  async rebase(branch: string): Promise<RebaseResult> {
    return this.withLock(async () => {
      try {
        await this.git(['rebase', branch], NO_TIMEOUT);
        return { status: 'success' };
      } catch (err: any) {
        try {
          const gitDir = (await this.git(['rev-parse', '--git-dir'])).trim();
          await access(join(gitDir, 'rebase-merge'));
          const statusResult = await this.status();
          return { status: 'conflict', conflicts: statusResult.conflicted, message: err.message };
        } catch {
          throw err;
        }
      }
    });
  }

  async abort(): Promise<{ aborted: boolean }> {
    return this.withLock(async () => {
      // Use git rev-parse to find the actual git dir (works in worktrees where .git is a file)
      const gitDir = (await this.git(['rev-parse', '--git-dir'])).trim();
      try {
        await access(join(gitDir, 'MERGE_HEAD'));
        await this.git(['merge', '--abort']);
        return { aborted: true };
      } catch {
        /* expected — probing whether a merge is in progress */
      }
      try {
        await access(join(gitDir, 'rebase-merge'));
        await this.git(['rebase', '--abort']);
        return { aborted: true };
      } catch {
        /* expected — probing whether an interactive rebase is in progress */
      }
      try {
        await access(join(gitDir, 'rebase-apply'));
        await this.git(['rebase', '--abort']);
        return { aborted: true };
      } catch {
        /* expected — no active merge or rebase to abort */
      }
      return { aborted: false };
    });
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    return this.withLock(async () => {
      await this.git(['branch', '-m', oldName, newName]);
    });
  }

  async deleteBranch(name: string, force = false, isRemote = false): Promise<DeleteBranchResult> {
    return this.withLock(async () => {
      if (isRemote) {
        const remoteMatch = name.match(/^([^/]+)\/(.+)$/);
        if (!remoteMatch) throw new Error(`Invalid remote branch name: ${name}`);
        const [, remote, branchName] = remoteMatch;
        await this.git(['push', remote!, '--delete', branchName!], NO_TIMEOUT);
        return { status: 'success' };
      }
      try {
        await this.git(['branch', force ? '-D' : '-d', name]);
        return { status: 'success' };
      } catch (err: any) {
        if (err?.message?.includes('not fully merged')) {
          return { status: 'not-merged', message: err.message };
        }
        if (err?.message?.includes('used by worktree')) {
          return { status: 'is-current', message: 'Cannot delete the currently checked-out branch' };
        }
        throw err;
      }
    });
  }

  async updateAll(): Promise<UpdateAllResult> {
    return this.withLock(async () => {
      let fetched = false;
      try {
        await this.git(['fetch', '--all', '--prune'], NO_TIMEOUT);
        fetched = true;
      } catch (err) {
        logger.warn({ err }, 'fetch --all failed during updateAll');
      }

      // Pull current branch
      let pull: PullResult;
      try {
        const summary = parseDiffStatSummary(await this.git(['pull', '--ff-only'], NO_TIMEOUT));
        pull =
          summary.changes === 0 && summary.insertions === 0 && summary.deletions === 0
            ? { status: 'up-to-date' }
            : { status: 'success', summary };
      } catch (err: any) {
        const conflicts = await this.unmergedPaths();
        if (conflicts.length > 0) {
          pull = { status: 'conflict', conflicts, message: err?.message ?? String(err) };
        } else {
          logger.warn({ err }, 'pull failed during updateAll');
          pull = { status: 'up-to-date' };
        }
      }

      // Fast-forward all non-current local branches that have tracking remotes
      const branches: BranchUpdateStatus[] = [];
      try {
        const branchResult = await this.branchInfo(true);
        const currentBranch = branchResult.current;

        for (const name of branchResult.all) {
          if (name.startsWith('remotes/') || name === currentBranch) continue;
          let upstream: string;
          try {
            upstream = (await this.git(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])).trim();
          } catch {
            continue; // no tracking remote
          }
          const idx = upstream.indexOf('/');
          if (idx <= 0) continue;
          const remote = upstream.slice(0, idx);
          const remoteBranch = upstream.slice(idx + 1);
          try {
            const refBefore = (await this.git(['rev-parse', name])).trim();
            await this.git(['fetch', remote, `${remoteBranch}:${name}`], NO_TIMEOUT);
            const refAfter = (await this.git(['rev-parse', name])).trim();
            branches.push({ branch: name, status: refBefore === refAfter ? 'up-to-date' : 'updated' });
          } catch (err: any) {
            branches.push({ branch: name, status: 'error', error: err.message });
          }
        }
      } catch (err) {
        logger.warn({ err }, 'branch enumeration failed during updateAll');
      }

      return { fetched, pull, branches };
    });
  }
}
