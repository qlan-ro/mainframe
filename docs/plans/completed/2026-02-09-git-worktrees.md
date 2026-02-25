# Git Worktrees for Session Isolation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow sessions to optionally run in a git worktree so parallel sessions don't step on each other's files.

**Architecture:** A worktree toggle in the composer (pre-first-message) lets the user opt in. When toggled, the daemon creates a git worktree (`git worktree add`), stores the path on the Chat record, and the adapter (lazily spawned on first message) runs in the worktree dir. All file/git HTTP endpoints accept an optional `chatId` query param to resolve against the worktree path. On archive, the worktree is cleaned up. A branch badge in the session bar shows which branch the session is on. Merge is out of scope for MVP — users handle it via git.

**Key code patterns (current state):**
- `createChat()` creates DB record + emits event (no process spawn)
- `loadChat()` loads history/mentions/plan files from adapter disk storage
- `startChat()` calls `loadChat()` then spawns the adapter process
- `sendMessage()` has lazy-start: calls `startChat()` if no process running
- `chat.create` WS handler: `createChat()` → `startChat()` (eager spawn)
- `chat.resume` WS handler: `loadChat()` only (lazy spawn via sendMessage)
- `process.started` events include `chatId`

**Tech Stack:** TypeScript, Node.js `child_process.execSync`, SQLite (ALTER TABLE migrations), React/Tailwind (Electron renderer)

---

## Task 1: Types — Add worktree fields to Chat and ClientEvent

**Files:**
- Modify: `packages/types/src/chat.ts`
- Modify: `packages/types/src/events.ts`

**Step 1: Add fields to Chat interface**

In `packages/types/src/chat.ts`, add to the `Chat` interface (after `modifiedFiles`):

```typescript
worktreePath?: string;
branchName?: string;
```

**Step 2: Add worktree client events**

In `packages/types/src/events.ts`, add two new variants to the `ClientEvent` union:

```typescript
| { type: 'chat.enableWorktree'; chatId: string }
| { type: 'chat.disableWorktree'; chatId: string }
```

**Step 3: Build types**

Run: `pnpm --filter @mainframe/types build`

**Step 4: Commit**

```bash
git add packages/types/src/chat.ts packages/types/src/events.ts
git commit -m "feat(types): add worktreePath/branchName to Chat, worktree client events"
```

---

## Task 2: Database — Migration and repository updates

**Files:**
- Modify: `packages/core/src/db/schema.ts` (after line 66, existing migration pattern)
- Modify: `packages/core/src/db/chats.ts`

**Step 1: Add migration in schema.ts**

After the `permission_mode` migration (line 64-66), add:

```typescript
if (!cols.some((c) => c.name === 'worktree_path')) {
  db.exec('ALTER TABLE chats ADD COLUMN worktree_path TEXT');
}
if (!cols.some((c) => c.name === 'branch_name')) {
  db.exec('ALTER TABLE chats ADD COLUMN branch_name TEXT');
}
```

**Step 2: Update SELECT queries in ChatsRepository**

In both `list()` and `get()`, add to the SELECT clause:

```sql
worktree_path as worktreePath, branch_name as branchName
```

**Step 3: Update ChatsRepository.create()**

Add optional `worktreePath` and `branchName` parameters. Update INSERT to include `worktree_path, branch_name`. Return them in the Chat object.

**Step 4: Update ChatsRepository.update()**

Add worktree fields to the dynamic update builder (after `permissionMode` block):

```typescript
if (updates.worktreePath !== undefined) {
  fields.push('worktree_path = ?');
  values.push(updates.worktreePath ?? null);
}
if (updates.branchName !== undefined) {
  fields.push('branch_name = ?');
  values.push(updates.branchName ?? null);
}
```

**Step 5: Build core**

Run: `pnpm --filter @mainframe/core build`

**Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/chats.ts
git commit -m "feat(db): add worktree_path and branch_name columns to chats table"
```

---

## Task 3: Worktree utility module

**Files:**
- Create: `packages/core/src/worktree.ts`

**Step 1: Create worktree.ts with these exports:**

- `createWorktree(projectPath: string, chatId: string): WorktreeInfo` — creates `.mainframe/worktrees/<shortId>` dir, runs `git worktree add -b session/<shortId>`, returns `{ worktreePath, branchName }`
- `removeWorktree(projectPath: string, worktreePath: string, branchName: string): void` — runs `git worktree remove --force`, falls back to `rmSync` + `git worktree prune`, then `git branch -D`
- `isGitRepo(projectPath: string): boolean` — `git rev-parse --is-inside-work-tree`

All `execSync` calls use `stdio: 'pipe'` to suppress output. Branch name is derived from first 8 chars of chatId: `session/<shortId>`.

```typescript
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

export function isGitRepo(projectPath: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function createWorktree(projectPath: string, chatId: string): WorktreeInfo {
  const shortId = chatId.slice(0, 8);
  const branchName = `session/${shortId}`;
  const worktreeDir = path.join(projectPath, '.mainframe', 'worktrees');
  const worktreePath = path.join(worktreeDir, shortId);

  mkdirSync(worktreeDir, { recursive: true });
  execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
    cwd: projectPath, encoding: 'utf-8', stdio: 'pipe',
  });
  return { worktreePath, branchName };
}

export function removeWorktree(projectPath: string, worktreePath: string, branchName: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    try { execSync('git worktree prune', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' }); } catch {}
  }
  try { execSync(`git branch -D "${branchName}"`, { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' }); } catch {}
}
```

**Step 2: Commit**

```bash
git add packages/core/src/worktree.ts
git commit -m "feat(core): add worktree utility module"
```

---

## Task 4: ChatManager — enableWorktree, disableWorktree, path routing

**Files:**
- Modify: `packages/core/src/chat-manager.ts`

**Step 1: Import worktree utilities**

```typescript
import { createWorktree, removeWorktree } from './worktree.js';
```

**Step 2: Add enableWorktree method**

Checks: chat must exist in `activeChats`, must not have `claudeSessionId` yet (no messages sent), must not already have a worktree. Kills idle adapter process if running, creates worktree, stores path in DB, emits `chat.updated`. Does NOT re-spawn — lazy-start in `sendMessage()` handles that.

```typescript
async enableWorktree(chatId: string): Promise<void> {
  const active = this.activeChats.get(chatId);
  if (!active) throw new Error(`Chat ${chatId} not found`);
  if (active.chat.claudeSessionId) throw new Error('Cannot enable worktree after session has started');
  if (active.chat.worktreePath) return;

  // Kill idle process if running — it was spawned with project.path
  if (active.process) {
    const adapter = this.adapters.get(active.chat.adapterId);
    if (adapter) await adapter.kill(active.process);
    this.processToChat.delete(active.process.id);
    active.process = null;
  }

  const project = this.db.projects.get(active.chat.projectId);
  if (!project) throw new Error('Project not found');

  const info = createWorktree(project.path, chatId);
  active.chat.worktreePath = info.worktreePath;
  active.chat.branchName = info.branchName;
  this.db.chats.update(chatId, { worktreePath: info.worktreePath, branchName: info.branchName });
  this.emitEvent({ type: 'chat.updated', chat: active.chat });
}
```

**Step 3: Add disableWorktree method**

Mirror of enable — kills process, removes worktree, clears fields, emits update.

```typescript
async disableWorktree(chatId: string): Promise<void> {
  const active = this.activeChats.get(chatId);
  if (!active?.chat.worktreePath) return;
  if (active.chat.claudeSessionId) throw new Error('Cannot disable worktree after session has started');

  if (active.process) {
    const adapter = this.adapters.get(active.chat.adapterId);
    if (adapter) await adapter.kill(active.process);
    this.processToChat.delete(active.process.id);
    active.process = null;
  }

  const project = this.db.projects.get(active.chat.projectId);
  if (project) removeWorktree(project.path, active.chat.worktreePath, active.chat.branchName!);

  active.chat.worktreePath = undefined;
  active.chat.branchName = undefined;
  this.db.chats.update(chatId, { worktreePath: undefined, branchName: undefined });
  this.emitEvent({ type: 'chat.updated', chat: active.chat });
}
```

**Step 4: Update loadChat() to use worktree path**

In `loadChat()` (line 222), after resolving `project` (line 233), compute effective path:

```typescript
const effectivePath = chat.worktreePath ?? project.path;
```

Replace `project.path` with `effectivePath` in:
- `adapter.loadHistory()` call (line 239)
- `adapter.extractPlanFilePaths()` / `extractSkillFilePaths()` calls (lines 262-263)

**Step 5: Update startChat() to use worktree path**

In `startChat()` (line 272), after resolving `project` (line 288), compute effective path:

```typescript
const effectivePath = chat.worktreePath ?? project.path;
```

Replace `project.path` with `effectivePath` in:
- `adapter.spawn({ projectPath: effectivePath, ... })` (line 291)

**Step 6: Update getMessages() to use worktree path**

In `getMessages()` (line 425), replace `project.path` (line 441) with `chat.worktreePath ?? project.path`.

**Step 7: Update trackFileActivity() to use worktree path**

In `trackFileActivity()` (line 457), change projectPath resolution (line 469) to `chat?.worktreePath ?? project?.path`.

**Step 8: Add worktree cleanup in archiveChat()**

In `archiveChat()` (line 386), after killing the process but before clearing state:

```typescript
const chat = active?.chat ?? this.db.chats.get(chatId);
if (chat?.worktreePath && chat?.branchName) {
  const project = this.db.projects.get(chat.projectId);
  if (project) removeWorktree(project.path, chat.worktreePath, chat.branchName);
}
```

**Step 9: Add getEffectivePath() public method**

For HTTP API use — returns `chat.worktreePath ?? project.path`:

```typescript
getEffectivePath(chatId: string): string | null {
  const chat = this.getChat(chatId);
  if (!chat) return null;
  if (chat.worktreePath) return chat.worktreePath;
  const project = this.db.projects.get(chat.projectId);
  return project?.path ?? null;
}
```

**Step 10: Build core**

Run: `pnpm --filter @mainframe/core build`

**Step 11: Commit**

```bash
git add packages/core/src/chat-manager.ts
git commit -m "feat(core): wire worktree lifecycle into ChatManager"
```

---

## Task 5: WebSocket — Handle worktree events

**Files:**
- Modify: `packages/core/src/server/websocket.ts`

**Step 1: Add handlers in the switch block**

```typescript
case 'chat.enableWorktree': {
  await this.chats.enableWorktree(event.chatId);
  break;
}
case 'chat.disableWorktree': {
  await this.chats.disableWorktree(event.chatId);
  break;
}
```

**Step 2: Build core**

Run: `pnpm --filter @mainframe/core build`

**Step 3: Commit**

```bash
git add packages/core/src/server/websocket.ts
git commit -m "feat(ws): handle chat.enableWorktree and chat.disableWorktree"
```

---

## Task 6: HTTP — Make file/git endpoints worktree-aware

**Files:**
- Modify: `packages/core/src/server/http.ts`

**Step 1: Add getEffectivePath helper inside createHttpServer**

```typescript
function getEffectivePath(projectId: string, chatId?: string): string | null {
  const project = db.projects.get(projectId);
  if (!project) return null;
  if (chatId) {
    const chat = chats.getChat(chatId);
    if (chat?.worktreePath) return chat.worktreePath;
  }
  return project.path;
}
```

**Step 2: Update these endpoints to accept `chatId` query param and use getEffectivePath:**

1. `GET /api/projects/:id/tree` (line 112)
2. `GET /api/projects/:id/search/files` (line 139)
3. `GET /api/projects/:id/files-list` (line 172)
4. `GET /api/projects/:id/files` (line 203)
5. `GET /api/projects/:id/git/status` (line 222)
6. `GET /api/projects/:id/git/branch` (line 239)
7. `GET /api/projects/:id/diff` (line 252)

Pattern: replace `const project = db.projects.get(...)` + `project.path` with:
```typescript
const chatId = req.query.chatId as string | undefined;
const basePath = getEffectivePath(req.params.id, chatId);
if (!basePath) { res.status(404).json({ error: 'Project not found' }); return; }
```

**Step 3: Update session-file endpoint** (line 321)

Use `chat.worktreePath ?? project.path`.

**Step 4: Update context endpoint** (line 305)

```typescript
const effectivePath = chat.worktreePath ?? project.path;
const context = chats.getSessionContext(req.params.id, effectivePath);
```

**Step 5: Build core**

Run: `pnpm --filter @mainframe/core build`

**Step 6: Commit**

```bash
git add packages/core/src/server/http.ts
git commit -m "feat(http): make file/git endpoints worktree-aware via chatId param"
```

---

## Task 7: Desktop client — DaemonClient updates

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts`

**Step 1: Add worktree WebSocket methods**

```typescript
enableWorktree(chatId: string): void {
  this.send({ type: 'chat.enableWorktree', chatId });
}
disableWorktree(chatId: string): void {
  this.send({ type: 'chat.disableWorktree', chatId });
}
```

**Step 2: Add chatId param to file/git REST methods**

Add optional `chatId?: string` to these methods, appending `chatId` as a query param when present:
- `getFileTree(projectId, dirPath, chatId?)`
- `getFilesList(projectId, chatId?)`
- `searchFiles(projectId, query, limit, chatId?)`
- `getFileContent(projectId, filePath, chatId?)`
- `getGitStatus(projectId, chatId?)`
- `getGitBranch(projectId, chatId?)`

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/client.ts
git commit -m "feat(client): add worktree methods, pass chatId to file/git APIs"
```

---

## Task 8: Desktop UI — Worktree toggle in composer

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeThread.tsx`

**Step 1: Add GitBranch to lucide-react imports**

**Step 2: Add toggle button in ComposerCard bottom bar**

After the permission mode `ComposerDropdown` (line 460), before the closing `</div>` of the selectors row, add (only shown pre-first-message):

```tsx
{!hasMessages && (
  <button
    type="button"
    onClick={() => {
      if (!chatId) return;
      if (chat?.worktreePath) {
        daemonClient.disableWorktree(chatId);
      } else {
        daemonClient.enableWorktree(chatId);
      }
    }}
    className={cn(
      'flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small transition-colors',
      chat?.worktreePath
        ? 'text-mf-accent-claude bg-[#d4a574] bg-opacity-15'
        : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary',
    )}
    title={chat?.worktreePath ? `Branch: ${chat.branchName}` : 'Enable worktree isolation'}
  >
    <GitBranch size={12} />
  </button>
)}
```

Note: Use literal hex for the active background — our CSS variable colors don't support the `/opacity` modifier.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/MainframeThread.tsx
git commit -m "feat(ui): add worktree toggle in composer bottom bar"
```

---

## Task 9: Desktop UI — Branch badge in session bar

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx`

**Step 1: Import GitBranch from lucide-react**

**Step 2: Add branch badge after mode label**

After the mode `<span>` (line 107), before the status separator (line 110):

```tsx
{chat.branchName && (
  <>
    <span className="text-mf-text-secondary opacity-30">&middot;</span>
    <div className="flex items-center gap-1">
      <GitBranch size={10} />
      <span className="font-mono text-mf-accent-claude">{chat.branchName}</span>
    </div>
  </>
)}
```

Renders as: `Claude · Opus · Interactive · session/a1b2c3d4 | Idle | ...`

Note: Use `opacity-30` utility instead of `/30` modifier on the middot separator.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx
git commit -m "feat(ui): show branch badge in session bar for worktree sessions"
```

---

## Task 10: Thread chatId through file/git API call sites

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`
- Modify: `packages/desktop/src/renderer/components/panels/ChangesTab.tsx`
- Modify: `packages/desktop/src/renderer/components/StatusBar.tsx`
- Modify: `packages/desktop/src/renderer/components/center/EditorTab.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/AtMentionMenu.tsx`
- Modify: `packages/desktop/src/renderer/components/SearchPalette.tsx`

**Step 1: In each file, get activeChatId from the chats store**

```typescript
const activeChatId = useChatsStore((s) => s.activeChatId);
```

**Step 2: Pass chatId to each API call**

| File | Line | Change |
|------|------|--------|
| `FilesTab.tsx` | 24 | `getFileTree(activeProjectId, entry.path, activeChatId)` |
| `FilesTab.tsx` | 70 | `getFileTree(activeProjectId, '.', activeChatId)` |
| `ChangesTab.tsx` | 45 | `getGitStatus(activeProjectId, activeChatId)` |
| `StatusBar.tsx` | 28 | `getGitBranch(activeProjectId, activeChatId)` |
| `EditorTab.tsx` | 26 | `getFileContent(activeProjectId, filePath, activeChatId)` |
| `AtMentionMenu.tsx` | 71 | `getFilesList(activeProjectId, activeChatId)` |
| `SearchPalette.tsx` | 60 | `searchFiles(activeProjectId, q, undefined, activeChatId)` |

**Step 3: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx \
  packages/desktop/src/renderer/components/panels/ChangesTab.tsx \
  packages/desktop/src/renderer/components/StatusBar.tsx \
  packages/desktop/src/renderer/components/center/EditorTab.tsx \
  packages/desktop/src/renderer/components/chat/AtMentionMenu.tsx \
  packages/desktop/src/renderer/components/SearchPalette.tsx
git commit -m "feat(ui): pass active chatId to file/git APIs for worktree resolution"
```

---

## Task 11: Add .mainframe/ to .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add entry**

```
# Mainframe local data (worktrees)
.mainframe/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .mainframe/ to .gitignore"
```

---

## Task 12: Build and verify

**Step 1: Build all packages**

```bash
pnpm build
```

Expected: Clean compile, no type errors.

**Step 2: Manual verification checklist**

1. Start daemon + desktop app
2. Create a regular session (Cmd+N) — verify worktree toggle appears in composer, status shows "Ready" (no process until first message due to lazy-start)
3. Click the worktree toggle — verify:
   - Branch badge appears in session bar (e.g. `session/a1b2c3d4`)
   - Session bar still shows "Ready" (no process killed/restarted since lazy-start)
   - `.mainframe/worktrees/<id>` directory was created on disk
4. Send a message — verify the adapter spawns in the worktree directory (lazy-start), status goes to "Starting..." → "Thinking..."
5. Check file tree panel — should show worktree files
6. Check git branch in status bar — should show the worktree branch
7. Toggle worktree OFF (before first message in a new session) — verify branch badge disappears and worktree dir removed
8. Archive a worktree session — verify `.mainframe/worktrees/<id>` dir is removed
9. Non-git project: attempt to enable worktree — verify graceful error (no crash)

---

## Edge Cases / Notes

- **Not a git repo**: `createWorktree` throws → WebSocket handler emits `error` event → client shows error. Session continues without worktree.
- **Orphaned worktrees**: If daemon crashes, worktrees stay on disk. Clean up with `git worktree prune`.
- **Claude CLI session storage**: Claude keys JSONL by `projectPath`. Worktree path = separate JSONL dir, so `--resume` works correctly.
- **Merge workflow**: Out of scope for MVP. User handles merge via git CLI or a future iteration adds a merge button.
- **Worktree immutability**: Once the first message is sent (`claudeSessionId` is set), the worktree toggle is hidden and the worktree cannot be changed.
