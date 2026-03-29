# Mid-Session Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow enabling or attaching a worktree on a chat that already has a running CLI session, by stopping the session, migrating CLI session files to the new project path, and respawning.

**Architecture:** The `ChatConfigManager` methods `enableWorktree` and `attachWorktree` currently reject when `claudeSessionId` is set. We lift that guard and add a mid-session path: kill the process, move the CLI's session files (`~/.claude/projects/<encoded-old>/` → `~/.claude/projects/<encoded-new>/`), update chat metadata, and respawn with `--resume`. A new `moveSessionFiles()` utility handles the file migration. The UI already supports mid-session worktree toggling via `WorktreePopover` — it just needs backend support.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest

---

### Task 1: Add `moveSessionFiles` utility

**Files:**
- Create: `packages/core/src/workspace/session-files.ts`
- Create: `packages/core/src/__tests__/workspace/session-files.test.ts`
- Modify: `packages/core/src/workspace/index.ts`

- [ ] **Step 1: Write the failing test for `getClaudeProjectDir`**

```typescript
// packages/core/src/__tests__/workspace/session-files.test.ts
import { describe, it, expect } from 'vitest';
import { getClaudeProjectDir } from '../../workspace/session-files.js';
import { homedir } from 'node:os';
import path from 'node:path';

describe('getClaudeProjectDir', () => {
  it('encodes project path into claude projects directory', () => {
    const result = getClaudeProjectDir('/Users/foo/my-project');
    expect(result).toBe(path.join(homedir(), '.claude', 'projects', '-Users-foo-my-project'));
  });

  it('replaces non-alphanumeric characters except hyphens', () => {
    const result = getClaudeProjectDir('/tmp/test.dir/sub');
    expect(result).toBe(path.join(homedir(), '.claude', 'projects', '-tmp-test-dir-sub'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/workspace/session-files.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `getClaudeProjectDir`**

```typescript
// packages/core/src/workspace/session-files.ts
import { homedir } from 'node:os';
import path from 'node:path';

export function getClaudeProjectDir(projectPath: string): string {
  const encoded = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(homedir(), '.claude', 'projects', encoded);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/workspace/session-files.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `moveSessionFiles`**

This test creates a temporary directory structure mimicking `~/.claude/projects/<encoded>/` with a JSONL file, a session directory with subagents and tool-results, and a sidechain JSONL. It calls `moveSessionFiles` and asserts all files moved to the target.

```typescript
// append to packages/core/src/__tests__/workspace/session-files.test.ts
import { moveSessionFiles } from '../../workspace/session-files.js';
import { mkdtemp, writeFile, mkdir, readdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('moveSessionFiles', () => {
  const SESSION_ID = 'abc-123';

  async function setupSourceDir(): Promise<{ srcBase: string; tgtBase: string }> {
    const base = await mkdtemp(path.join(tmpdir(), 'session-files-'));
    const srcBase = path.join(base, 'source');
    const tgtBase = path.join(base, 'target');

    // Main JSONL
    await mkdir(srcBase, { recursive: true });
    await writeFile(path.join(srcBase, `${SESSION_ID}.jsonl`), '{"sessionId":"abc-123"}\n');

    // Session directory with subagents and tool-results
    await mkdir(path.join(srcBase, SESSION_ID, 'subagents'), { recursive: true });
    await writeFile(path.join(srcBase, SESSION_ID, 'subagents', 'agent-a1.jsonl'), 'subagent data');
    await writeFile(path.join(srcBase, SESSION_ID, 'subagents', 'agent-a1.meta.json'), '{}');
    await mkdir(path.join(srcBase, SESSION_ID, 'tool-results'), { recursive: true });
    await writeFile(path.join(srcBase, SESSION_ID, 'tool-results', 'toolu_01.txt'), 'tool output');

    // Sidechain JSONL (first line has matching sessionId)
    await writeFile(path.join(srcBase, `sidechain-999.jsonl`), `{"sessionId":"${SESSION_ID}"}\n`);

    // Unrelated JSONL (should NOT be moved)
    await writeFile(path.join(srcBase, 'other-session.jsonl'), '{"sessionId":"other"}\n');

    return { srcBase, tgtBase };
  }

  it('moves JSONL, session dir, and sidechain files to target', async () => {
    const { srcBase, tgtBase } = await setupSourceDir();

    await moveSessionFiles(SESSION_ID, srcBase, tgtBase);

    // Target has the files
    const tgtEntries = await readdir(tgtBase, { recursive: true });
    expect(tgtEntries).toContain(`${SESSION_ID}.jsonl`);
    expect(tgtEntries).toContain(SESSION_ID);
    expect(tgtEntries).toContain(`sidechain-999.jsonl`);

    // Content preserved
    const content = await readFile(path.join(tgtBase, SESSION_ID, 'subagents', 'agent-a1.jsonl'), 'utf-8');
    expect(content).toBe('subagent data');

    // Source files removed
    await expect(access(path.join(srcBase, `${SESSION_ID}.jsonl`))).rejects.toThrow();
    await expect(access(path.join(srcBase, SESSION_ID))).rejects.toThrow();
    await expect(access(path.join(srcBase, 'sidechain-999.jsonl'))).rejects.toThrow();

    // Unrelated file stays
    const otherContent = await readFile(path.join(srcBase, 'other-session.jsonl'), 'utf-8');
    expect(otherContent).toContain('other');
  });

  it('works when session directory does not exist', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'session-files-'));
    const srcBase = path.join(base, 'source');
    const tgtBase = path.join(base, 'target');

    await mkdir(srcBase, { recursive: true });
    await writeFile(path.join(srcBase, `${SESSION_ID}.jsonl`), '{"sessionId":"abc-123"}\n');

    await moveSessionFiles(SESSION_ID, srcBase, tgtBase);

    const content = await readFile(path.join(tgtBase, `${SESSION_ID}.jsonl`), 'utf-8');
    expect(content).toContain('abc-123');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/workspace/session-files.test.ts`
Expected: FAIL — `moveSessionFiles` not exported

- [ ] **Step 7: Implement `moveSessionFiles`**

```typescript
// append to packages/core/src/workspace/session-files.ts
import { mkdir, rename, readdir, readFile, cp, rm, access, constants } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Move a CLI session's files from one Claude project dir to another. */
export async function moveSessionFiles(
  sessionId: string,
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  // 1. Move main JSONL
  await moveFile(
    path.join(sourceDir, `${sessionId}.jsonl`),
    path.join(targetDir, `${sessionId}.jsonl`),
  );

  // 2. Move session directory (subagents + tool-results)
  const sessionDir = path.join(sourceDir, sessionId);
  try {
    await access(sessionDir, constants.R_OK);
    await moveFile(sessionDir, path.join(targetDir, sessionId));
  } catch {
    // No session directory — that's fine
  }

  // 3. Move sidechain JSONL files that reference this session
  try {
    const entries = await readdir(sourceDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl') || entry === `${sessionId}.jsonl`) continue;
      const filePath = path.join(sourceDir, entry);
      if (await isSidechainOf(filePath, sessionId)) {
        await moveFile(filePath, path.join(targetDir, entry));
      }
    }
  } catch {
    // Directory read failed — proceed without sidechains
  }
}

async function isSidechainOf(filePath: string, sessionId: string): Promise<boolean> {
  const stream = createReadStream(filePath);
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const first = JSON.parse(line);
      return first.sessionId === sessionId;
    }
  } catch {
    // Unreadable — skip
  } finally {
    stream.destroy();
  }
  return false;
}

/** Move a file or directory, falling back to copy+delete for cross-device moves. */
async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await cp(src, dest, { recursive: true });
      await rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/workspace/session-files.test.ts`
Expected: PASS

- [ ] **Step 9: Export from workspace index**

Add `moveSessionFiles` and `getClaudeProjectDir` to `packages/core/src/workspace/index.ts`:

```typescript
export { moveSessionFiles, getClaudeProjectDir } from './session-files.js';
```

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/workspace/session-files.ts packages/core/src/__tests__/workspace/session-files.test.ts packages/core/src/workspace/index.ts
git commit -m "feat: add moveSessionFiles utility for CLI session migration"
```

---

### Task 2: Add mid-session support to `enableWorktree` and `attachWorktree`

**Files:**
- Modify: `packages/core/src/chat/config-manager.ts`
- Create: `packages/core/src/__tests__/chat/mid-session-worktree.test.ts`

- [ ] **Step 1: Write the failing test for mid-session `enableWorktree`**

```typescript
// packages/core/src/__tests__/chat/mid-session-worktree.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatConfigManager, type ConfigManagerDeps } from '../../chat/config-manager.js';
import type { Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from '../../chat/types.js';

// Mock the workspace modules
vi.mock('../../workspace/index.js', () => ({
  createWorktree: vi.fn(() => ({ worktreePath: '/repo/.worktrees/my-branch', branchName: 'my-branch' })),
  removeWorktree: vi.fn(),
  moveSessionFiles: vi.fn(async () => {}),
  getClaudeProjectDir: vi.fn((p: string) => `/home/.claude/projects/${p.replace(/[^a-zA-Z0-9-]/g, '-')}`),
}));

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    projectId: 'proj-1',
    adapterId: 'claude',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Chat;
}

function makeDeps(active: ActiveChat): ConfigManagerDeps {
  return {
    adapters: { get: vi.fn() } as any,
    db: {
      chats: { update: vi.fn() },
      projects: { get: vi.fn(() => ({ id: 'proj-1', path: '/repo' })) },
      settings: { get: vi.fn(() => '.worktrees') },
    } as any,
    startingChats: new Map(),
    getActiveChat: vi.fn(() => active),
    startChat: vi.fn(async () => {}),
    stopChat: vi.fn(async () => {}),
    emitEvent: vi.fn(),
  };
}

describe('mid-session enableWorktree', () => {
  it('stops session, moves files, creates worktree, and restarts', async () => {
    const chat = makeChat({ claudeSessionId: 'sess-1' });
    const active: ActiveChat = { chat, session: { isSpawned: true, kill: vi.fn() } as any };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.enableWorktree('chat-1', 'main', 'my-branch');

    // Session was stopped
    expect(deps.stopChat).toHaveBeenCalledWith('chat-1');

    // Session files moved
    const { moveSessionFiles } = await import('../../workspace/index.js');
    expect(moveSessionFiles).toHaveBeenCalledWith(
      'sess-1',
      expect.stringContaining('-repo'),
      expect.stringContaining('worktrees'),
    );

    // Chat metadata updated
    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/my-branch',
      branchName: 'my-branch',
    });

    // Session restarted
    expect(deps.startChat).toHaveBeenCalledWith('chat-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/chat/mid-session-worktree.test.ts`
Expected: FAIL — `stopChat` not in `ConfigManagerDeps`, `enableWorktree` throws on `claudeSessionId`

- [ ] **Step 3: Add `stopChat` to `ConfigManagerDeps`**

In `packages/core/src/chat/config-manager.ts`, add `stopChat` to the deps interface:

```typescript
export interface ConfigManagerDeps {
  adapters: AdapterRegistry;
  db: DatabaseManager;
  startingChats: Map<string, Promise<void>>;
  getActiveChat: (chatId: string) => ActiveChat | undefined;
  startChat: (chatId: string) => Promise<void>;
  stopChat: (chatId: string) => Promise<void>;
  emitEvent: (event: DaemonEvent) => void;
}
```

- [ ] **Step 4: Implement mid-session `enableWorktree`**

Replace the `enableWorktree` method in `packages/core/src/chat/config-manager.ts`:

```typescript
import { createWorktree, removeWorktree, moveSessionFiles, getClaudeProjectDir } from '../workspace/index.js';

async enableWorktree(chatId: string, baseBranch: string, branchName: string): Promise<void> {
  const active = this.deps.getActiveChat(chatId);
  if (!active) throw new Error(`Chat ${chatId} not found`);
  if (active.chat.worktreePath) return;

  const project = this.deps.db.projects.get(active.chat.projectId);
  if (!project) throw new Error('Project not found');

  const worktreeDir = this.deps.db.settings.get('general', 'worktreeDir') ?? GENERAL_DEFAULTS.worktreeDir;

  if (active.chat.claudeSessionId) {
    // Mid-session: stop → create worktree → move files → update → restart
    await this.deps.stopChat(chatId);

    const info = createWorktree(project.path, chatId, worktreeDir, baseBranch, branchName);
    const sourceDir = getClaudeProjectDir(project.path);
    const targetDir = getClaudeProjectDir(info.worktreePath);
    await moveSessionFiles(active.chat.claudeSessionId, sourceDir, targetDir);

    active.chat.worktreePath = info.worktreePath;
    active.chat.branchName = info.branchName;
    this.deps.db.chats.update(chatId, { worktreePath: info.worktreePath, branchName: info.branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
    await this.deps.startChat(chatId);
  } else {
    // Pre-session: existing logic
    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }

    const info = createWorktree(project.path, chatId, worktreeDir, baseBranch, branchName);
    active.chat.worktreePath = info.worktreePath;
    active.chat.branchName = info.branchName;
    this.deps.db.chats.update(chatId, { worktreePath: info.worktreePath, branchName: info.branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/chat/mid-session-worktree.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for mid-session `attachWorktree`**

```typescript
// append to packages/core/src/__tests__/chat/mid-session-worktree.test.ts
describe('mid-session attachWorktree', () => {
  it('stops session, moves files, and restarts', async () => {
    const chat = makeChat({ claudeSessionId: 'sess-2' });
    const active: ActiveChat = { chat, session: { isSpawned: true, kill: vi.fn() } as any };
    const deps = makeDeps(active);

    const manager = new ChatConfigManager(deps);
    await manager.attachWorktree('chat-1', '/repo/.worktrees/existing-branch', 'existing-branch');

    expect(deps.stopChat).toHaveBeenCalledWith('chat-1');

    const { moveSessionFiles } = await import('../../workspace/index.js');
    expect(moveSessionFiles).toHaveBeenCalledWith(
      'sess-2',
      expect.stringContaining('-repo'),
      expect.stringContaining('existing-branch'),
    );

    expect(deps.db.chats.update).toHaveBeenCalledWith('chat-1', {
      worktreePath: '/repo/.worktrees/existing-branch',
      branchName: 'existing-branch',
    });

    expect(deps.startChat).toHaveBeenCalledWith('chat-1');
  });
});
```

- [ ] **Step 7: Implement mid-session `attachWorktree`**

Replace the `attachWorktree` method in `packages/core/src/chat/config-manager.ts`:

```typescript
async attachWorktree(chatId: string, worktreePath: string, branchName: string): Promise<void> {
  const active = this.deps.getActiveChat(chatId);
  if (!active) throw new Error(`Chat ${chatId} not found`);
  if (active.chat.worktreePath) return;

  if (active.chat.claudeSessionId) {
    // Mid-session: stop → move files → update → restart
    const project = this.deps.db.projects.get(active.chat.projectId);
    if (!project) throw new Error('Project not found');

    await this.deps.stopChat(chatId);

    const sourceDir = getClaudeProjectDir(project.path);
    const targetDir = getClaudeProjectDir(worktreePath);
    await moveSessionFiles(active.chat.claudeSessionId, sourceDir, targetDir);

    active.chat.worktreePath = worktreePath;
    active.chat.branchName = branchName;
    this.deps.db.chats.update(chatId, { worktreePath, branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
    await this.deps.startChat(chatId);
  } else {
    // Pre-session: existing logic
    if (active.session?.isSpawned) {
      await active.session.kill();
      active.session = null;
    }

    active.chat.worktreePath = worktreePath;
    active.chat.branchName = branchName;
    this.deps.db.chats.update(chatId, { worktreePath, branchName });
    this.deps.emitEvent({ type: 'chat.updated', chat: active.chat });
  }
}
```

- [ ] **Step 8: Run all tests to verify**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/chat/mid-session-worktree.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/chat/config-manager.ts packages/core/src/__tests__/chat/mid-session-worktree.test.ts
git commit -m "feat: support mid-session enableWorktree and attachWorktree"
```

---

### Task 3: Wire `stopChat` into `ChatManager`

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts`
- Modify: `packages/core/src/chat/lifecycle-manager.ts`

- [ ] **Step 1: Add `stopChat` to `ChatLifecycleManager`**

This method kills the session and clears it from `activeChats` without archiving or ending the chat. In `packages/core/src/chat/lifecycle-manager.ts`, add after the `endChat` method:

```typescript
/** Stop a running session without ending the chat. Used for mid-session reconfiguration. */
async stopChat(chatId: string): Promise<void> {
  const active = this.deps.activeChats.get(chatId);
  if (!active?.session) return;

  if (active.session.isSpawned) {
    await active.session.kill();
  }
  active.session = null;
}
```

- [ ] **Step 2: Wire `stopChat` into `ChatManager`'s `ConfigManager` deps**

In `packages/core/src/chat/chat-manager.ts`, update the `ChatConfigManager` constructor call to include `stopChat`:

```typescript
this.configManager = new ChatConfigManager({
  adapters: this.adapters,
  db: this.db,
  startingChats: this.lifecycle.getStartingChats(),
  getActiveChat: (chatId) => this.activeChats.get(chatId),
  startChat: (chatId) => this.lifecycle.startChat(chatId),
  stopChat: (chatId) => this.lifecycle.stopChat(chatId),
  emitEvent: (event) => this.emitEvent(event),
});
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/routes/worktree.test.ts`
Expected: PASS

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts packages/core/src/chat/chat-manager.ts
git commit -m "feat: wire stopChat for mid-session worktree reconfiguration"
```

---

### Task 4: Remove UI session guard

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx`

- [ ] **Step 1: Verify the current guard behavior**

The `WorktreePopover` receives `hasMessages: boolean` and sets `isMidSession = hasMessages` (line 265). When `isMidSession` is true, it currently hides the existing worktree list (line 312) and only shows the "new" form (line 341). The backend now handles mid-session, so the UI should allow both "new" and "attach" flows regardless of session state.

Read the file to confirm the exact current behavior before editing.

- [ ] **Step 2: Enable the "attach" tab during mid-session**

In `WorktreePopover.tsx`, the existing worktree list is gated on `!isMidSession`. Remove that condition so users can attach existing worktrees mid-session. The exact edit depends on the current code — read lines around 310-345 and remove the `!isMidSession` guard on rendering the worktree list / attach tab.

- [ ] **Step 3: Smoke test in the app**

Build and verify in the running app:
Run: `pnpm build`

Open a chat, send a message, then open the worktree popover. Both "New" and existing worktree options should be available.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/WorktreePopover.tsx
git commit -m "feat: allow worktree enable/attach during active session in UI"
```

---

### Task 5: Changeset and final verification

**Files:**
- Create: `.changeset/*.md`

- [ ] **Step 1: Run the full test suite for core**

Run: `pnpm --filter @qlan-ro/mainframe-core test`
Expected: All pass

- [ ] **Step 2: Typecheck all packages**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Create changeset**

Run: `pnpm changeset`

Pick `@qlan-ro/mainframe-core` (minor) and `@qlan-ro/mainframe-desktop` (patch):

```markdown
---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': patch
---

feat: support enabling and attaching worktrees mid-session

When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.
```

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for mid-session worktree"
```
