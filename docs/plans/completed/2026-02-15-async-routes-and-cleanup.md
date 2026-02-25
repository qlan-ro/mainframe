# Async Routes & Data Integrity Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert all sync I/O in route handlers to async, fix orphaned-chats FK bug, lazy-load Monaco editor, and enable `noUncheckedIndexedAccess`.

**Architecture:** Each route handler that currently uses `readdirSync`/`readFileSync`/`execFileSync`/`statSync` becomes `async` and uses `node:fs/promises` + promisified `execFile`. The handlers are already wired through Express which supports async handlers (Express 5). For git ops we wrap `execFile` in a promise utility. The DB schema gets a migration to add `ON DELETE CASCADE`. The desktop lazy-loads Monaco via `React.lazy`. Finally, `noUncheckedIndexedAccess` is enabled and any resulting type errors are fixed.

**Tech Stack:** Node.js (`node:fs/promises`, `node:child_process` `execFile`), Express 5, SQLite (better-sqlite3), React (`React.lazy`, `Suspense`), TypeScript

---

## Task 1: Add async `execGit` helper

**Files:**
- Create: `packages/core/src/server/routes/exec-git.ts`
- Test: `packages/core/src/__tests__/routes/exec-git.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/routes/exec-git.test.ts
import { describe, it, expect } from 'vitest';
import { execGit } from '../../server/routes/exec-git.js';

describe('execGit', () => {
  it('returns stdout of a successful git command', async () => {
    // Use a real git command on the repo root (guaranteed to be a git repo)
    const result = await execGit([import.meta.dirname + '/../../../..'], ['rev-parse', '--is-inside-work-tree']);
    expect(result.trim()).toBe('true');
  });

  it('throws on invalid git command', async () => {
    await expect(execGit(['/tmp'], ['not-a-real-command'])).rejects.toThrow();
  });
});
```

Wait — the API should be `execGit(args, cwd)`. Let me fix:

```typescript
// packages/core/src/__tests__/routes/exec-git.test.ts
import { describe, it, expect } from 'vitest';
import { execGit } from '../../server/routes/exec-git.js';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

describe('execGit', () => {
  it('returns stdout of a successful git command', async () => {
    const result = await execGit(['rev-parse', '--is-inside-work-tree'], repoRoot);
    expect(result.trim()).toBe('true');
  });

  it('throws on invalid git command', async () => {
    await expect(execGit(['not-a-real-command'], '/tmp')).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/exec-git.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/server/routes/exec-git.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 30_000 });
  return stdout;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/exec-git.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add async execGit helper for route handlers
```

---

## Task 2: Convert `git.ts` routes to async

**Files:**
- Modify: `packages/core/src/server/routes/git.ts`
- Verify: existing tests still pass

**Step 1: Rewrite `git.ts`**

Replace the entire file. Key changes:
- Import `execGit` instead of `execFileSync`
- Import `readFile` from `node:fs/promises` instead of `fs.readFileSync`
- All three handlers become `async` functions
- Wrap with `asyncHandler` from `./async-handler.js`

```typescript
// packages/core/src/server/routes/git.ts
import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { execGit } from './exec-git.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:git');

/** GET /api/projects/:id/git/status?chatId=X */
async function handleGitStatus(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const status = await execGit(['status', '--porcelain'], basePath);
    const files = status
      .split('\n')
      .filter(Boolean)
      .map((line: string) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    res.json({ files });
  } catch (err) {
    logger.warn({ err, basePath }, 'Failed to get git status');
    res.json({ files: [], error: 'Not a git repository' });
  }
}

/** GET /api/projects/:id/git/branch?chatId=X */
async function handleGitBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], basePath)).trim();
    res.json({ branch });
  } catch (err) {
    logger.warn({ err, basePath }, 'Failed to get git branch');
    res.json({ branch: null });
  }
}

/** GET /api/projects/:id/diff?file=path&source=git|session&chatId=X */
async function handleDiff(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const chatId = req.query.chatId as string | undefined;
  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const file = req.query.file as string;
  const source = (req.query.source as string) || 'git';

  if (source === 'git') {
    try {
      const diffArgs = file ? ['diff', '--', file] : ['diff'];
      const diff = await execGit(diffArgs, basePath);
      let original = '';
      if (file) {
        try {
          original = await execGit(['show', `HEAD:${file}`], basePath);
        } catch {
          /* new file */
        }
      }
      let modified = '';
      if (file) {
        const resolvedFile = resolveAndValidatePath(basePath, file);
        if (!resolvedFile) {
          res.status(403).json({ error: 'Path outside project' });
          return;
        }
        modified = await readFile(resolvedFile, 'utf-8');
      }
      res.json({ diff, original, modified, source: 'git' });
    } catch (err) {
      logger.warn({ err, basePath, file }, 'Failed to compute git diff');
      res.json({ diff: '', original: '', modified: '', source: 'git' });
    }
  } else if (source === 'session') {
    if (!file) {
      const modifiedFiles = chatId ? ctx.db.chats.getModifiedFilesList(chatId) : [];
      res.json({ files: modifiedFiles, source: 'session' });
      return;
    }
    try {
      const resolvedFile = resolveAndValidatePath(basePath, file);
      if (!resolvedFile) {
        res.status(403).json({ error: 'Path outside project' });
        return;
      }
      let original = '';
      try {
        original = await execGit(['show', `HEAD:${file}`], basePath);
      } catch {
        /* new file */
      }
      const modified = await readFile(resolvedFile, 'utf-8');
      res.json({ original, modified, source: 'session', file });
    } catch (err) {
      logger.warn({ err, file }, 'Failed to read session diff file');
      res.status(404).json({ error: 'File not found' });
    }
  } else {
    res.status(400).json({ error: 'Invalid source. Use "git" or "session".' });
  }
}

export function gitRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/projects/:id/git/status', asyncHandler((req, res) => handleGitStatus(ctx, req, res)));
  router.get('/api/projects/:id/git/branch', asyncHandler((req, res) => handleGitBranch(ctx, req, res)));
  router.get('/api/projects/:id/diff', asyncHandler((req, res) => handleDiff(ctx, req, res)));

  return router;
}
```

**Step 2: Run all tests**

Run: `pnpm --filter @mainframe/core exec vitest run`
Expected: PASS (no git route tests exist, but ensure nothing else broke)

**Step 3: Commit**

```
refactor: convert git route handlers to async I/O
```

---

## Task 3: Convert `files.ts` routes to async

**Files:**
- Modify: `packages/core/src/server/routes/files.ts`

**Step 1: Rewrite `files.ts`**

Key changes:
- Import from `node:fs/promises` (`readdir`, `stat`, `readFile`, `realpath`)
- All handlers become `async`
- `walk()` helper becomes `async` with `await readdir()`
- Wrap with `asyncHandler`
- `resolveAndValidatePath` stays sync (it's a security check that needs to be atomic) — that's acceptable since `realpathSync` is fast for already-resolved paths

```typescript
// packages/core/src/server/routes/files.ts
import { Router, Request, Response } from 'express';
import { readdir, stat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:files');

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out',
  '.cache', '__pycache__', '.venv', 'vendor', 'coverage', '.turbo',
]);

/** GET /api/projects/:id/tree?path=relative/dir&chatId=X */
async function handleTree(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const dirPath = (req.query.path as string) || '.';
  try {
    const fullPath = resolveAndValidatePath(basePath, dirPath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const dirents = await readdir(fullPath, { withFileTypes: true });
    const entries = dirents
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ('directory' as const) : ('file' as const),
        path: path.relative(basePath, path.join(fullPath, e.name)),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json(entries);
  } catch (err) {
    logger.warn({ err, path: dirPath }, 'Failed to read directory tree');
    res.status(404).json({ error: 'Directory not found' });
  }
}

/** GET /api/projects/:id/search/files?q=<query>&limit=50&chatId=X */
async function handleSearchFiles(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const q = ((req.query.q as string) || '').toLowerCase();
  if (q.length < 2) {
    res.json([]);
    return;
  }

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file search');
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  type FileResult = { name: string; path: string; type: string; exact: boolean };
  const substringHits: FileResult[] = [];
  const fuzzyHits: FileResult[] = [];
  const scanLimit = limit * 4;

  const fuzzyMatch = (query: string, target: string): boolean => {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  };

  const walk = async (dir: string): Promise<void> => {
    if (substringHits.length + fuzzyHits.length >= scanLimit) return;
    let entries: Awaited<ReturnType<typeof readdir<{ withFileTypes: true }>>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to read directory during file search');
      return;
    }
    for (const entry of entries) {
      if (substringHits.length + fuzzyHits.length >= scanLimit) return;
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
      const rel = path.relative(basePath, path.join(dir, entry.name));
      const relLower = rel.toLowerCase();
      if (relLower.includes(q)) {
        substringHits.push({ name: entry.name, path: rel, type: entry.isDirectory() ? 'directory' : 'file', exact: true });
      } else if (fuzzyMatch(q, relLower)) {
        fuzzyHits.push({ name: entry.name, path: rel, type: entry.isDirectory() ? 'directory' : 'file', exact: false });
      }
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
    }
  };
  await walk(basePath);

  const combined = [...substringHits, ...fuzzyHits].slice(0, limit);
  res.json(combined.map(({ exact: _, ...r }) => r));
}

/** GET /api/projects/:id/files-list?limit=5000&chatId=X */
async function handleFilesList(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 5000, 5000);

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file listing');
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= limit) return;
    let entries: Awaited<ReturnType<typeof readdir<{ withFileTypes: true }>>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to read directory during file listing');
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
      const rel = path.relative(basePath, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name));
      } else {
        files.push(rel);
      }
    }
  };
  await walk(basePath);
  res.json(files);
}

/** GET /api/projects/:id/files?path=relative/path&chatId=X */
async function handleFileContent(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'path query required' });
    return;
  }

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const stats = await stat(fullPath);
    if (stats.size > 2 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large (max 2MB)' });
      return;
    }

    const content = await readFile(fullPath, 'utf-8');
    res.json({ path: filePath, content });
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to read file content');
    res.status(404).json({ error: 'File not found' });
  }
}

export function fileRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/projects/:id/tree', asyncHandler((req, res) => handleTree(ctx, req, res)));
  router.get('/api/projects/:id/search/files', asyncHandler((req, res) => handleSearchFiles(ctx, req, res)));
  router.get('/api/projects/:id/files-list', asyncHandler((req, res) => handleFilesList(ctx, req, res)));
  router.get('/api/projects/:id/files', asyncHandler((req, res) => handleFileContent(ctx, req, res)));

  return router;
}
```

**Step 2: Run all tests**

Run: `pnpm --filter @mainframe/core exec vitest run`
Expected: PASS

**Step 3: Commit**

```
refactor: convert file route handlers to async I/O
```

---

## Task 4: Convert `context.ts` session-file endpoint to async

**Files:**
- Modify: `packages/core/src/server/routes/context.ts`

**Step 1: Convert the session-file handler**

Change only the `GET /api/chats/:id/session-file` handler. The `GET /api/chats/:id/context` handler is already async. The `POST /api/chats/:id/mentions` handler is sync and doesn't do I/O.

```diff
- import fs from 'node:fs';
+ import { readFile } from 'node:fs/promises';
```

Change the session-file handler from sync to async and wrap with `asyncHandler`:

```diff
- import { validate, AddMentionBody } from './schemas.js';
+ import { validate, AddMentionBody } from './schemas.js';
+ import { asyncHandler } from './async-handler.js';
```

The handler becomes:

```typescript
  router.get('/api/chats/:id/session-file', asyncHandler(async (req: Request, res: Response) => {
    // ... same validation logic ...
    try {
      // ...
      const content = await readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content });
    } catch (err) {
      logger.warn({ err, path: filePath }, 'Failed to read session file');
      res.status(404).json({ success: false, error: 'File not found' });
    }
  }));
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/context.test.ts`
Expected: PASS

**Step 3: Commit**

```
refactor: convert context session-file handler to async I/O
```

---

## Task 5: Convert `settings.ts` config-conflicts endpoint to async

**Files:**
- Modify: `packages/core/src/server/routes/settings.ts`

**Step 1: Convert the config-conflicts handler**

Only the `GET /api/adapters/:adapterId/config-conflicts` handler needs conversion.

```diff
- import fs from 'node:fs';
+ import { readFile } from 'node:fs/promises';
```

Add `asyncHandler` import and wrap the handler:

```typescript
  router.get('/api/adapters/:adapterId/config-conflicts', asyncHandler(async (req: Request, res: Response) => {
    if (req.params.adapterId !== 'claude') {
      res.json({ success: true, data: { conflicts: [] } });
      return;
    }

    const conflicts: string[] = [];
    const settingsPath = path.join(homedir(), '.claude', 'settings.json');
    try {
      const raw = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings.permissions?.defaultMode) conflicts.push('defaultMode');
      if (settings.permissions?.allow) conflicts.push('allowedTools');
      if (settings.permissions?.deny) conflicts.push('deniedTools');
    } catch {
      // File doesn't exist or is invalid — no conflicts
    }
    res.json({ success: true, data: { conflicts } });
  }));
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/settings.test.ts`
Expected: PASS

**Step 3: Commit**

```
refactor: convert settings config-conflicts handler to async I/O
```

---

## Task 6: Add `ON DELETE CASCADE` and cleanup logic for project deletion

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/server/routes/projects.ts`
- Modify: `packages/core/src/__tests__/routes/projects.test.ts`

**Step 1: Add migration in `schema.ts`**

SQLite doesn't support `ALTER TABLE ... ALTER CONSTRAINT`. We need to handle this via a migration that recreates the table if the FK doesn't have CASCADE. However, for simplicity and safety (existing data), we handle this at the application level instead — delete chats before deleting project.

Add `removeWithChats` to `ProjectsRepository`:

```diff
// packages/core/src/db/projects.ts — add after remove()
  removeWithChats(id: string): void {
    const deleteChats = this.db.prepare(`DELETE FROM chats WHERE project_id = ?`);
    const deleteProject = this.db.prepare(`DELETE FROM projects WHERE id = ?`);
    const tx = this.db.transaction(() => {
      deleteChats.run(id);
      deleteProject.run(id);
    });
    tx();
  }
```

**Step 2: Update the DELETE route to use `removeWithChats`**

```diff
// packages/core/src/server/routes/projects.ts
  router.delete('/api/projects/:id', (req: Request, res: Response) => {
-   ctx.db.projects.remove(param(req, 'id'));
+   ctx.db.projects.removeWithChats(param(req, 'id'));
    res.json({ success: true });
  });
```

**Step 3: Write the failing test**

```typescript
// Add to packages/core/src/__tests__/routes/projects.test.ts
  describe('DELETE /api/projects/:id', () => {
    it('removes project and associated chats', () => {
      const router = projectRoutes(ctx);
      const handler = extractHandler(router, 'delete', '/api/projects/:id');
      const res = mockRes();

      handler({ params: { id: 'p1' }, query: {} }, res, vi.fn());

      expect(ctx.db.projects.removeWithChats).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
```

Update the mock context to include `removeWithChats`:

```diff
// In createMockContext()
  projects: {
    list: vi.fn(),
    get: vi.fn(),
    getByPath: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
+   removeWithChats: vi.fn(),
    updateLastOpened: vi.fn(),
  },
```

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/projects.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: delete associated chats when removing a project
```

---

## Task 7: Lazy-load Monaco editor in desktop

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FileViewContent.tsx`

**Step 1: Convert eager imports to React.lazy**

```typescript
// packages/desktop/src/renderer/components/panels/FileViewContent.tsx
import React, { Suspense } from 'react';
import { useTabsStore } from '../../store/tabs';

const EditorTab = React.lazy(() => import('../center/EditorTab').then(m => ({ default: m.EditorTab })));
const DiffTab = React.lazy(() => import('../center/DiffTab').then(m => ({ default: m.DiffTab })));
const SkillEditorTab = React.lazy(() => import('../center/SkillEditorTab').then(m => ({ default: m.SkillEditorTab })));

function EditorFallback(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">
      Loading editor...
    </div>
  );
}

export function FileViewContent(): React.ReactElement | null {
  const fileView = useTabsStore((s) => s.fileView);
  if (!fileView) return null;

  return (
    <Suspense fallback={<EditorFallback />}>
      {fileView.type === 'editor' && <EditorTab filePath={fileView.filePath} />}
      {fileView.type === 'diff' && (
        <DiffTab
          filePath={fileView.filePath}
          source={fileView.source}
          chatId={fileView.chatId}
          original={fileView.original}
          modified={fileView.modified}
          startLine={fileView.startLine}
        />
      )}
      {fileView.type === 'skill-editor' && <SkillEditorTab skillId={fileView.skillId} adapterId={fileView.adapterId} />}
    </Suspense>
  );
}
```

**Step 2: Build to verify**

Run: `pnpm --filter @mainframe/desktop build`
Expected: PASS — Vite will now code-split Monaco into a separate chunk

**Step 3: Commit**

```
perf: lazy-load Monaco editor via React.lazy
```

---

## Task 8: Enable `noUncheckedIndexedAccess` and fix type errors

**Files:**
- Modify: `tsconfig.base.json`
- Modify: any files with resulting type errors

**Step 1: Enable the flag**

```diff
// tsconfig.base.json
  "compilerOptions": {
    ...
    "isolatedModules": true,
+   "noUncheckedIndexedAccess": true
  }
```

**Step 2: Run type check to see what breaks**

Run: `pnpm --filter @mainframe/core exec tsc --noEmit && pnpm --filter @mainframe/types exec tsc --noEmit`
Expected: Type errors where indexed access returns `T | undefined`

**Step 3: Fix each error**

Common patterns to fix:
- `arr[0]` → add `if (!arr[0]) return;` guard or use `arr[0]!` where guaranteed by prior `.length` check
- `obj[key]` → add null check

Fix each file one at a time. The desktop package uses `bundler` module resolution and may have different errors — check separately:

Run: `cd packages/desktop && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`

**Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 5: Run full build**

Run: `pnpm build`
Expected: PASS

**Step 6: Commit**

```
chore: enable noUncheckedIndexedAccess for safer index access
```

---

## Task 9: Update tech debt report

**Files:**
- Modify: `docs/TECH-DEBT-REPORT.md`

**Step 1: Move resolved items from "Remaining Items" to "Completed Remediation History"**

Mark items 1-4 (sync I/O, CASCADE DELETE, Monaco lazy-load, noUncheckedIndexedAccess) as resolved.

**Step 2: Commit**

```
docs: update tech debt report to reflect completed remediation
```

---

## Execution Order & Dependencies

```
Task 1 (execGit helper)
  └─→ Task 2 (git.ts async)
Task 3 (files.ts async)     ← independent, can parallel with 2
Task 4 (context.ts async)   ← independent
Task 5 (settings.ts async)  ← independent
Task 6 (CASCADE DELETE)     ← independent
Task 7 (Monaco lazy-load)   ← independent
Task 8 (noUncheckedIndexedAccess) ← after 1-7 (needs all code changes landed first)
Task 9 (docs update)        ← last
```

Tasks 2-7 are independent of each other (except Task 2 depends on Task 1). Task 8 goes last because it's a cross-cutting type change that should apply after all code modifications are done.
