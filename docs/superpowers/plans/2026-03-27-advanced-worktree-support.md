# Advanced Worktree Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add base branch selection, custom branch naming, fork-to-worktree, and worktree awareness indicators to the Mainframe worktree system.

**Architecture:** Extend `createWorktree` with explicit `baseBranch`/`branchName` params, replace WS events with three HTTP endpoints, build a unified popover component, and add worktree indicators to title bar, file tree, changes tab, and branch popover.

**Tech Stack:** TypeScript, Express, Zod, React, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-advanced-worktree-support-design.md`

---

## File Structure

**Create:**
- `packages/core/src/server/routes/worktree.ts` -- HTTP endpoints for enable/disable/fork
- `packages/core/src/__tests__/routes/worktree.test.ts` -- route tests
- `packages/core/src/__tests__/workspace/worktree-create.test.ts` -- createWorktree with new params
- `packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx` -- unified popover
- `packages/desktop/src/renderer/lib/api/worktree-api.ts` -- client HTTP helpers

**Modify:**
- `packages/core/src/workspace/worktree.ts` -- add baseBranch/branchName params
- `packages/core/src/chat/config-manager.ts` -- update enableWorktree signature
- `packages/core/src/chat/chat-manager.ts` -- update public delegation, add forkToWorktree
- `packages/core/src/chat/lifecycle-manager.ts` -- add forkToWorktree
- `packages/core/src/server/routes/index.ts` -- mount worktree routes
- `packages/core/src/server/websocket.ts` -- remove worktree WS handlers
- `packages/core/src/server/ws-schemas.ts` -- remove worktree schemas
- `packages/types/src/events.ts` -- remove worktree ClientEvent variants
- `packages/desktop/src/renderer/lib/client.ts` -- remove WS worktree methods
- `packages/desktop/src/renderer/lib/api/index.ts` -- export worktree-api
- `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx` -- replace toggle with popover
- `packages/desktop/src/renderer/components/TitleBar.tsx` -- worktree branch in title
- `packages/desktop/src/renderer/components/panels/FilesTab.tsx` -- worktree path in header
- `packages/desktop/src/renderer/components/panels/ChangesTab.tsx` -- worktree badge
- `packages/desktop/src/renderer/components/git/BranchPopover.tsx` -- worktree isolation banner

---

## Task 1: Update `createWorktree` Signature

**Files:**
- Modify: `packages/core/src/workspace/worktree.ts:66-79`
- Test: `packages/core/src/__tests__/workspace/worktree-create.test.ts`

- [ ] **Step 1: Write failing tests for the new signature**

Create `packages/core/src/__tests__/workspace/worktree-create.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorktree, removeWorktree } from '../../workspace/worktree.js';

function initGitRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-test-'));
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  // Create a second branch so we can test baseBranch
  execFileSync('git', ['branch', 'develop'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('createWorktree', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initGitRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates worktree with explicit baseBranch and branchName', () => {
    const info = createWorktree(repoDir, 'test1234', '.worktrees', 'main', 'feat/my-feature');
    expect(info.branchName).toBe('feat/my-feature');
    expect(info.worktreePath).toContain('.worktrees');

    // Verify the branch was created from the right base
    const log = execFileSync('git', ['log', '--oneline', '-1', 'feat/my-feature'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    expect(log).toContain('init');

    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });

  it('creates worktree from a non-default base branch', () => {
    // Add a commit on develop so it diverges from main
    execFileSync('git', ['checkout', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'develop-commit'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', 'main'], { cwd: repoDir, stdio: 'pipe' });

    const info = createWorktree(repoDir, 'test5678', '.worktrees', 'develop', 'feat/from-develop');
    expect(info.branchName).toBe('feat/from-develop');

    const log = execFileSync('git', ['log', '--oneline', '-1', 'feat/from-develop'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    expect(log).toContain('develop-commit');

    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });

  it('uses chatId prefix for worktree directory name', () => {
    const info = createWorktree(repoDir, 'abcdef12rest', '.worktrees', 'main', 'session/abcdef12');
    expect(info.worktreePath).toContain('abcdef12');
    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/workspace/worktree-create.test.ts`
Expected: FAIL — `createWorktree` doesn't accept 5 args.

- [ ] **Step 3: Update `createWorktree` implementation**

In `packages/core/src/workspace/worktree.ts`, replace the existing function (lines 66-79):

```ts
export function createWorktree(
  projectPath: string,
  chatId: string,
  dirName: string,
  baseBranch: string,
  branchName: string,
): WorktreeInfo {
  const shortId = chatId.slice(0, 8);
  const worktreeDir = path.join(projectPath, dirName);
  const worktreePath = path.join(worktreeDir, shortId);

  mkdirSync(worktreeDir, { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath, baseBranch], {
    cwd: projectPath,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return { worktreePath, branchName };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/workspace/worktree-create.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workspace/worktree.ts packages/core/src/__tests__/workspace/worktree-create.test.ts
git commit -m "feat: add baseBranch and branchName params to createWorktree"
```

---

## Task 2: Update `enableWorktree` / `disableWorktree` in Config and ChatManager

**Files:**
- Modify: `packages/core/src/chat/config-manager.ts:91-111`
- Modify: `packages/core/src/chat/chat-manager.ts:149-154`

- [ ] **Step 1: Update `enableWorktree` in `config-manager.ts`**

Replace lines 91-111 in `packages/core/src/chat/config-manager.ts`:

```ts
async enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
  const active = this.deps.getActiveChat(chatId);
  if (!active) throw new Error(`Chat ${chatId} not found`);
  if (active.chat.claudeSessionId) throw new Error('Cannot enable worktree after session has started');
  if (active.chat.worktreePath) return;

  if (active.session?.isSpawned) {
    await active.session.kill();
    active.session = null;
  }

  const project = this.deps.db.projects.get(active.chat.projectId);
  if (!project) throw new Error('Project not found');

  const worktreeDir = this.deps.db.settings.get('general', 'worktreeDir') ?? GENERAL_DEFAULTS.worktreeDir;
  const info = createWorktree(project.path, chatId, worktreeDir, baseBranch, branchName);
  active.chat.worktreePath = info.worktreePath;
  active.chat.branchName = info.branchName;
  this.deps.db.chats.update(chatId, { worktreePath: info.worktreePath, branchName: info.branchName });
  this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
}
```

- [ ] **Step 2: Update ChatManager delegation**

In `packages/core/src/chat/chat-manager.ts`, update lines 149-154:

```ts
async enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
  return this.configManager.enableWorktree(chatId, baseBranch, branchName);
}

async disableWorktree(chatId: string): Promise<void> {
  return this.configManager.disableWorktree(chatId);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Should compile (callers not yet updated — they'll be replaced in later tasks).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/chat/config-manager.ts packages/core/src/chat/chat-manager.ts
git commit -m "feat: update enableWorktree to accept baseBranch and branchName"
```

---

## Task 3: Add `forkToWorktree` to LifecycleManager and ChatManager

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts`
- Modify: `packages/core/src/chat/chat-manager.ts`
- Modify: `packages/core/src/git/git-service.ts` (may need import for status check)

- [ ] **Step 1: Add `forkToWorktree` to `ChatLifecycleManager`**

Add after the `endChat` method (line 165) in `packages/core/src/chat/lifecycle-manager.ts`:

```ts
async forkToWorktree(
  chatId: string,
  baseBranch: string,
  branchName: string,
  enableWorktree: (chatId: string, baseBranch: string, branchName: string) => Promise<void>,
): Promise<{ chatId: string }> {
  const sourceActive = this.deps.activeChats.get(chatId);
  const sourceChat = sourceActive?.chat ?? this.deps.db.chats.get(chatId);
  if (!sourceChat) throw new Error(`Chat ${chatId} not found`);

  const project = this.deps.db.projects.get(sourceChat.projectId);
  if (!project) throw new Error('Project not found');

  // Check for uncommitted changes
  const { SimpleGit } = await import('simple-git');
  const git = SimpleGit(project.path);
  const status = await git.status();
  if (status.files.length > 0) {
    const err = new Error('Uncommitted changes in working directory');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const newChat = await this.createChat(
    sourceChat.projectId,
    sourceChat.adapterId,
    sourceChat.model,
    sourceChat.permissionMode,
  );
  await enableWorktree(newChat.id, baseBranch, branchName);
  return { chatId: newChat.id };
}
```

Wait — `simple-git` is already used in `GitService`. Let me use the existing `GitService` pattern instead. Check how `git-service.ts` is instantiated.

Actually, looking at the routes, `GitService` is instantiated per-request with a path. The lifecycle manager doesn't have direct access to it. A simpler approach: use `execFileAsync` (already imported in worktree.ts) to run `git status --porcelain` and check if output is empty.

Revised implementation for `packages/core/src/chat/lifecycle-manager.ts` — add import at the top:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
```

(Note: `existsSync` is already imported. Add these if not present.)

Add the helper and method after `endChat`:

```ts
private async isWorkingTreeDirty(projectPath: string): Promise<boolean> {
  const exec = promisify(execFile);
  const { stdout } = await exec('git', ['status', '--porcelain'], {
    cwd: projectPath,
    encoding: 'utf-8',
  });
  return stdout.trim().length > 0;
}

async forkToWorktree(
  chatId: string,
  baseBranch: string,
  branchName: string,
  enableWorktreeFn: (chatId: string, baseBranch: string, branchName: string) => Promise<void>,
): Promise<{ chatId: string }> {
  const sourceActive = this.deps.activeChats.get(chatId);
  const sourceChat = sourceActive?.chat ?? this.deps.db.chats.get(chatId);
  if (!sourceChat) throw new Error(`Chat ${chatId} not found`);

  const project = this.deps.db.projects.get(sourceChat.projectId);
  if (!project) throw new Error('Project not found');

  if (await this.isWorkingTreeDirty(project.path)) {
    const err = new Error('Commit or stash your changes before forking');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const newChat = await this.createChat(
    sourceChat.projectId,
    sourceChat.adapterId,
    sourceChat.model,
    sourceChat.permissionMode,
  );
  await enableWorktreeFn(newChat.id, baseBranch, branchName);
  return { chatId: newChat.id };
}
```

- [ ] **Step 2: Add delegation in `ChatManager`**

In `packages/core/src/chat/chat-manager.ts`, add after the `disableWorktree` method:

```ts
async forkToWorktree(chatId: string, baseBranch: string, branchName: string): Promise<{ chatId: string }> {
  return this.lifecycle.forkToWorktree(
    chatId,
    baseBranch,
    branchName,
    (newChatId, base, branch) => this.configManager.enableWorktree(newChatId, base, branch),
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts packages/core/src/chat/chat-manager.ts
git commit -m "feat: add forkToWorktree to lifecycle manager and chat manager"
```

---

## Task 4: Add Branch Name Validation Schema and HTTP Routes

**Files:**
- Create: `packages/core/src/server/routes/worktree.ts`
- Modify: `packages/core/src/server/routes/index.ts`

- [ ] **Step 1: Create the worktree routes file**

Create `packages/core/src/server/routes/worktree.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('routes:worktree');

const branchNameSchema = z
  .string()
  .min(1, 'Branch name is required')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/, 'Invalid branch name')
  .refine((s) => !s.includes('..'), 'Branch name cannot contain ".."');

const EnableWorktreeBody = z.object({
  baseBranch: z.string().min(1, 'Base branch is required'),
  branchName: branchNameSchema,
});

const ForkWorktreeBody = z.object({
  baseBranch: z.string().min(1, 'Base branch is required'),
  branchName: branchNameSchema,
});

export function worktreeRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/chats/:id/enable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = EnableWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      try {
        await ctx.chats.enableWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enable worktree';
        log.warn({ err, chatId }, 'enable-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  router.post(
    '/api/chats/:id/disable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      try {
        await ctx.chats.disableWorktree(chatId);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to disable worktree';
        log.warn({ err, chatId }, 'disable-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  router.post(
    '/api/chats/:id/fork-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = ForkWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      try {
        const result = await ctx.chats.forkToWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        res.json({ success: true, chatId: result.chatId });
      } catch (err) {
        const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
        const message = err instanceof Error ? err.message : 'Failed to fork to worktree';
        log.warn({ err, chatId }, 'fork-worktree failed');
        res.status(statusCode).json({ error: message });
      }
    }),
  );

  return router;
}
```

- [ ] **Step 2: Mount routes in `index.ts`**

In `packages/core/src/server/routes/index.ts`, add the import and mount the router. Find the pattern used by other route files (e.g., `chatRoutes(ctx)`), then add:

```ts
import { worktreeRoutes } from './worktree.js';
```

And in the function body where routes are mounted:

```ts
app.use(worktreeRoutes(ctx));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/server/routes/worktree.ts packages/core/src/server/routes/index.ts
git commit -m "feat: add HTTP endpoints for enable/disable/fork worktree"
```

---

## Task 5: Write Route Tests

**Files:**
- Create: `packages/core/src/__tests__/routes/worktree.test.ts`

- [ ] **Step 1: Write route tests**

Create `packages/core/src/__tests__/routes/worktree.test.ts`. Follow the pattern of existing route tests in the project. Test:

1. `POST /api/chats/:id/enable-worktree` with valid body returns 200
2. `POST /api/chats/:id/enable-worktree` with invalid branch name returns 400
3. `POST /api/chats/:id/enable-worktree` with `..` in branch name returns 400
4. `POST /api/chats/:id/disable-worktree` returns 200
5. `POST /api/chats/:id/fork-worktree` with valid body returns 200 with `chatId`
6. `POST /api/chats/:id/fork-worktree` when dirty returns 409

Check existing test files in `packages/core/src/__tests__/routes/` for the testing pattern (whether they use supertest, mock `ChatManager`, etc.) and follow that pattern exactly.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run src/__tests__/routes/worktree.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/routes/worktree.test.ts
git commit -m "test: add route tests for worktree HTTP endpoints"
```

---

## Task 6: Remove WS Events for Worktree

**Files:**
- Modify: `packages/types/src/events.ts:55-56`
- Modify: `packages/core/src/server/ws-schemas.ts:74-82,94-106`
- Modify: `packages/core/src/server/websocket.ts:164-172`
- Modify: `packages/desktop/src/renderer/lib/client.ts:182-190`

- [ ] **Step 1: Remove `ClientEvent` variants from types**

In `packages/types/src/events.ts`, remove lines 55-56:

```ts
// DELETE these two lines:
| { type: 'chat.enableWorktree'; chatId: string }
| { type: 'chat.disableWorktree'; chatId: string }
```

- [ ] **Step 2: Remove WS schemas**

In `packages/core/src/server/ws-schemas.ts`:

Remove the `ChatEnableWorktree` and `ChatDisableWorktree` schema objects (lines 74-82).

Remove `ChatEnableWorktree` and `ChatDisableWorktree` from the `ClientEventSchema` discriminatedUnion array (lines 102-103).

- [ ] **Step 3: Remove WS handlers**

In `packages/core/src/server/websocket.ts`, remove the two `case` blocks (lines 164-172):

```ts
// DELETE these cases:
case 'chat.enableWorktree': { ... }
case 'chat.disableWorktree': { ... }
```

- [ ] **Step 4: Remove WS client methods**

In `packages/desktop/src/renderer/lib/client.ts`, remove `enableWorktree` and `disableWorktree` methods (lines 182-190).

- [ ] **Step 5: Typecheck both packages**

Run: `pnpm build`
Expected: PASS (ComposerCard.tsx still references the old methods but will be updated in Task 8).

If typecheck fails due to ComposerCard referencing the removed methods, that's expected — note it and proceed. Task 8 will fix it.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/events.ts packages/core/src/server/ws-schemas.ts packages/core/src/server/websocket.ts packages/desktop/src/renderer/lib/client.ts
git commit -m "refactor: remove worktree WS events, replaced by HTTP endpoints"
```

---

## Task 7: Add Client API Helpers

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/worktree-api.ts`
- Modify: `packages/desktop/src/renderer/lib/api/index.ts`

- [ ] **Step 1: Create `worktree-api.ts`**

Create `packages/desktop/src/renderer/lib/api/worktree-api.ts`:

```ts
import { API_BASE, postJson } from './http';

export async function enableWorktree(
  chatId: string,
  baseBranch: string,
  branchName: string,
): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/enable-worktree`, { baseBranch, branchName });
}

export async function disableWorktree(chatId: string): Promise<void> {
  await postJson(`${API_BASE}/api/chats/${chatId}/disable-worktree`);
}

export async function forkToWorktree(
  chatId: string,
  baseBranch: string,
  branchName: string,
): Promise<{ chatId: string }> {
  return postJson<{ chatId: string }>(`${API_BASE}/api/chats/${chatId}/fork-worktree`, { baseBranch, branchName });
}
```

- [ ] **Step 2: Export from `index.ts`**

In `packages/desktop/src/renderer/lib/api/index.ts`, add:

```ts
export { enableWorktree, disableWorktree, forkToWorktree } from './worktree-api';
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/worktree-api.ts packages/desktop/src/renderer/lib/api/index.ts
git commit -m "feat: add client HTTP helpers for worktree operations"
```

---

## Task 8: Build the WorktreePopover Component

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx:326-349`

- [ ] **Step 1: Create `WorktreePopover.tsx`**

Create `packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, GitBranch, Loader2 } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { useActiveProjectId } from '../../../../hooks/useActiveProjectId';
import { getGitBranches, enableWorktree, disableWorktree, forkToWorktree } from '../../../../lib/api';

const BRANCH_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name is required';
  if (!BRANCH_NAME_REGEX.test(name)) return 'Invalid characters in branch name';
  if (name.includes('..')) return 'Branch name cannot contain ".."';
  return null;
}

interface WorktreePopoverProps {
  chatId: string;
  hasMessages: boolean;
  onClose: () => void;
}

export function WorktreePopover({ chatId, hasMessages, onClose }: WorktreePopoverProps): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const setActiveChatId = useChatsStore((s) => s.setActiveChatId);

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [baseBranch, setBaseBranch] = useState('');
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch branches on mount
  useEffect(() => {
    if (!activeProjectId) return;
    setLoading(true);
    getGitBranches(activeProjectId)
      .then((data) => {
        const localNames = data.local.map((b: { name: string }) => b.name);
        setBranches(localNames);
        setCurrentBranch(data.current);
        setBaseBranch(data.current);
        if (!hasMessages) {
          // Pre-session: default branch name
          setBranchName(`session/${chatId.slice(0, 8)}`);
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [activeProjectId, chatId, hasMessages]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleEnable = useCallback(async () => {
    const nameError = validateBranchName(branchName);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await enableWorktree(chatId, baseBranch, branchName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable worktree');
    } finally {
      setSubmitting(false);
    }
  }, [chatId, baseBranch, branchName, onClose]);

  const handleDisable = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await disableWorktree(chatId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable worktree');
    } finally {
      setSubmitting(false);
    }
  }, [chatId, onClose]);

  const handleFork = useCallback(async () => {
    const nameError = validateBranchName(branchName);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await forkToWorktree(chatId, baseBranch, branchName);
      setActiveChatId(result.chatId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fork');
    } finally {
      setSubmitting(false);
    }
  }, [chatId, baseBranch, branchName, setActiveChatId, onClose]);

  // State 3: Active info (worktree already enabled)
  if (chat?.worktreePath) {
    return (
      <div ref={popoverRef} className="absolute bottom-full left-0 mb-1 z-50 w-64 bg-mf-surface border border-mf-border rounded-mf-card p-3 shadow-lg">
        <div className="text-mf-label uppercase tracking-wide text-mf-text-secondary mb-2">Worktree Active</div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-mf-success" />
          <span className="text-mf-small text-mf-success font-medium">Isolated</span>
        </div>
        <div className="mb-2">
          <span className="text-mf-label text-mf-text-secondary">Branch</span>
          <div className="mt-1 px-2 py-1.5 bg-mf-input rounded-mf-input text-mf-small font-mono text-mf-accent">
            {chat.branchName}
          </div>
        </div>
        <div>
          <span className="text-mf-label text-mf-text-secondary">Path</span>
          <div className="mt-1 px-2 py-1.5 bg-mf-input rounded-mf-input text-mf-label font-mono text-mf-text-secondary break-all">
            {chat.worktreePath}
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div ref={popoverRef} className="absolute bottom-full left-0 mb-1 z-50 w-64 bg-mf-surface border border-mf-border rounded-mf-card p-4 shadow-lg flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-mf-text-secondary" />
      </div>
    );
  }

  const isForking = hasMessages && !chat?.worktreePath;
  const title = isForking ? 'Fork to Worktree' : 'Configure Worktree';
  const actionLabel = isForking ? 'Fork' : 'Enable';
  const handleAction = isForking ? handleFork : handleEnable;

  return (
    <div ref={popoverRef} className="absolute bottom-full left-0 mb-1 z-50 w-72 bg-mf-surface border border-mf-border rounded-mf-card p-3 shadow-lg">
      <div className="text-mf-label uppercase tracking-wide text-mf-text-secondary mb-3">{title}</div>

      {isForking && (
        <div className="flex items-start gap-2 mb-3 p-2 rounded-mf-input bg-mf-warning/10 border border-mf-warning/20">
          <AlertTriangle size={14} className="text-mf-warning shrink-0 mt-0.5" />
          <span className="text-mf-label text-mf-warning">
            This will create a new chat with worktree isolation. Uncommitted changes and conversation context from this session will not be carried over.
          </span>
        </div>
      )}

      {/* Base branch selector */}
      <div className="mb-3">
        <label className="text-mf-label text-mf-text-secondary mb-1 block">Base branch</label>
        <select
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          className="w-full px-2 py-1.5 bg-mf-input border border-mf-border rounded-mf-input text-mf-small text-mf-text-primary"
        >
          {branches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* Branch name input */}
      <div className="mb-3">
        <label className="text-mf-label text-mf-text-secondary mb-1 block">Branch name</label>
        <input
          type="text"
          value={branchName}
          onChange={(e) => {
            setBranchName(e.target.value);
            setError(null);
          }}
          placeholder="feat/my-feature"
          className="w-full px-2 py-1.5 bg-mf-input border border-mf-border rounded-mf-input text-mf-small text-mf-text-primary placeholder:text-mf-text-secondary/50"
        />
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-3 text-mf-label text-mf-destructive">{error}</div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!hasMessages && chat?.worktreePath === undefined && (
          <>
            <button
              onClick={() => void handleAction()}
              disabled={submitting}
              className="flex-1 px-3 py-1.5 bg-mf-accent text-white rounded-mf-input text-mf-small font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Working...' : actionLabel}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 bg-mf-input text-mf-text-secondary rounded-mf-input text-mf-small hover:text-mf-text-primary transition-colors"
            >
              Cancel
            </button>
          </>
        )}
        {isForking && (
          <>
            <button
              onClick={() => void handleFork()}
              disabled={submitting}
              className="flex-1 px-3 py-1.5 bg-mf-accent text-white rounded-mf-input text-mf-small font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Forking...' : 'Fork'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 bg-mf-input text-mf-text-secondary rounded-mf-input text-mf-small hover:text-mf-text-primary transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Disable button when pre-session and already enabled */}
      {!hasMessages && chat?.worktreePath && (
        <button
          onClick={() => void handleDisable()}
          disabled={submitting}
          className="w-full mt-2 px-3 py-1.5 bg-mf-input text-mf-text-secondary rounded-mf-input text-mf-small hover:text-mf-destructive transition-colors"
        >
          Disable Worktree
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace toggle button in ComposerCard**

In `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`:

Add import at the top:

```ts
import { WorktreePopover } from './WorktreePopover';
```

Add state for popover visibility inside the component:

```ts
const [worktreePopoverOpen, setWorktreePopoverOpen] = useState(false);
```

Replace the existing worktree toggle button block (lines 326-349, the `{!hasMessages && (...)}` block) with:

```tsx
<div className="relative">
  <button
    type="button"
    onClick={() => setWorktreePopoverOpen((o) => !o)}
    className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small transition-colors ${
      chat?.worktreePath
        ? 'text-mf-accent bg-mf-hover'
        : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
    }`}
    title={chat?.worktreePath ? `Branch: ${chat.branchName}` : 'Worktree isolation'}
    aria-label={chat?.worktreePath ? `Worktree on branch ${chat.branchName}` : 'Worktree isolation'}
  >
    <GitBranch size={12} />
  </button>
  {worktreePopoverOpen && chatId && (
    <WorktreePopover
      chatId={chatId}
      hasMessages={hasMessages}
      onClose={() => setWorktreePopoverOpen(false)}
    />
  )}
</div>
```

Note: the button is now always visible (not gated by `!hasMessages`), since mid-session shows the fork option and active sessions show info.

- [ ] **Step 3: Remove old `daemonClient.enableWorktree`/`disableWorktree` imports if still referenced**

In `ComposerCard.tsx`, remove the `daemonClient.enableWorktree` and `daemonClient.disableWorktree` calls — they're replaced by the popover's HTTP calls.

- [ ] **Step 4: Typecheck and visually verify**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx
git commit -m "feat: add unified WorktreePopover component replacing toggle button"
```

---

## Task 9: Add Worktree Awareness — Title Bar

**Files:**
- Modify: `packages/desktop/src/renderer/components/TitleBar.tsx:25-28,81`

- [ ] **Step 1: Add worktree branch to title bar**

In `packages/desktop/src/renderer/components/TitleBar.tsx`:

Add import for chat store:

```ts
import { useChatsStore } from '../store/chats';
```

Inside the component, after `activeProjectName` (line 28), add:

```ts
const activeChatId = useChatsStore((s) => s.activeChatId);
const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
const worktreeBranch = activeChat?.branchName;
```

Replace the project name span (line 81):

```tsx
<span className="text-mf-body font-medium text-mf-text-primary">
  {activeProjectName}
  {worktreeBranch && (
    <span className="text-mf-text-secondary font-normal"> / {worktreeBranch}</span>
  )}
</span>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/TitleBar.tsx
git commit -m "feat: show worktree branch name in title bar"
```

---

## Task 10: Add Worktree Awareness — File Tree Header

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx:232-234`

- [ ] **Step 1: Update file tree header to use worktree path**

In `packages/desktop/src/renderer/components/panels/FilesTab.tsx`:

Find where `activeChatId` is used (should already be available in the component). Find the active chat to get `worktreePath`. Near the top of the `FilesTab` component, add:

```ts
const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
const displayPath = activeChat?.worktreePath ?? activeProject.path;
```

(Add `useChatsStore` import if not already present.)

Replace the header path display (lines 232-234):

```tsx
<span className="truncate" title={displayPath}>
  {displayPath}
</span>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx
git commit -m "feat: show worktree path in file tree header"
```

---

## Task 11: Add Worktree Awareness — Changes Tab

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/ChangesTab.tsx:31-38,117-122`

- [ ] **Step 1: Add worktree badge to changes tab header**

In `packages/desktop/src/renderer/components/panels/ChangesTab.tsx`:

Add import:

```ts
import { useChatsStore as useChatsStoreBase } from '../../store/chats';
```

(Check if `useChatsStore` is already imported — if so, use it directly.)

Inside the `ChangesTab` component, add after existing state declarations:

```ts
const activeChat = useChatsStoreBase((s) => s.chats.find((c) => c.id === s.activeChatId));
```

In the header row area (after the file count span, around line 122), add the worktree badge:

```tsx
{activeChat?.branchName && activeChat?.worktreePath && (
  <span className="text-mf-label text-mf-accent" title={activeChat.worktreePath}>
    Worktree: {activeChat.branchName}
  </span>
)}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ChangesTab.tsx
git commit -m "feat: show worktree badge in changes tab"
```

---

## Task 12: Add Worktree Awareness — Branch Popover

**Files:**
- Modify: `packages/desktop/src/renderer/components/git/BranchPopover.tsx:12-16,18`

- [ ] **Step 1: Add worktree isolation banner**

In `packages/desktop/src/renderer/components/git/BranchPopover.tsx`:

Add import:

```ts
import { useChatsStore } from '../../store/chats';
```

Inside the `BranchPopover` component, near the top:

```ts
const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
```

In the JSX, at the top of the popover content (just inside the outer container div), add:

```tsx
{activeChat?.worktreePath && (
  <div className="flex items-center gap-2 px-3 py-2 mb-1 text-mf-label text-mf-accent bg-mf-accent/10 rounded-mf-input">
    <GitBranch size={12} />
    <span>Working in worktree isolation</span>
  </div>
)}
```

Add `GitBranch` to the lucide-react import if not already present.

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/git/BranchPopover.tsx
git commit -m "feat: show worktree isolation banner in branch popover"
```

---

## Task 13: Final Integration Check

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: PASS with no errors.

- [ ] **Step 2: Run all relevant tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run`
Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-core build && pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: PASS

- [ ] **Step 4: Add changeset**

Run: `pnpm changeset`

Pick affected packages:
- `@qlan-ro/mainframe-types` (minor — removed ClientEvent variants)
- `@qlan-ro/mainframe-core` (minor — new endpoints, updated createWorktree)
- `@qlan-ro/mainframe-desktop` (minor — new popover, awareness indicators)

Bump type: minor for all.

Summary: "Add base branch selector, custom branch naming, fork-to-worktree, and worktree awareness indicators"

- [ ] **Step 5: Final commit**

```bash
git add .changeset/
git commit -m "chore: add changeset for advanced worktree support"
```
