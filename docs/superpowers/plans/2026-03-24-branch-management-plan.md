# Branch Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive branch management popover to the status bar, backed by a `simple-git` service layer that replaces raw `execGit` usage.

**Architecture:** `simple-git` wraps git in a `GitService` class in core. New REST endpoints expose branch operations. Desktop gets a `BranchPopover` component anchored to the status bar's branch display. A reusable toast system provides feedback.

**Tech Stack:** simple-git, Express 5, Zod 4, React, Zustand, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-branch-management-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/types/src/git.ts` | Git result types shared across packages |
| `packages/core/src/git/git-service.ts` | `GitService` class wrapping `simple-git` |
| `packages/core/src/git/project-lock.ts` | Per-project mutex for serializing write ops |
| `packages/core/src/__tests__/git/git-service.test.ts` | Unit tests for GitService |
| `packages/core/src/__tests__/routes/git-write.test.ts` | Integration tests for new write endpoints |
| `packages/desktop/src/renderer/lib/api/git-api.ts` | Desktop API client for git endpoints |
| `packages/desktop/src/renderer/store/toasts.ts` | Toast notification Zustand store |
| `packages/desktop/src/renderer/lib/toast.ts` | `toast.success/error/info` helper |
| `packages/desktop/src/renderer/components/Toaster.tsx` | Toast renderer component |
| `packages/desktop/src/renderer/components/git/BranchPopover.tsx` | Main popover component |
| `packages/desktop/src/renderer/components/git/BranchList.tsx` | Searchable tree-grouped branch list |
| `packages/desktop/src/renderer/components/git/BranchSubmenu.tsx` | Per-branch action submenu |
| `packages/desktop/src/renderer/components/git/NewBranchDialog.tsx` | Create branch sub-view |
| `packages/desktop/src/renderer/components/git/ConflictView.tsx` | Conflict state display |
| `packages/desktop/src/__tests__/components/Toaster.test.tsx` | Toast component tests |
| `packages/desktop/src/__tests__/components/git/BranchPopover.test.tsx` | Popover component tests |
| `packages/e2e/tests/TODO-branch-management.md` | E2E test gap documentation |

### Modified files

| File | Changes |
|------|---------|
| `packages/types/src/index.ts` | Add `export * from './git.js'` |
| `packages/core/package.json` | Add `simple-git` dependency |
| `packages/core/src/server/routes/git.ts` | Rewrite handlers to use GitService, add write endpoints, move paths under `/git/` |
| `packages/core/src/__tests__/routes/git.test.ts` | Update route paths for migrated endpoints |
| `packages/desktop/src/renderer/lib/api/files-api.ts` | Remove git functions (moved to git-api.ts) |
| `packages/desktop/src/renderer/lib/api/index.ts` | Re-export from git-api instead of files-api for git functions |
| `packages/desktop/src/renderer/components/StatusBar.tsx` | Make branch name clickable, integrate popover |
| `packages/desktop/src/renderer/App.tsx` | Mount `<Toaster />` |
| `packages/core/src/server/routes/types.ts` | Add `getProjectPath` helper |
| `packages/core/src/server/routes/schemas.ts` | Add git operation Zod schemas |

---

## Task 1: Git types

**Files:**
- Create: `packages/types/src/git.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create git types file**

```ts
// packages/types/src/git.ts

export interface BranchInfo {
  name: string;
  current: boolean;
  tracking?: string;
}

export interface BranchListResult {
  current: string;
  local: BranchInfo[];
  remote: string[];
}

export type FetchResult = {
  status: 'success';
  remote: string;
};

export type PullResult =
  | { status: 'success'; summary: { changes: number; insertions: number; deletions: number } }
  | { status: 'up-to-date' }
  | { status: 'conflict'; conflicts: string[]; message: string };

export type MergeResult =
  | { status: 'success'; summary: { commits: number; insertions: number; deletions: number } }
  | { status: 'conflict'; conflicts: string[]; message: string };

export type RebaseResult =
  | { status: 'success' }
  | { status: 'conflict'; conflicts: string[]; message: string };

export type PushResult =
  | { status: 'success'; branch: string; remote: string }
  | { status: 'rejected'; message: string };

export type DeleteBranchResult =
  | { status: 'success' }
  | { status: 'not-merged'; message: string };

export interface UpdateAllResult {
  fetched: boolean;
  pull: PullResult;
}
```

- [ ] **Step 2: Export from types index**

Add to `packages/types/src/index.ts`:
```ts
export * from './git.js';
```

- [ ] **Step 3: Build types package and verify**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: clean compilation

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/git.ts packages/types/src/index.ts
git commit -m "feat(types): add git operation result types"
```

---

## Task 2: Per-project mutex

**Files:**
- Create: `packages/core/src/git/project-lock.ts`

- [ ] **Step 1: Create the mutex module**

```ts
// packages/core/src/git/project-lock.ts

type Release = () => void;

const locks = new Map<string, Promise<void>>();

/**
 * Acquire a mutex for a project path. Returns a release function.
 * Concurrent callers on the same path wait in FIFO order.
 */
export function acquireProjectLock(projectPath: string): Promise<Release> {
  const prev = locks.get(projectPath) ?? Promise.resolve();
  let release!: Release;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(projectPath, prev.then(() => next));
  return prev.then(() => release);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/git/project-lock.ts
git commit -m "feat(core): add per-project mutex for git operations"
```

---

## Task 3: GitService

**Files:**
- Modify: `packages/core/package.json` (add `simple-git`)
- Create: `packages/core/src/git/git-service.ts`
- Create: `packages/core/src/__tests__/git/git-service.test.ts`

- [ ] **Step 1: Install simple-git**

Run: `pnpm --filter @qlan-ro/mainframe-core add simple-git`

- [ ] **Step 2: Write failing tests for GitService read operations**

Create `packages/core/src/__tests__/git/git-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock simple-git before importing GitService
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

// Import after mock
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
          'remotes/origin/feat/foo': { current: false, name: 'remotes/origin/feat/foo', linkedWorkTree: false, label: '' },
        },
      });
      // Mock tracking info
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/git/git-service.test.ts`
Expected: FAIL — `git-service.js` does not exist

- [ ] **Step 4: Implement GitService**

Create `packages/core/src/git/git-service.ts`:

```ts
import { simpleGit } from 'simple-git';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createChildLogger } from '../logger.js';
import { acquireProjectLock } from './project-lock.js';
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

  /** Wraps a write operation with the per-project lock. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await acquireProjectLock(this.projectPath);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // --- Read operations ---

  async currentBranch(): Promise<string> {
    const result = await this.git().branch();
    return result.current;
  }

  /** Returns raw porcelain output for backward compat with existing parseStatusLines(). */
  async statusRaw(): Promise<string> {
    return this.git().raw(['status', '--porcelain']);
  }

  /** Returns structured status (for conflict detection, etc.). */
  async status(): Promise<{ conflicted: string[]; files: { path: string; index: string; working_dir: string }[] }> {
    const result = await this.git().status();
    return { conflicted: result.conflicted, files: result.files };
  }

  async branches(): Promise<BranchListResult> {
    const result = await this.git().branch(['-a']);
    const local: BranchInfo[] = [];
    const remote: string[] = [];

    for (const name of result.all) {
      if (name.startsWith('remotes/')) {
        // Strip 'remotes/' prefix → "origin/main"
        const remoteName = name.replace(/^remotes\//, '');
        remote.push(remoteName);
      } else {
        let tracking: string | undefined;
        try {
          const upstream = (
            await this.git().raw(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])
          ).trim();
          if (upstream && upstream !== '') tracking = upstream;
        } catch {
          // No tracking branch
        }
        local.push({ name, current: name === result.current, tracking });
      }
    }

    return { current: result.current, local, remote };
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
      return null;
    }
  }

  // --- Write operations ---

  async checkout(branch: string): Promise<void> {
    return this.withLock(async () => {
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
        await this.git().fetch(remote);
      } else {
        await this.git().fetch(['--all']);
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
          return {
            status: 'conflict',
            conflicts: err.git.conflicts,
            message: err.message,
          };
        }
        throw err;
      }
    });
  }

  async push(branch?: string, remote?: string): Promise<PushResult> {
    return this.withLock(async () => {
      try {
        const currentBranch = branch ?? (await this.git().branch()).current;
        await this.git().push(remote ?? 'origin', currentBranch);
        return { status: 'success', branch: currentBranch, remote: remote ?? 'origin' };
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
          return {
            status: 'conflict',
            conflicts: err.git.conflicts,
            message: err.message,
          };
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
        // Rebase conflicts: check for REBASE_HEAD
        try {
          await access(join(this.projectPath, '.git', 'rebase-merge'));
          const statusResult = await this.git().status();
          return {
            status: 'conflict',
            conflicts: statusResult.conflicted,
            message: err.message,
          };
        } catch {
          // Not a rebase conflict, re-throw
          throw err;
        }
      }
    });
  }

  async abort(): Promise<void> {
    return this.withLock(async () => {
      // Auto-detect merge vs rebase
      try {
        await access(join(this.projectPath, '.git', 'MERGE_HEAD'));
        await this.git().merge(['--abort']);
        return;
      } catch {
        // Not a merge
      }
      try {
        await access(join(this.projectPath, '.git', 'rebase-merge'));
        await this.git().rebase(['--abort']);
        return;
      } catch {
        // Not a rebase-merge
      }
      try {
        await access(join(this.projectPath, '.git', 'rebase-apply'));
        await this.git().rebase(['--abort']);
        return;
      } catch {
        // Nothing to abort
      }
    });
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    return this.withLock(async () => {
      await this.git().raw(['branch', '-m', oldName, newName]);
    });
  }

  async deleteBranch(name: string, force = false): Promise<DeleteBranchResult> {
    return this.withLock(async () => {
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
        await this.git().fetch(['--all']);
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/git/git-service.test.ts`
Expected: all PASS

- [ ] **Step 6: Build core and verify**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean compilation

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/git/ packages/core/src/__tests__/git/
git commit -m "feat(core): add GitService backed by simple-git"
```

---

## Task 4: Migrate existing git routes to GitService

**Files:**
- Modify: `packages/core/src/server/routes/git.ts`
- Modify: `packages/core/src/__tests__/routes/git.test.ts`
- Modify: `packages/desktop/src/renderer/lib/api/files-api.ts` (update `branch-diffs` and `diff` paths)
- Modify: `packages/desktop/src/renderer/lib/api/index.ts`

- [ ] **Step 1: Rewrite `git.ts` route handlers to use GitService**

Replace `execGit` calls with `GitService.forProject(basePath)` calls. Move `branch-diffs` to `/api/projects/:id/git/branch-diffs` and `diff` to `/api/projects/:id/git/diff`. Keep `parseStatusLines` and `parseDiffNameStatus` as-is for now (they parse the raw porcelain output from `GitService.status()` and `GitService.diff()`).

Key changes in `gitRoutes()`:
```ts
// Old:
router.get('/api/projects/:id/branch-diffs', ...);
router.get('/api/projects/:id/diff', ...);

// New:
router.get('/api/projects/:id/git/branch-diffs', ...);
router.get('/api/projects/:id/git/diff', ...);
```

Inside handlers, replace:
```ts
// Old:
const branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], basePath)).trim();

// New:
const svc = GitService.forProject(basePath);
const branch = await svc.currentBranch();
```

- [ ] **Step 2: Update test route paths**

In `packages/core/src/__tests__/routes/git.test.ts`, update:
```ts
// Old path
const handler = extractHandler(router, 'get', '/api/projects/:id/branch-diffs');
// New path
const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch-diffs');
```

- [ ] **Step 3: Update desktop API paths**

In `packages/desktop/src/renderer/lib/api/files-api.ts`, update:
```ts
// getBranchDiffs: change URL
return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branch-diffs${qs ? `?${qs}` : ''}`);

// getDiff: change URL
return fetchJson(`${API_BASE}/api/projects/${projectId}/git/diff?${params}`);
```

- [ ] **Step 4: Verify no stale path references remain**

Run: `grep -r 'branch-diffs' packages/ --include='*.ts' --include='*.tsx' -l` and `grep -r '/diff?' packages/ --include='*.ts' --include='*.tsx' -l`

Update any remaining callers that reference the old `/branch-diffs` or `/diff` paths (without `/git/` prefix).

- [ ] **Step 5: Run existing tests to verify migration is backward-compatible**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/routes/git.test.ts`
Expected: all PASS

- [ ] **Step 5: Build both packages**

Run: `pnpm --filter @qlan-ro/mainframe-core build && pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/__tests__/routes/git.test.ts packages/desktop/src/renderer/lib/api/files-api.ts
git commit -m "refactor(core): migrate git routes to GitService, unify under /git/ prefix"
```

---

## Task 5: New git write endpoints

**Files:**
- Modify: `packages/core/src/server/routes/git.ts` (add write endpoints)
- Create: `packages/core/src/__tests__/routes/git-write.test.ts`

- [ ] **Step 1: Write failing tests for write endpoints**

Create `packages/core/src/__tests__/routes/git-write.test.ts`. Tests should mock `GitService.forProject()` and verify:
- `POST /api/projects/:id/git/checkout` calls `svc.checkout(branch)` and returns 200
- `POST /api/projects/:id/git/branch` calls `svc.createBranch(name, startPoint?)` and returns 200
- `POST /api/projects/:id/git/fetch` calls `svc.fetch(remote?)` and returns FetchResult
- `POST /api/projects/:id/git/pull` calls `svc.pull(remote?, branch?)` and returns PullResult
- `POST /api/projects/:id/git/push` calls `svc.push(branch?, remote?)` and returns PushResult
- `POST /api/projects/:id/git/merge` calls `svc.merge(branch)` and returns MergeResult
- `POST /api/projects/:id/git/rebase` calls `svc.rebase(branch)` and returns RebaseResult
- `POST /api/projects/:id/git/abort` calls `svc.abort()` and returns 200
- `POST /api/projects/:id/git/rename-branch` calls `svc.renameBranch(oldName, newName)` and returns 200
- `POST /api/projects/:id/git/delete-branch` calls `svc.deleteBranch(name, force?)` and returns DeleteBranchResult
- `POST /api/projects/:id/git/update-all` calls `svc.updateAll()` and returns UpdateAllResult
- `GET /api/projects/:id/git/branches` calls `svc.branches()` and returns BranchListResult
- Zod validation: missing `branch` body on checkout → 400

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/routes/git-write.test.ts`
Expected: FAIL — endpoints don't exist

- [ ] **Step 3: Add Zod schemas and write endpoints**

First, add `getProjectPath` helper to `packages/core/src/server/routes/types.ts`:

```ts
/** Like getEffectivePath but always returns the project root, ignoring worktrees. */
export function getProjectPath(ctx: RouteContext, projectId: string): string | null {
  const project = ctx.db.projects.get(projectId);
  return project?.path ?? null;
}
```

Add Zod schemas to `packages/core/src/server/routes/schemas.ts` (where all other route schemas live):

```ts
// Git operation schemas
export const gitCheckoutSchema = z.object({ branch: z.string().min(1) });
export const gitCreateBranchSchema = z.object({ name: z.string().min(1), startPoint: z.string().optional() });
export const gitFetchSchema = z.object({ remote: z.string().optional() });
export const gitPullSchema = z.object({ remote: z.string().optional(), branch: z.string().optional() });
export const gitPushSchema = z.object({ branch: z.string().optional(), remote: z.string().optional() });
export const gitMergeSchema = z.object({ branch: z.string().min(1) });
export const gitRebaseSchema = z.object({ branch: z.string().min(1) });
export const gitRenameBranchSchema = z.object({ oldName: z.string().min(1), newName: z.string().min(1) });
export const gitDeleteBranchSchema = z.object({ name: z.string().min(1), force: z.boolean().optional() });
```

Then in `packages/core/src/server/routes/git.ts`, import and use them:

```ts
import { GitService } from '../../git/git-service.js';
import { getProjectPath } from './types.js';
import { gitCheckoutSchema, gitMergeSchema /* etc */ } from './schemas.js';
```

Each handler follows this pattern:
```ts
async function handleCheckout(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) { res.status(404).json({ error: 'Project not found' }); return; }
  const parsed = gitCheckoutSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: String(parsed.error) }); return; }
  try {
    const svc = GitService.forProject(projectPath);
    await svc.checkout(parsed.data.branch);
    res.json({ ok: true });
  } catch (err: any) {
    logger.warn({ err }, 'checkout failed');
    res.status(500).json({ error: err.message });
  }
}
```

Register all routes in the `gitRoutes()` function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/routes/git-write.test.ts`
Expected: all PASS

- [ ] **Step 5: Build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean compilation

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server/routes/git.ts packages/core/src/__tests__/routes/git-write.test.ts
git commit -m "feat(core): add git write endpoints (checkout, merge, push, etc.)"
```

---

## Task 6: Desktop git API client

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/git-api.ts`
- Modify: `packages/desktop/src/renderer/lib/api/files-api.ts` (remove git functions)
- Modify: `packages/desktop/src/renderer/lib/api/index.ts` (re-export from git-api)

- [ ] **Step 1: Create git-api.ts**

```ts
import type {
  BranchListResult,
  FetchResult,
  PullResult,
  PushResult,
  MergeResult,
  RebaseResult,
  DeleteBranchResult,
  UpdateAllResult,
} from '@qlan-ro/mainframe-types';
import { fetchJson, postJson, API_BASE } from './http.js';

export async function getGitBranch(projectId: string, chatId?: string): Promise<{ branch: string | null }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branch${params}`);
}

export async function getGitStatus(
  projectId: string,
  chatId?: string,
): Promise<{ files: { status: string; path: string }[] }> {
  const params = chatId ? `?chatId=${chatId}` : '';
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/status${params}`);
}

export async function getGitBranches(projectId: string): Promise<BranchListResult> {
  return fetchJson(`${API_BASE}/api/projects/${projectId}/git/branches`);
}

export async function gitCheckout(projectId: string, branch: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/checkout`, { branch });
}

export async function gitCreateBranch(projectId: string, name: string, startPoint?: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/branch`, { name, startPoint });
}

export async function gitFetch(projectId: string, remote?: string): Promise<FetchResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/fetch`, { remote });
}

export async function gitPull(projectId: string, remote?: string, branch?: string): Promise<PullResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/pull`, { remote, branch });
}

export async function gitPush(projectId: string, branch?: string, remote?: string): Promise<PushResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/push`, { branch, remote });
}

export async function gitMerge(projectId: string, branch: string): Promise<MergeResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/merge`, { branch });
}

export async function gitRebase(projectId: string, branch: string): Promise<RebaseResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/rebase`, { branch });
}

export async function gitAbort(projectId: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/abort`);
}

export async function gitRenameBranch(projectId: string, oldName: string, newName: string): Promise<void> {
  await postJson(`${API_BASE}/api/projects/${projectId}/git/rename-branch`, { oldName, newName });
}

export async function gitDeleteBranch(projectId: string, name: string, force?: boolean): Promise<DeleteBranchResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/delete-branch`, { name, force });
}

export async function gitUpdateAll(projectId: string): Promise<UpdateAllResult> {
  return postJson(`${API_BASE}/api/projects/${projectId}/git/update-all`);
}
```

- [ ] **Step 2: Remove git functions from files-api.ts**

Remove `getGitStatus`, `getGitBranch`, `getDiff`, `getBranchDiffs` from `files-api.ts`. Move `getDiff` and `getBranchDiffs` to `git-api.ts` with the updated `/git/` paths. Keep the `BranchDiffResponse` and `SessionFileDiff` types in `files-api.ts` (or move to git-api if only git-related).

- [ ] **Step 3: Update index.ts re-exports**

Replace git function exports from `files-api` with exports from `git-api` in `packages/desktop/src/renderer/lib/api/index.ts`.

- [ ] **Step 4: Fix all import sites**

Search for imports of moved functions and update them. The barrel export means most consumers won't need changes, but verify.

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation (no broken imports)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/
git commit -m "feat(desktop): add git API client, migrate git functions from files-api"
```

---

## Task 7: Toast notification system

**Files:**
- Create: `packages/desktop/src/renderer/store/toasts.ts`
- Create: `packages/desktop/src/renderer/lib/toast.ts`
- Create: `packages/desktop/src/renderer/components/Toaster.tsx`
- Create: `packages/desktop/src/__tests__/components/Toaster.test.tsx`
- Modify: `packages/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Write failing test for Toaster**

Create `packages/desktop/src/__tests__/components/Toaster.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '../../renderer/components/Toaster';
import { useToastStore } from '../../renderer/store/toasts';

describe('Toaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders a success toast', () => {
    useToastStore.getState().add('success', 'It worked');
    render(<Toaster />);
    expect(screen.getByText('It worked')).toBeInTheDocument();
  });

  it('renders an error toast', () => {
    useToastStore.getState().add('error', 'Something broke');
    render(<Toaster />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('dismisses on click', async () => {
    useToastStore.getState().add('info', 'Click me');
    render(<Toaster />);
    await userEvent.click(screen.getByText('Click me'));
    expect(screen.queryByText('Click me')).not.toBeInTheDocument();
  });

  it('limits to 5 visible toasts', () => {
    const store = useToastStore.getState();
    for (let i = 0; i < 7; i++) store.add('info', `Toast ${i}`);
    render(<Toaster />);
    const toasts = screen.getAllByRole('alert');
    expect(toasts.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/__tests__/components/Toaster.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create toast store**

Create `packages/desktop/src/renderer/store/toasts.ts`:

```ts
import { create } from 'zustand';
import { nanoid } from 'nanoid';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  add: (type: Toast['type'], message: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (type, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: nanoid(8), type, message }],
    })),
  dismiss: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));
```

- [ ] **Step 4: Create toast helper**

Create `packages/desktop/src/renderer/lib/toast.ts`:

```ts
import { useToastStore } from '../store/toasts';

export const toast = {
  success: (message: string) => useToastStore.getState().add('success', message),
  error: (message: string) => useToastStore.getState().add('error', message),
  info: (message: string) => useToastStore.getState().add('info', message),
};
```

- [ ] **Step 5: Create Toaster component**

Create `packages/desktop/src/renderer/components/Toaster.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { useToastStore, type Toast } from '../store/toasts';
import { cn } from '../lib/utils';

const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 4_000;

function ToastItem({ toast: t }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (t.type !== 'error') {
      timerRef.current = setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS);
      return () => clearTimeout(timerRef.current);
    }
  }, [t.id, t.type, dismiss]);

  return (
    <div
      role="alert"
      onClick={() => dismiss(t.id)}
      className={cn(
        'px-3 py-2 rounded-lg text-sm cursor-pointer shadow-lg max-w-xs break-words',
        'border transition-opacity duration-200',
        t.type === 'success' && 'bg-mf-success opacity-10 border border-mf-success text-mf-success',
        t.type === 'error' && 'bg-mf-destructive opacity-10 border border-mf-destructive text-mf-destructive',
        t.type === 'info' && 'bg-mf-accent opacity-10 border border-mf-accent text-mf-accent',
      )}
    >
      {t.message}
    </div>
  );
}

export function Toaster(): React.ReactElement | null {
  const toasts = useToastStore((s) => s.toasts);
  const visible = toasts.slice(-MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2">
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Mount Toaster in App.tsx**

Add to `packages/desktop/src/renderer/App.tsx`:

```tsx
import { Toaster } from './components/Toaster';

// Inside <ErrorBoundary>, after <ConnectionOverlay />:
<Toaster />
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/__tests__/components/Toaster.test.tsx`
Expected: all PASS

- [ ] **Step 8: Build desktop**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/store/toasts.ts packages/desktop/src/renderer/lib/toast.ts packages/desktop/src/renderer/components/Toaster.tsx packages/desktop/src/__tests__/components/Toaster.test.tsx packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): add reusable toast notification system"
```

---

## Task 8: BranchPopover — main view + search + branch list

**Files:**
- Create: `packages/desktop/src/renderer/components/git/BranchList.tsx`
- Create: `packages/desktop/src/renderer/components/git/BranchPopover.tsx`
- Modify: `packages/desktop/src/renderer/components/StatusBar.tsx`

- [ ] **Step 1: Create BranchList component**

Create `packages/desktop/src/renderer/components/git/BranchList.tsx`.

This component:
- Accepts `branches: BranchListResult`, `search: string`, `onBranchClick: (name: string) => void`
- Groups local branches by `/` prefix into a tree (e.g., `fix/` → `unify-release-workflow`, `release-race`)
- Branches without prefix render at top level
- Filters by search substring (case-insensitive)
- Highlights the current branch with a left border accent
- Shows tracking info (abbreviated) on the right
- Shows a ▸ chevron indicating submenu
- Groups are collapsible

- [ ] **Step 2: Create BranchPopover component**

Create `packages/desktop/src/renderer/components/git/BranchPopover.tsx`.

This component:
- Accepts `projectId: string`, `currentBranch: string`, `onClose: () => void`, `onBranchChanged: () => void`
- Fetches branches via `getGitBranches(projectId)` on mount
- Renders: current branch header, search input + Fetch/Push buttons, New Branch / Update All actions, `<BranchList />`
- Handles loading and error states
- Fetch button calls `gitFetch(projectId)` → toast feedback
- Push button calls `gitPush(projectId)` → toast feedback
- Update All calls `gitUpdateAll(projectId)` → toast feedback
- Disables buttons while operations are in-flight (optimistic UI locking)
- Detects conflict state from `getGitStatus()` and shows `<ConflictView />` instead (Task 10)

- [ ] **Step 3: Make StatusBar branch name clickable**

Modify `packages/desktop/src/renderer/components/StatusBar.tsx`:
- Wrap the git branch `<div>` in a clickable button
- Add state: `popoverOpen: boolean`
- On click, toggle popover
- Render `<BranchPopover>` when open, positioned above the status bar
- On `onBranchChanged`, re-fetch branch immediately (bypass 15s poll)

- [ ] **Step 4: Build desktop and verify**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/git/ packages/desktop/src/renderer/components/StatusBar.tsx
git commit -m "feat(desktop): add branch popover with search and branch list"
```

---

## Task 9: BranchSubmenu + NewBranchDialog

**Files:**
- Create: `packages/desktop/src/renderer/components/git/BranchSubmenu.tsx`
- Create: `packages/desktop/src/renderer/components/git/NewBranchDialog.tsx`
- Modify: `packages/desktop/src/renderer/components/git/BranchPopover.tsx` (wire up submenu + dialog)

- [ ] **Step 1: Create BranchSubmenu component**

Create `packages/desktop/src/renderer/components/git/BranchSubmenu.tsx`.

Props: `projectId`, `branchName`, `isCurrent`, `onClose`, `onBranchChanged`

Renders a floating menu with actions:
- New Branch from '{name}'… → opens NewBranchDialog with startPoint pre-filled
- Checkout (disabled if current) → `gitCheckout()` → toast → `onBranchChanged()`
- Pull → `gitPull(projectId, undefined, branchName)` → toast
- Push → `gitPush(projectId, branchName)` → toast
- Merge into Current Branch (disabled if current) → `gitMerge(projectId, branchName)` → toast (handles conflict result)
- Rebase Current Branch onto This (disabled if current) → `gitRebase(projectId, branchName)` → toast (handles conflict result)
- Rename… → inline rename input
- Delete Branch (disabled if current, red) → confirmation if not-merged → `gitDeleteBranch()` → toast

All actions disable while in-flight.

- [ ] **Step 2: Create NewBranchDialog component**

Create `packages/desktop/src/renderer/components/git/NewBranchDialog.tsx`.

Props: `projectId`, `defaultStartPoint: string`, `onClose`, `onBranchCreated`

Renders:
- Back arrow + "New Branch" header
- Branch name input (auto-focused)
- "Start from" branch picker (dropdown of local branches, defaults to `defaultStartPoint`)
- Cancel / Create buttons
- On Create: `gitCreateBranch(projectId, name, startPoint)` → toast → `onBranchCreated()`

- [ ] **Step 3: Wire submenu and dialog into BranchPopover**

In `BranchPopover.tsx`:
- Track `selectedBranch: string | null` and `showNewBranch: boolean` state
- When a branch row is clicked → set `selectedBranch` → render `<BranchSubmenu>` positioned to the right
- When "New Branch…" is clicked → set `showNewBranch: true` → render `<NewBranchDialog>`
- When submenu "New Branch from…" is clicked → set `showNewBranch: true` with pre-filled startPoint

- [ ] **Step 4: Build desktop and verify**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/git/
git commit -m "feat(desktop): add branch submenu and new branch dialog"
```

---

## Task 10: ConflictView + safety guards

**Files:**
- Create: `packages/desktop/src/renderer/components/git/ConflictView.tsx`
- Modify: `packages/desktop/src/renderer/components/git/BranchPopover.tsx`
- Modify: `packages/desktop/src/renderer/components/git/BranchSubmenu.tsx`
- Modify: `packages/desktop/src/renderer/components/StatusBar.tsx`

- [ ] **Step 1: Create ConflictView component**

Create `packages/desktop/src/renderer/components/git/ConflictView.tsx`.

Props: `projectId`, `conflicts: string[]`, `type: 'merge' | 'rebase'`, `onAborted`

Renders:
- Red warning header: "Merge conflicts" / "Rebase conflicts"
- Abort button → `gitAbort(projectId)` → toast → `onAborted()`
- List of conflicting files with `C` indicator
- Help text

- [ ] **Step 2: Integrate conflict detection into BranchPopover**

In `BranchPopover.tsx`:
- After fetching branches, also check `getGitStatus()` for conflicted files
- If conflicts detected, render `<ConflictView>` instead of the normal branch list
- After abort, refresh branches and status

- [ ] **Step 3: Add dirty working tree guard to checkout**

In `BranchSubmenu.tsx`, before checkout:
- Call `getGitStatus(projectId)` to check for uncommitted changes
- If dirty, show a confirmation: "You have uncommitted changes. Switch anyway?"
- Same guard before merge and rebase

- [ ] **Step 4: Add ⚠ indicator to StatusBar**

In `StatusBar.tsx`:
- Poll status alongside branch (reuse the same interval)
- If status shows conflicted files, show ⚠ before the branch name
- Conflict state also changes the branch name color to warning

- [ ] **Step 5: Disable actions during conflict state**

In `BranchSubmenu.tsx`:
- If the project is in a conflict state (passed as prop from popover), disable Checkout, Merge, Rebase

- [ ] **Step 6: Build and verify**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: clean compilation

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/git/ packages/desktop/src/renderer/components/StatusBar.tsx
git commit -m "feat(desktop): add conflict view and safety guards"
```

---

## Task 11: Component tests for BranchPopover

**Files:**
- Create: `packages/desktop/src/__tests__/components/git/BranchPopover.test.tsx`

- [ ] **Step 1: Write component tests**

Test cases:
- Renders branch list from mocked API response
- Search filters branches
- Click on branch shows submenu
- Current branch submenu has disabled actions (checkout, merge, rebase, delete)
- Non-current branch submenu has all actions enabled
- Fetch button triggers API call and shows toast
- Push button triggers API call and shows toast
- New Branch opens the dialog sub-view
- Conflict state renders ConflictView instead of branch list

Mock `git-api` functions with `vi.mock`.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/__tests__/components/git/BranchPopover.test.tsx`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/__tests__/components/git/
git commit -m "test(desktop): add BranchPopover component tests"
```

---

## Task 12: E2E gap documentation + changeset

**Files:**
- Create: `packages/e2e/tests/TODO-branch-management.md`

- [ ] **Step 1: Create E2E gap doc**

Create `packages/e2e/tests/TODO-branch-management.md`:

```markdown
# Branch Management — E2E Test Gap

No E2E tests exist for the branch management feature (popover, checkout, merge, rebase, etc.).

## Why

Git operations require a real repository with specific state (branches, remotes, conflicts), making E2E tests unreliable without significant fixture setup. The daemon would need to operate on a disposable test repo rather than the actual project.

## Coverage

Unit and integration tests exist in:
- `packages/core/src/__tests__/git/git-service.test.ts` — GitService with mocked simple-git
- `packages/core/src/__tests__/routes/git-write.test.ts` — REST endpoint integration tests
- `packages/desktop/src/__tests__/components/git/BranchPopover.test.tsx` — UI component tests
- `packages/desktop/src/__tests__/components/Toaster.test.tsx` — Toast system tests

## Future work

To add E2E coverage:
1. Create a fixture that initializes a temporary git repo with branches and remotes
2. Point the daemon at this fixture repo
3. Test: open popover, checkout a branch, verify status bar updates
4. Test: create branch, verify it appears in the list
5. Test: merge with conflicts, verify conflict view appears
```

- [ ] **Step 2: Create changeset**

Run: `pnpm changeset`

Select affected packages: `@qlan-ro/mainframe-types` (minor), `@qlan-ro/mainframe-core` (minor), `@qlan-ro/mainframe-desktop` (minor)

Changeset message: "Add branch management popover with git operations (checkout, merge, push, pull, etc.) and reusable toast notification system"

- [ ] **Step 3: Final build check**

Run: `pnpm build`
Expected: all packages compile cleanly

- [ ] **Step 4: Final test check**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/e2e/tests/TODO-branch-management.md .changeset/
git commit -m "docs: add E2E gap note for branch management, add changeset"
```
