# TODO Kanban Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a GitHub-style kanban board as a builtin plugin, validating the plugin system contract and adding task management to the app.

**Architecture:** Backend follows the full plugin contract (`ctx.db`, `ctx.attachments`, `ctx.services.chats.createChat`). Frontend is a React component compiled directly into the desktop (builtins skip ESM panel loading). UI entry is a button in `ProjectRail` above Settings/About that opens a `todos` tab in the center panel.

**Tech Stack:** TypeScript, better-sqlite3 (via plugin DB context), Express router (via plugin context), React, Zustand, Tailwind CSS, Lucide icons, Zod validation, nanoid.

**Plugin System Changes Required:**
- Add `PluginAttachmentContext` to types + `ctx.attachments` to `PluginContext`
- Implement `createChat` in `chat-service.ts` (was declared, never implemented)
- Add `pluginDir` option to `loadBuiltin` so builtins with `storage` get a real data dir

---

## Task 1: Add `PluginAttachmentContext` to `@mainframe/types`

**Files:**
- Modify: `packages/types/src/plugin.ts`
- Modify: `packages/types/src/index.ts` (re-export check)

**Step 1: Open `packages/types/src/plugin.ts`**

After the `PluginConfig` interface (line ~136), add:

```typescript
export interface PluginAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PluginAttachmentContext {
  save(
    entityId: string,
    file: { filename: string; mimeType: string; data: string; sizeBytes: number },
  ): Promise<PluginAttachmentMeta>;
  get(entityId: string, id: string): Promise<{ data: string; meta: PluginAttachmentMeta } | null>;
  list(entityId: string): Promise<PluginAttachmentMeta[]>;
  delete(entityId: string, id: string): Promise<void>;
}
```

In the `PluginContext` interface, after `readonly db: PluginDatabaseContext;` add:

```typescript
  // Requires 'storage'
  readonly attachments: PluginAttachmentContext;
```

**Step 2: Typecheck types package**

```bash
pnpm --filter @mainframe/types build
```
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/types/src/plugin.ts
git commit -m "feat(types): add PluginAttachmentContext and ctx.attachments"
```

---

## Task 2: Create plugin attachment context implementation

**Files:**
- Create: `packages/core/src/plugins/attachment-context.ts`

**Step 1: Write test first**

Create `packages/core/src/__tests__/plugins/attachment-context.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createPluginAttachmentContext } from '../../plugins/attachment-context.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-attach-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createPluginAttachmentContext', () => {
  it('saves and retrieves an attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const meta = await ctx.save('entity1', {
      filename: 'test.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello').toString('base64'),
      sizeBytes: 5,
    });
    expect(meta.id).toBeDefined();
    expect(meta.filename).toBe('test.txt');

    const result = await ctx.get('entity1', meta.id);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.data, 'base64').toString()).toBe('hello');
  });

  it('lists attachments for an entity', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    await ctx.save('e1', { filename: 'a.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    await ctx.save('e1', { filename: 'b.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    const list = await ctx.list('e1');
    expect(list).toHaveLength(2);
  });

  it('returns empty list for unknown entity', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const list = await ctx.list('unknown');
    expect(list).toHaveLength(0);
  });

  it('returns null for unknown attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const result = await ctx.get('entity1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('deletes an attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const meta = await ctx.save('e1', { filename: 'del.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    await ctx.delete('e1', meta.id);
    const result = await ctx.get('e1', meta.id);
    expect(result).toBeNull();
    const list = await ctx.list('e1');
    expect(list).toHaveLength(0);
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
pnpm --filter @mainframe/core test packages/core/src/__tests__/plugins/attachment-context.test.ts
```
Expected: FAIL — "attachment-context module not found"

**Step 3: Implement `packages/core/src/plugins/attachment-context.ts`**

```typescript
import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { nanoid } from 'nanoid';
import type { PluginAttachmentContext, PluginAttachmentMeta } from '@mainframe/types';

interface AttachmentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function createPluginAttachmentContext(baseDir: string): PluginAttachmentContext {
  const entityDir = (id: string) => join(baseDir, id);

  function sanitize(name: string): string {
    const f = basename(name).replace(/[^\w.\-() ]+/g, '_').trim();
    return f.length > 0 ? f : 'attachment.bin';
  }

  return {
    async save(entityId, file) {
      const dir = entityDir(entityId);
      await mkdir(dir, { recursive: true });
      const id = nanoid();
      const safeName = sanitize(file.filename);
      await writeFile(join(dir, `${id}-${safeName}`), Buffer.from(file.data, 'base64'));
      const record: AttachmentRecord = {
        id, filename: file.filename, mimeType: file.mimeType,
        sizeBytes: file.sizeBytes, createdAt: new Date().toISOString(),
      };
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
      return record;
    },

    async get(entityId, id) {
      const dir = entityDir(entityId);
      try {
        const metaRaw = await readFile(join(dir, `${id}.json`), 'utf-8');
        const meta = JSON.parse(metaRaw) as AttachmentRecord;
        const files = await readdir(dir);
        const dataFile = files.find((f) => f.startsWith(`${id}-`) && !f.endsWith('.json'));
        if (!dataFile) return null;
        const buf = await readFile(join(dir, dataFile));
        return { data: buf.toString('base64'), meta };
      } catch {
        return null;
      }
    },

    async list(entityId) {
      const dir = entityDir(entityId);
      try { await stat(dir); } catch { return []; }
      const files = await readdir(dir);
      const metas = await Promise.all(
        files.filter((f) => f.endsWith('.json')).map(async (f): Promise<PluginAttachmentMeta | null> => {
          try { return JSON.parse(await readFile(join(dir, f), 'utf-8')) as PluginAttachmentMeta; }
          catch { return null; }
        }),
      );
      return metas.filter((m): m is PluginAttachmentMeta => m !== null);
    },

    async delete(entityId, id) {
      const dir = entityDir(entityId);
      try {
        const files = await readdir(dir);
        await Promise.all(
          files.filter((f) => f === `${id}.json` || f.startsWith(`${id}-`))
            .map((f) => rm(join(dir, f), { force: true })),
        );
      } catch { /* dir may not exist */ }
    },
  };
}
```

**Step 4: Run test — expect PASS**

```bash
pnpm --filter @mainframe/core test packages/core/src/__tests__/plugins/attachment-context.test.ts
```
Expected: All 5 tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/plugins/attachment-context.ts packages/core/src/__tests__/plugins/attachment-context.test.ts
git commit -m "feat(core): add createPluginAttachmentContext for plugin-scoped file storage"
```

---

## Task 3: Wire `ctx.attachments` into `PluginContext` and add `pluginDir` to `loadBuiltin`

**Files:**
- Modify: `packages/core/src/plugins/context.ts`
- Modify: `packages/core/src/plugins/manager.ts`

**Step 1: Update `context.ts`**

At the top, add the import:
```typescript
import { createPluginAttachmentContext } from './attachment-context.js';
```

After the `dbContext` block (around line 41), add:
```typescript
  const attachmentContext = has('storage')
    ? createPluginAttachmentContext(`${pluginDir}/attachments`)
    : new Proxy({} as ReturnType<typeof createPluginAttachmentContext>, {
        get:
          () =>
          (..._args: unknown[]) =>
            capabilityGuard('storage'),
      });
```

In the returned object, add `attachments: attachmentContext` alongside the other fields.

**Step 2: Update `manager.ts` — add `pluginDir` option to `loadBuiltin`**

Change the `loadBuiltin` signature from:
```typescript
async loadBuiltin(manifest: PluginManifest, activate: (ctx: PluginContext) => void | Promise<void>): Promise<void>
```
to:
```typescript
async loadBuiltin(
  manifest: PluginManifest,
  activate: (ctx: PluginContext) => void | Promise<void>,
  options?: { pluginDir?: string },
): Promise<void>
```

Inside `loadBuiltin`, change:
```typescript
pluginDir: '',
```
to:
```typescript
pluginDir: options?.pluginDir ?? '',
```

**Step 3: Update context test to check `attachments` is guarded**

In `packages/core/src/__tests__/plugins/context.test.ts`, add a test after the existing `storage` tests:

```typescript
it('throws on attachments access when storage not declared', () => {
  const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: [] } }));
  expect(() => ctx.attachments.list('id')).toThrow(/storage/);
});

it('provides attachments when storage capability is declared', () => {
  const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: ['storage'] } }));
  expect(typeof ctx.attachments.save).toBe('function');
  expect(typeof ctx.attachments.list).toBe('function');
});
```

**Step 4: Run context tests**

```bash
pnpm --filter @mainframe/core test packages/core/src/__tests__/plugins/context.test.ts
```
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/plugins/context.ts packages/core/src/plugins/manager.ts packages/core/src/__tests__/plugins/context.test.ts
git commit -m "feat(core): wire ctx.attachments into PluginContext, add pluginDir option to loadBuiltin"
```

---

## Task 4: Implement `createChat` in ChatServiceAPI

**Files:**
- Modify: `packages/core/src/plugins/services/chat-service.ts`
- Modify: `packages/core/src/plugins/context.ts` (pass `emitEvent` to buildChatService)

**Step 1: Update `buildChatService` signature**

At the top of `chat-service.ts`, change the import to include `DaemonEvent`:
```typescript
import type { ChatServiceAPI, ChatSummary, PluginManifest, DaemonEvent } from '@mainframe/types';
```

Change `buildChatService` signature to:
```typescript
export function buildChatService(
  manifest: PluginManifest,
  db: DatabaseManager,
  emitEvent: (event: DaemonEvent) => void,
): ChatServiceAPI {
```

Add the `createChat` implementation inside the returned object, after the existing `getChatById`:

```typescript
    ...(has('chat:create')
      ? {
          async createChat({ projectId, adapterId, initialMessage: _initialMessage }) {
            const chat = db.chats.create(projectId, adapterId ?? 'claude');
            emitEvent({ type: 'chat.created', chat });
            return { chatId: chat.id };
          },
        }
      : {}),
```

**Step 2: Update `context.ts` to pass `emitEvent`**

Find the line:
```typescript
const chatService = buildChatService(manifest, deps.db);
```
Change to:
```typescript
const chatService = buildChatService(manifest, deps.db, deps.emitEvent);
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/core build
```
Expected: No errors.

**Step 4: Commit**

```bash
git add packages/core/src/plugins/services/chat-service.ts packages/core/src/plugins/context.ts
git commit -m "feat(core): implement createChat in ChatServiceAPI plugin capability"
```

---

## Task 5: Create the todos builtin plugin backend

**Files:**
- Create: `packages/core/src/plugins/builtin/todos/manifest.json`
- Create: `packages/core/src/plugins/builtin/todos/index.ts`

**Step 1: Create manifest**

`packages/core/src/plugins/builtin/todos/manifest.json`:
```json
{
  "id": "todos",
  "name": "TODO Kanban",
  "version": "1.0.0",
  "description": "GitHub-style kanban board for tracking tasks",
  "author": "Mainframe Team",
  "capabilities": ["storage", "chat:create"]
}
```

**Step 2: Write the test**

Create `packages/core/src/__tests__/plugins/builtin/todos.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activate } from '../../../plugins/builtin/todos/index.js';
import { buildPluginContext, type PluginContextDeps } from '../../../plugins/context.js';
import { EventEmitter } from 'node:events';
import { Router } from 'express';
import { pino } from 'pino';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@mainframe/types';
import request from 'supertest';
import express from 'express';

let tmpDir: string;

const todosManifest: PluginManifest = {
  id: 'todos',
  name: 'TODO Kanban',
  version: '1.0.0',
  capabilities: ['storage', 'chat:create'],
};

function makeApp() {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-todos-test-'));
  const router = Router();
  const app = express();
  app.use(express.json());

  const emitEvent = vi.fn();
  const deps: PluginContextDeps = {
    manifest: todosManifest,
    pluginDir: tmpDir,
    router,
    logger: pino({ level: 'silent' }),
    daemonBus: new EventEmitter(),
    db: {
      chats: {
        create: vi.fn().mockReturnValue({ id: 'chat-1', adapterId: 'claude', projectId: 'proj-1', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, lastContextTokensInput: 0 }),
        get: vi.fn().mockReturnValue(null),
        list: vi.fn().mockReturnValue([]),
      },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
    } as unknown as PluginContextDeps['db'],
    adapters: { register: vi.fn() } as unknown as PluginContextDeps['adapters'],
    emitEvent,
    onUnloadCallbacks: [],
  };

  const ctx = buildPluginContext(deps);
  activate(ctx);
  app.use('/', router);
  return { app, emitEvent };
}

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('todos plugin routes', () => {
  it('GET /todos returns empty list initially', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body.todos).toEqual([]);
  });

  it('POST /todos creates a todo', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/todos').send({ title: 'Fix login bug', type: 'bug' });
    expect(res.status).toBe(201);
    expect(res.body.todo.title).toBe('Fix login bug');
    expect(res.body.todo.type).toBe('bug');
    expect(res.body.todo.status).toBe('open');
    expect(res.body.todo.id).toBeDefined();
  });

  it('PATCH /todos/:id/move changes status', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Test' });
    const id = create.body.todo.id;
    const res = await request(app).patch(`/todos/${id}/move`).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.todo.status).toBe('in_progress');
  });

  it('DELETE /todos/:id removes a todo', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Delete me' });
    const id = create.body.todo.id;
    await request(app).delete(`/todos/${id}`);
    const list = await request(app).get('/todos');
    expect(list.body.todos).toHaveLength(0);
  });

  it('POST /todos/:id/start-session creates a chat and emits event', async () => {
    const { app, emitEvent } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Big feature' });
    const id = create.body.todo.id;
    const res = await request(app)
      .post(`/todos/${id}/start-session`)
      .send({ projectId: 'proj-1' });
    expect(res.status).toBe(200);
    expect(res.body.chatId).toBe('chat-1');
    expect(res.body.initialMessage).toContain('Big feature');
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.created' }));
  });
});
```

**Step 3: Run test — expect FAIL**

```bash
pnpm --filter @mainframe/core test packages/core/src/__tests__/plugins/builtin/todos.test.ts
```
Expected: FAIL — module not found.

**Step 4: Create `packages/core/src/plugins/builtin/todos/index.ts`**

```typescript
import type { PluginContext } from '@mainframe/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';

interface TodoRow {
  id: string; title: string; body: string; status: string; type: string;
  priority: string; labels: string; assignees: string;
  milestone: string | null; order_index: number;
  created_at: string; updated_at: string;
}

interface Todo extends Omit<TodoRow, 'labels' | 'assignees'> {
  labels: string[]; assignees: string[];
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium', labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]', milestone TEXT,
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`;

const parseTodo = (r: TodoRow): Todo => ({
  ...r, labels: JSON.parse(r.labels), assignees: JSON.parse(r.assignees),
});

const TodoSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
  type: z.enum(['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid']).default('feature'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().optional(),
});

function buildInitialMessage(todo: Todo): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const labels = todo.labels.length > 0 ? todo.labels.join(', ') : 'none';
  const parts = [
    `I'm working on this task from the kanban board:`,
    ``,
    `**${todo.title}**`,
    `Type: ${cap(todo.type)} | Priority: ${cap(todo.priority)} | Labels: ${labels}`,
    ...(todo.milestone ? [`Milestone: ${todo.milestone}`] : []),
    ...(todo.body ? [``, `## Description`, todo.body] : []),
  ];
  return parts.join('\n');
}

function registerTodoRoutes(ctx: PluginContext): void {
  const r = ctx.router;

  r.get('/todos', (_req, res) => {
    const rows = ctx.db.prepare<TodoRow>('SELECT * FROM todos ORDER BY status, order_index, created_at').all();
    res.json({ todos: rows.map(parseTodo) });
  });

  r.post('/todos', (req, res) => {
    const parsed = TodoSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }
    const d = parsed.data;
    const now = new Date().toISOString();
    const id = nanoid();
    ctx.db.prepare(`INSERT INTO todos (id,title,body,status,type,priority,labels,assignees,milestone,order_index,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, d.title, d.body, d.status, d.type, d.priority, JSON.stringify(d.labels), JSON.stringify(d.assignees), d.milestone ?? null, 0, now, now);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    res.status(201).json({ todo: parseTodo(row) });
  });

  r.patch('/todos/:id', (req, res) => {
    const { id } = req.params;
    if (!ctx.db.prepare<TodoRow>('SELECT id FROM todos WHERE id = ?').get(id)) {
      res.status(404).json({ error: 'Not found' }); return;
    }
    const parsed = TodoSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }
    const d = parsed.data;
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    if (d.title !== undefined) { sets.push('title = ?'); vals.push(d.title); }
    if (d.body !== undefined) { sets.push('body = ?'); vals.push(d.body); }
    if (d.status !== undefined) { sets.push('status = ?'); vals.push(d.status); }
    if (d.type !== undefined) { sets.push('type = ?'); vals.push(d.type); }
    if (d.priority !== undefined) { sets.push('priority = ?'); vals.push(d.priority); }
    if (d.labels !== undefined) { sets.push('labels = ?'); vals.push(JSON.stringify(d.labels)); }
    if (d.assignees !== undefined) { sets.push('assignees = ?'); vals.push(JSON.stringify(d.assignees)); }
    if (d.milestone !== undefined) { sets.push('milestone = ?'); vals.push(d.milestone); }
    vals.push(id);
    ctx.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    res.json({ todo: parseTodo(row) });
  });

  r.patch('/todos/:id/move', (req, res) => {
    const { id } = req.params;
    const parsed = z.object({ status: z.enum(['open', 'in_progress', 'done']) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid status' }); return; }
    ctx.db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?')
      .run(parsed.data.status, new Date().toISOString(), id);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ todo: parseTodo(row) });
  });

  r.delete('/todos/:id', (req, res) => {
    ctx.db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });
}

function registerSessionRoute(ctx: PluginContext): void {
  ctx.router.post('/todos/:id/start-session', async (req, res) => {
    const { id } = req.params;
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    const parsed = z.object({ projectId: z.string() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'projectId required' }); return; }
    if (!ctx.services.chats.createChat) {
      res.status(403).json({ error: 'chat:create capability required' }); return;
    }
    const todo = parseTodo(row);
    const { chatId } = await ctx.services.chats.createChat({ projectId: parsed.data.projectId });
    res.json({ chatId, initialMessage: buildInitialMessage(todo) });
  });
}

function registerAttachmentRoutes(ctx: PluginContext): void {
  const r = ctx.router;

  r.get('/todos/:id/attachments', async (req, res) => {
    const metas = await ctx.attachments.list(req.params.id);
    res.json({ attachments: metas });
  });

  r.post('/todos/:id/attachments', async (req, res) => {
    const row = ctx.db.prepare<{ id: string }>('SELECT id FROM todos WHERE id = ?').get(req.params.id);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    const { filename, mimeType, data, sizeBytes } = req.body as Record<string, unknown>;
    if (typeof filename !== 'string' || typeof data !== 'string') {
      res.status(400).json({ error: 'filename and data required' }); return;
    }
    const meta = await ctx.attachments.save(req.params.id, {
      filename, mimeType: (mimeType as string) || 'application/octet-stream',
      data, sizeBytes: (sizeBytes as number) || 0,
    });
    res.status(201).json({ attachment: meta });
  });

  r.get('/todos/:id/attachments/:attachmentId', async (req, res) => {
    const result = await ctx.attachments.get(req.params.id, req.params.attachmentId);
    if (!result) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result);
  });

  r.delete('/todos/:id/attachments/:attachmentId', async (req, res) => {
    await ctx.attachments.delete(req.params.id, req.params.attachmentId);
    res.status(204).send();
  });
}

export function activate(ctx: PluginContext): void {
  ctx.db.runMigration(MIGRATION);
  registerTodoRoutes(ctx);
  registerSessionRoute(ctx);
  registerAttachmentRoutes(ctx);
  ctx.logger.info('TODO Kanban plugin activated');
  ctx.onUnload(() => { ctx.logger.info('TODO Kanban plugin unloaded'); });
}
```

**Step 5: Run test — expect PASS**

```bash
pnpm --filter @mainframe/core test packages/core/src/__tests__/plugins/builtin/todos.test.ts
```
Expected: All 5 tests pass.

**Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/todos/ packages/core/src/__tests__/plugins/builtin/
git commit -m "feat(core): add todos builtin plugin backend with CRUD + session + attachment routes"
```

---

## Task 6: Register todos builtin in daemon

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Add imports at top of `index.ts`** (after Claude imports):

```typescript
import todosManifest from './plugins/builtin/todos/manifest.json' with { type: 'json' };
import { activate as activateTodos } from './plugins/builtin/todos/index.js';
```

**Step 2: Add `mkdir` import** (for creating the plugin dir):

Add `mkdir` to the existing `node:fs/promises` import... actually just use the `getDataDir` utility with `mkdirSync`. Add after the existing imports:

```typescript
import { mkdirSync } from 'node:fs';
```

**Step 3: Register the todos builtin** — after the Claude loadBuiltin line (around line 46):

```typescript
  // Load todos builtin plugin
  const todosPluginDir = join(getDataDir(), 'plugins', 'todos');
  mkdirSync(todosPluginDir, { recursive: true });
  await pluginManager.loadBuiltin(todosManifest as PluginManifest, activateTodos, { pluginDir: todosPluginDir });
```

**Step 4: Build core**

```bash
pnpm --filter @mainframe/core build
```
Expected: No errors.

**Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): register todos builtin plugin in daemon"
```

---

## Task 7: Extend desktop tab system with `TodosTab`

**Files:**
- Modify: `packages/desktop/src/renderer/store/tabs.ts`

**Step 1: Add `TodosTab` type** (after the `ChatTab` type definition, around line 5):

```typescript
export type TodosTab = { type: 'todos'; id: 'todos'; label: 'Tasks' };
```

Change the union:
```typescript
// Keep CenterTab as union so existing imports still resolve
export type CenterTab = ChatTab | TodosTab;
```

**Step 2: Add `openTodosTab()` to `TabsState` interface** (after `openSkillEditorTab`):

```typescript
  openTodosTab(): void;
```

**Step 3: Implement `openTodosTab`** (in the `create` call, after `openSkillEditorTab`):

```typescript
  openTodosTab: () => {
    get().openTab({ type: 'todos', id: 'todos', label: 'Tasks' });
  },
```

**Step 4: Fix `migrateSnapshot`** — ensure the filter preserves todos tabs if loaded from localStorage:

Change line:
```typescript
const tabs = (raw.tabs ?? []).filter((t) => t.type === 'chat') as CenterTab[];
```
to:
```typescript
const tabs = (raw.tabs ?? []).filter((t) => t.type === 'chat' || t.type === 'todos') as CenterTab[];
```

**Step 5: Run desktop tests**

```bash
pnpm --filter @mainframe/desktop test
```
Expected: All existing tests pass. (Tabs store tests may need a quick scan — todos tab has a fixed id `'todos'` and is deduped by the existing `openTab` logic.)

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/store/tabs.ts
git commit -m "feat(desktop): add TodosTab type and openTodosTab() to tab store"
```

---

## Task 8: Add Tasks button to `ProjectRail`

**Files:**
- Modify: `packages/desktop/src/renderer/components/ProjectRail.tsx`

**Step 1: Add `SquareCheck` to the Lucide import** (top of file, currently imports `Plus`, `Settings`, `HelpCircle`, `X`, `Check`):

```typescript
import { Plus, Settings, HelpCircle, X, Check, SquareCheck } from 'lucide-react';
```

**Step 2: Add `useTabsStore` import** (after existing imports):

```typescript
import { useTabsStore } from '../store/tabs';
```

**Step 3: Add Tasks button** — in the "Bottom actions" section (around line 144), INSERT the Tasks button BEFORE the Settings button:

```tsx
        <button
          onClick={() => useTabsStore.getState().openTodosTab()}
          className="w-8 h-8 flex items-center justify-center rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          title="Tasks"
          aria-label="Open task board"
        >
          <SquareCheck size={16} />
        </button>
```

**Step 4: Typecheck desktop**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: No type errors.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/ProjectRail.tsx
git commit -m "feat(desktop): add Tasks button to ProjectRail above Settings/About"
```

---

## Task 9: Create the API client for the todos plugin

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/todos-api.ts`

**Step 1: Create the file**

```typescript
const BASE = 'http://localhost:31415/api/plugins/todos';

export type TodoStatus = 'open' | 'in_progress' | 'done';
export type TodoType = 'bug' | 'feature' | 'enhancement' | 'documentation' | 'question' | 'wont_fix' | 'duplicate' | 'invalid';
export type TodoPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Todo {
  id: string;
  title: string;
  body: string;
  status: TodoStatus;
  type: TodoType;
  priority: TodoPriority;
  labels: string[];
  assignees: string[];
  milestone?: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTodoInput {
  title: string;
  body?: string;
  status?: TodoStatus;
  type?: TodoType;
  priority?: TodoPriority;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
}

export type UpdateTodoInput = Partial<CreateTodoInput>;

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`Todos API error ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const todosApi = {
  list: () => api<{ todos: Todo[] }>('/todos').then((r) => r.todos),
  create: (input: CreateTodoInput) =>
    api<{ todo: Todo }>('/todos', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.todo),
  update: (id: string, input: UpdateTodoInput) =>
    api<{ todo: Todo }>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(input) }).then((r) => r.todo),
  move: (id: string, status: TodoStatus) =>
    api<{ todo: Todo }>(`/todos/${id}/move`, { method: 'PATCH', body: JSON.stringify({ status }) }).then((r) => r.todo),
  remove: (id: string) => api<void>(`/todos/${id}`, { method: 'DELETE' }),
  startSession: (id: string, projectId: string) =>
    api<{ chatId: string; initialMessage: string }>(`/todos/${id}/start-session`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  listAttachments: (id: string) =>
    api<{ attachments: AttachmentMeta[] }>(`/todos/${id}/attachments`).then((r) => r.attachments),
  uploadAttachment: (id: string, file: { filename: string; mimeType: string; data: string; sizeBytes: number }) =>
    api<{ attachment: AttachmentMeta }>(`/todos/${id}/attachments`, {
      method: 'POST',
      body: JSON.stringify(file),
    }).then((r) => r.attachment),
  deleteAttachment: (id: string, attachmentId: string) =>
    api<void>(`/todos/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
};
```

**Step 2: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/todos-api.ts
git commit -m "feat(desktop): add todos API client"
```

---

## Task 10: Create `TodoCard` component

**Files:**
- Create: `packages/desktop/src/renderer/components/todos/TodoCard.tsx`

**Step 1: Create `packages/desktop/src/renderer/components/todos/TodoCard.tsx`**

```tsx
import React from 'react';
import { ArrowLeft, ArrowRight, Play, Edit, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo, TodoStatus } from '../../lib/api/todos-api';

const TYPE_COLORS: Record<string, string> = {
  bug: 'bg-red-500/15 text-red-400',
  feature: 'bg-blue-500/15 text-blue-400',
  enhancement: 'bg-purple-500/15 text-purple-400',
  documentation: 'bg-gray-500/15 text-mf-text-secondary',
  question: 'bg-yellow-500/15 text-yellow-400',
  wont_fix: 'bg-gray-500/10 text-mf-text-secondary',
  duplicate: 'bg-orange-500/15 text-orange-400',
  invalid: 'bg-gray-500/10 text-mf-text-secondary',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-mf-text-secondary',
};

const COLUMN_ORDER: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  todo: Todo;
  onMove: (id: string, status: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onStartSession: (todo: Todo) => void;
}

export function TodoCard({ todo, onMove, onEdit, onDelete, onStartSession }: Props): React.ReactElement {
  const colIdx = COLUMN_ORDER.indexOf(todo.status);
  const canMoveLeft = colIdx > 0;
  const canMoveRight = colIdx < COLUMN_ORDER.length - 1;

  return (
    <div className="bg-mf-app-bg rounded-mf-input p-3 space-y-2 border border-mf-border group">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-mf-status font-medium px-1.5 py-0.5 rounded capitalize', TYPE_COLORS[todo.type] ?? 'bg-mf-hover text-mf-text-secondary')}>
          {todo.type.replace('_', ' ')}
        </span>
        <span className={cn('text-mf-status font-medium capitalize', PRIORITY_COLORS[todo.priority] ?? '')}>
          {todo.priority}
        </span>
      </div>

      {/* Title */}
      <p className="text-mf-small text-mf-text-primary leading-snug">{todo.title}</p>

      {/* Labels */}
      {todo.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {todo.labels.map((l) => (
            <span key={l} className="text-mf-status bg-mf-hover px-1.5 py-0.5 rounded text-mf-text-secondary">
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          {canMoveLeft && (
            <button
              onClick={() => onMove(todo.id, COLUMN_ORDER[colIdx - 1]!)}
              className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
              title="Move left"
              aria-label="Move to previous column"
            >
              <ArrowLeft size={12} />
            </button>
          )}
          {canMoveRight && (
            <button
              onClick={() => onMove(todo.id, COLUMN_ORDER[colIdx + 1]!)}
              className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
              title="Move right"
              aria-label="Move to next column"
            >
              <ArrowRight size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {todo.status === 'in_progress' && (
            <button
              onClick={() => onStartSession(todo)}
              className="flex items-center gap-1 px-2 py-1 rounded text-mf-small text-mf-accent hover:bg-mf-accent/10 transition-colors"
              title="Start in session"
              aria-label="Start in new session"
            >
              <Play size={11} />
              Session
            </button>
          )}
          <button
            onClick={() => onEdit(todo)}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors opacity-0 group-hover:opacity-100"
            title="Edit"
            aria-label="Edit task"
          >
            <Edit size={12} />
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="p-1 rounded text-mf-text-secondary hover:text-mf-destructive hover:bg-mf-hover transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
            aria-label="Delete task"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | head -30
```
Expected: No errors in this file.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/TodoCard.tsx
git commit -m "feat(desktop): add TodoCard component"
```

---

## Task 11: Create `TodoModal` component

**Files:**
- Create: `packages/desktop/src/renderer/components/todos/TodoModal.tsx`

**Step 1: Create `packages/desktop/src/renderer/components/todos/TodoModal.tsx`**

```tsx
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Todo, CreateTodoInput, TodoStatus, TodoType, TodoPriority } from '../../lib/api/todos-api';

const TYPES: TodoType[] = ['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid'];
const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  todo?: Todo | null;
  onClose: () => void;
  onSave: (data: CreateTodoInput) => void;
}

export function TodoModal({ todo, onClose, onSave }: Props): React.ReactElement {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [body, setBody] = useState(todo?.body ?? '');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'open');
  const [type, setType] = useState<TodoType>(todo?.type ?? 'feature');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'medium');
  const [labels, setLabels] = useState((todo?.labels ?? []).join(', '));
  const [assignees, setAssignees] = useState((todo?.assignees ?? []).join(', '));
  const [milestone, setMilestone] = useState(todo?.milestone ?? '');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(), body: body.trim(), status, type, priority,
      labels: labels.split(',').map((l) => l.trim()).filter(Boolean),
      assignees: assignees.split(',').map((a) => a.trim()).filter(Boolean),
      milestone: milestone.trim() || undefined,
    });
  };

  const field = 'flex flex-col gap-1';
  const label = 'text-mf-small text-mf-text-secondary';
  const input = 'bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1.5 text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent';
  const select = cn(input, 'cursor-pointer capitalize');

  function cn(...classes: string[]) { return classes.filter(Boolean).join(' '); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-mf-panel-bg rounded-mf-panel border border-mf-border w-full max-w-lg mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-body font-medium text-mf-text-primary">{todo ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="p-1 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className={field}>
            <label className={label}>Title *</label>
            <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus required />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className={field}>
              <label className={label}>Type</label>
              <select className={select} value={type} onChange={(e) => setType(e.target.value as TodoType)}>
                {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className={field}>
              <label className={label}>Priority</label>
              <select className={select} value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className={field}>
              <label className={label}>Status</label>
              <select className={select} value={status} onChange={(e) => setStatus(e.target.value as TodoStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>

          <div className={field}>
            <label className={label}>Description (markdown)</label>
            <textarea className={cn(input, 'resize-none')} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the task..." />
          </div>

          <div className={field}>
            <label className={label}>Labels (comma-separated)</label>
            <input className={input} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="e.g. ui, backend, urgent" />
          </div>

          <div className={field}>
            <label className={label}>Assignees (comma-separated)</label>
            <input className={input} value={assignees} onChange={(e) => setAssignees(e.target.value)} placeholder="e.g. alice, bob" />
          </div>

          <div className={field}>
            <label className={label}>Milestone</label>
            <input className={input} value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="e.g. v1.0, Q1 2026" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover transition-colors">Cancel</button>
            <button type="submit" disabled={!title.trim()} className="px-3 py-1.5 rounded-mf-input text-mf-small bg-mf-accent text-white disabled:opacity-40 hover:bg-mf-accent/90 transition-colors">
              {todo ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/TodoModal.tsx
git commit -m "feat(desktop): add TodoModal component with GitHub-compatible fields"
```

---

## Task 12: Create `TodosPanel` main kanban board

**Files:**
- Create: `packages/desktop/src/renderer/components/todos/TodosPanel.tsx`

**Step 1: Create `packages/desktop/src/renderer/components/todos/TodosPanel.tsx`**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { todosApi, type Todo, type TodoStatus, type CreateTodoInput } from '../../lib/api/todos-api';
import { TodoCard } from './TodoCard';
import { TodoModal } from './TodoModal';
import { useProjectsStore } from '../../store';
import { useSkillsStore } from '../../store/skills';
import { daemonClient } from '../../lib/client';

const COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
];

export function TodosPanel(): React.ReactElement {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const loadTodos = useCallback(async () => {
    try {
      setError(null);
      const list = await todosApi.list();
      setTodos(list);
    } catch (err) {
      setError('Failed to load tasks. Is the daemon running?');
      console.warn('[todos] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  const handleCreate = useCallback(async (data: CreateTodoInput) => {
    try {
      const todo = await todosApi.create(data);
      setTodos((prev) => [...prev, todo]);
      setModalOpen(false);
    } catch (err) {
      console.warn('[todos] create failed:', err);
    }
  }, []);

  const handleUpdate = useCallback(async (data: CreateTodoInput) => {
    if (!editingTodo) return;
    try {
      const updated = await todosApi.update(editingTodo.id, data);
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingTodo(null);
    } catch (err) {
      console.warn('[todos] update failed:', err);
    }
  }, [editingTodo]);

  const handleMove = useCallback(async (id: string, status: TodoStatus) => {
    try {
      const updated = await todosApi.move(id, status);
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.warn('[todos] move failed:', err);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await todosApi.remove(id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.warn('[todos] delete failed:', err);
    }
  }, []);

  const handleStartSession = useCallback(async (todo: Todo) => {
    if (!activeProjectId) return;
    try {
      const { chatId, initialMessage } = await todosApi.startSession(todo.id, activeProjectId);
      // Pre-fill the composer using the existing pendingInvocation mechanism
      useSkillsStore.getState().setPendingInvocation(initialMessage);
      // chat.created WS event will open the tab automatically
      daemonClient.subscribe(chatId);
    } catch (err) {
      console.warn('[todos] start-session failed:', err);
    }
  }, [activeProjectId]);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">Loading tasks…</div>;
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-mf-text-secondary text-mf-small px-4 text-center">
        <p>{error}</p>
        <button onClick={loadTodos} className="text-mf-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-11 px-4 flex items-center justify-between shrink-0 border-b border-mf-border">
        <span className="text-mf-small text-mf-text-secondary uppercase tracking-wider">Tasks</span>
        <button
          onClick={() => { setEditingTodo(null); setModalOpen(true); }}
          className="flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
          title="New Task"
          aria-label="Create new task"
        >
          <Plus size={13} />
          New
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 flex gap-0 overflow-hidden">
        {COLUMNS.map(({ status, label }) => {
          const colTodos = todos.filter((t) => t.status === status);
          return (
            <div key={status} className="flex-1 flex flex-col border-r border-mf-border last:border-r-0 overflow-hidden">
              <div className="px-3 py-2 text-mf-small font-medium text-mf-text-secondary flex items-center gap-1.5 shrink-0">
                <span>{label}</span>
                <span className="bg-mf-hover px-1.5 py-0.5 rounded text-mf-status">{colTodos.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {colTodos.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    onMove={handleMove}
                    onEdit={(t) => { setEditingTodo(t); setModalOpen(true); }}
                    onDelete={handleDelete}
                    onStartSession={handleStartSession}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalOpen && (
        <TodoModal
          todo={editingTodo}
          onClose={() => { setModalOpen(false); setEditingTodo(null); }}
          onSave={editingTodo ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build 2>&1 | grep -E "error|Error" | head -20
```
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/todos/TodosPanel.tsx
git commit -m "feat(desktop): add TodosPanel kanban board component"
```

---

## Task 13: Wire `TodosPanel` into `CenterPanel`

**Files:**
- Modify: `packages/desktop/src/renderer/components/center/CenterPanel.tsx`

**Step 1: Add `TodosPanel` import** (at top, after existing imports):

```typescript
import { TodosPanel } from '../todos/TodosPanel';
```

**Step 2: Update `activePrimaryTab` rendering** — in the "existing tab" render block (around line 96-99), the current code is:

```tsx
        ) : (
          <ChatContainer chatId={activePrimaryTab.chatId} />
        )}
```

Change to:
```tsx
        ) : activePrimaryTab.type === 'todos' ? (
          <TodosPanel />
        ) : (
          <ChatContainer chatId={(activePrimaryTab as import('../../store/tabs').ChatTab).chatId} />
        )}
```

**Step 3: Run typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: No errors. If there are type issues with the discriminated union, cast `activePrimaryTab` explicitly using the narrowed type check.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/center/CenterPanel.tsx
git commit -m "feat(desktop): render TodosPanel for todos tab in CenterPanel"
```

---

## Task 14: Full typecheck and tests

**Step 1: Typecheck all packages**

```bash
pnpm build
```
Expected: All packages build with no type errors.

**Step 2: Run core tests**

```bash
pnpm --filter @mainframe/core test
```
Expected: All tests pass. Coverage thresholds met.

**Step 3: Run desktop tests**

```bash
pnpm --filter @mainframe/desktop test
```
Expected: All tests pass.

**Step 4: If anything fails, fix and commit fixes**

Follow test output. Common issues:
- Missing `afterEach` import in attachment test — add `import { afterEach } from 'vitest'`
- CenterPanel type narrowing — use `activePrimaryTab.type === 'chat'` guard
- `supertest` not installed — run `pnpm --filter @mainframe/core add -D supertest @types/supertest`

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix typecheck and test issues for todos plugin"
```

---

## Task 15: Verify end-to-end manually

**Step 1: Build and start**

```bash
pnpm build && pnpm --filter @mainframe/desktop start
```

**Step 2: Verify the Tasks button**
- Open the app
- The `ProjectRail` bottom section should show ✓ Tasks button above ⚙ Settings and ? Help

**Step 3: Verify the kanban board**
- Click the Tasks button
- A "Tasks" tab opens in the center panel
- 3 columns: Open, In Progress, Done

**Step 4: Verify CRUD**
- Click "+ New" → modal opens → fill fields → Create
- Card appears in Open column
- Use arrow buttons to move to In Progress
- "Session" button appears on the card
- Click edit → modal pre-fills with existing data → save

**Step 5: Verify "Start in Session"**
- Move a card to "In Progress"
- Click "▶ Session"
- A new chat tab opens
- The composer is pre-filled with the task context message

---

## Summary: Plugin System Architectural Changes

For the user: these changes were required to support the TODO plugin and fill gaps in the plugin system:

| Change | File | Why |
|--------|------|-----|
| `PluginAttachmentContext` type | `packages/types/src/plugin.ts` | Chat-scoped `AttachmentStore` couldn't serve plugin-owned files |
| `ctx.attachments` implementation | `packages/core/src/plugins/attachment-context.ts` | Needed plugin-isolated entity-scoped storage |
| Wire `attachments` into context | `packages/core/src/plugins/context.ts` | Connect the implementation to the plugin contract |
| Implement `createChat` | `packages/core/src/plugins/services/chat-service.ts` | Capability was declared in types but never implemented |
| `pluginDir` option on `loadBuiltin` | `packages/core/src/plugins/manager.ts` | Builtins with `storage` need a real data directory |
