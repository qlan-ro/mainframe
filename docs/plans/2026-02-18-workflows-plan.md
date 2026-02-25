# Workflows Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a plugin system to the OSS core and a Workflows premium plugin that lets users build, visualize, and execute DAG-based agent workflows backed by Temporal.io.

**Architecture:** The daemon gains a `PluginManager` that discovers and loads plugins from `~/.mainframe/plugins/*/`. Plugins receive a `PluginContext` API to extend routes, events, DB, and UI. The Workflows plugin (in `packages/plugin-workflows/`) uses this API to register Temporal-backed workflow execution, a YAML DSL parser, and a React Flow visual editor.

**Tech Stack:** Temporal.io (`@temporalio/client`, `@temporalio/worker`), `@xyflow/react` (React Flow), `js-yaml`, `ajv` (JSON Schema validation), `mustache` (template interpolation), `better-sqlite3` (existing), `@temporalio/testing` (unit tests)

**Design doc:** `docs/plans/2026-02-18-workflows-design.md`

---

## Phase 1: Plugin System (OSS Core)

### Task 1: Plugin types in @mainframe/types

**Files:**
- Create: `packages/types/src/plugin.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the failing type-check test**

Create `packages/types/src/__tests__/plugin.test.ts`:
```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { PluginManifest, PluginContext, PluginRouter, PluginEventBus, PluginDatabaseContext, PluginUIContext, PluginConfig } from '../plugin.js';

describe('plugin types', () => {
  it('PluginManifest has required fields', () => {
    expectTypeOf<PluginManifest>().toMatchTypeOf<{ id: string; name: string; version: string }>();
  });
  it('PluginContext has all subsystems', () => {
    expectTypeOf<PluginContext['router']>().toEqualTypeOf<PluginRouter>();
    expectTypeOf<PluginContext['events']>().toEqualTypeOf<PluginEventBus>();
    expectTypeOf<PluginContext['db']>().toEqualTypeOf<PluginDatabaseContext>();
    expectTypeOf<PluginContext['ui']>().toEqualTypeOf<PluginUIContext>();
    expectTypeOf<PluginContext['config']>().toEqualTypeOf<PluginConfig>();
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/types test
```
Expected: FAIL — `plugin.ts` not found.

**Step 3: Create `packages/types/src/plugin.ts`**

```typescript
import type { Router, Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
}

export type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface PluginRouter {
  get(path: string, handler: (req: Request, res: Response, next: NextFunction) => void): void;
  post(path: string, handler: (req: Request, res: Response, next: NextFunction) => void): void;
  put(path: string, handler: (req: Request, res: Response, next: NextFunction) => void): void;
  patch(path: string, handler: (req: Request, res: Response, next: NextFunction) => void): void;
  delete(path: string, handler: (req: Request, res: Response, next: NextFunction) => void): void;
}

export interface PluginEventBus {
  emit(event: string, data: unknown): void;
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
}

export interface PluginDatabaseContext {
  runMigration(sql: string): void;
  prepare<T = unknown>(sql: string): Database.Statement<T[]>;
  transaction<T>(fn: () => T): T;
}

export interface PluginUIContribution {
  type: 'panel';
  id: string;
  label: string;
  icon?: string;
}

export interface PluginUIContext {
  addPanel(contribution: Omit<PluginUIContribution, 'type'>): void;
  sendNotification(notification: { id: string; title: string; body: string; pluginId: string }): void;
}

export interface PluginConfig {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface PluginServices {
  chats: {
    getChat(chatId: string): unknown;
    listChats(projectId: string): unknown[];
  };
  projects: {
    getProject(projectId: string): unknown;
    listProjects(): unknown[];
  };
}

export interface PluginContext {
  router: PluginRouter;
  events: PluginEventBus;
  db: PluginDatabaseContext;
  ui: PluginUIContext;
  config: PluginConfig;
  services: PluginServices;
  logger: Logger;
  onUnload(fn: () => void | Promise<void>): void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): Promise<void>;
}
```

**Step 4: Export from `packages/types/src/index.ts`**

Add to existing exports:
```typescript
export * from './plugin.js';
```

**Step 5: Run to verify it passes**

```bash
pnpm --filter @mainframe/types test
pnpm --filter @mainframe/types build
```

**Step 6: Commit**

```bash
git add packages/types/src/plugin.ts packages/types/src/index.ts packages/types/src/__tests__/plugin.test.ts
git commit -m "feat(types): add plugin system types"
```

---

### Task 2: PluginManager — discovery and loading

**Files:**
- Create: `packages/core/src/plugins/plugin-manager.ts`
- Create: `packages/core/src/__tests__/plugins/plugin-manager.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../../plugins/plugin-manager.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('PluginManager', () => {
  let pluginsDir: string;
  let manager: PluginManager;

  beforeEach(async () => {
    pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-plugins-'));
    manager = new PluginManager(pluginsDir);
  });

  it('discovers plugins with valid manifests', async () => {
    const pluginDir = path.join(pluginsDir, 'test-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'test-plugin', name: 'Test Plugin', version: '1.0.0'
    }));
    await fs.writeFile(path.join(pluginDir, 'index.js'), `
      export async function activate(ctx) {
        ctx.logger.info('activated');
      }
    `);

    const discovered = await manager.discover();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.manifest.id).toBe('test-plugin');
  });

  it('skips directories without manifest.json', async () => {
    const pluginDir = path.join(pluginsDir, 'no-manifest');
    await fs.mkdir(pluginDir, { recursive: true });

    const discovered = await manager.discover();
    expect(discovered).toHaveLength(0);
  });

  it('skips plugins with invalid manifests', async () => {
    const pluginDir = path.join(pluginsDir, 'bad-manifest');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'manifest.json'), '{ "bad": true }');

    const discovered = await manager.discover();
    expect(discovered).toHaveLength(0);
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/core test src/__tests__/plugins/plugin-manager.test.ts
```

**Step 3: Implement `packages/core/src/plugins/plugin-manager.ts`**

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { createChildLogger } from '../logger.js';
import type { PluginManifest } from '@mainframe/types';

const logger = createChildLogger('plugin-manager');

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
});

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  dir: string;
  indexPath: string;
}

export class PluginManager {
  private readonly pluginsDir: string;
  private loaded: Map<string, { unload: () => Promise<void> }> = new Map();

  constructor(pluginsDir: string = path.join(os.homedir(), '.mainframe', 'plugins')) {
    this.pluginsDir = pluginsDir;
  }

  async discover(): Promise<DiscoveredPlugin[]> {
    const discovered: DiscoveredPlugin[] = [];
    let entries: string[];
    try {
      entries = await fs.readdir(this.pluginsDir);
    } catch {
      // plugins dir doesn't exist yet — that's fine
      return [];
    }

    for (const entry of entries) {
      const dir = path.join(this.pluginsDir, entry);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const manifestPath = path.join(dir, 'manifest.json');
      const manifestRaw = await fs.readFile(manifestPath, 'utf-8').catch(() => null);
      if (!manifestRaw) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestRaw);
      } catch {
        logger.warn({ dir }, 'Plugin has invalid JSON manifest');
        continue;
      }

      const result = ManifestSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn({ dir, errors: result.error.issues }, 'Plugin manifest failed validation');
        continue;
      }

      const indexPath = path.join(dir, 'index.js');
      const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);
      if (!indexExists) {
        logger.warn({ dir }, 'Plugin has no index.js');
        continue;
      }

      discovered.push({ manifest: result.data, dir, indexPath });
    }

    return discovered;
  }

  getLoaded(): string[] {
    return [...this.loaded.keys()];
  }

  registerUnload(pluginId: string, fn: () => Promise<void>): void {
    this.loaded.set(pluginId, { unload: fn });
  }

  async unloadAll(): Promise<void> {
    for (const [id, { unload }] of this.loaded) {
      try {
        await unload();
      } catch (err) {
        logger.error({ pluginId: id, err }, 'Error unloading plugin');
      }
    }
    this.loaded.clear();
  }
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/core test src/__tests__/plugins/plugin-manager.test.ts
```

**Step 5: Commit**

```bash
git add packages/core/src/plugins/plugin-manager.ts packages/core/src/__tests__/plugins/plugin-manager.test.ts
git commit -m "feat(core): add PluginManager for plugin discovery"
```

---

### Task 3: PluginContext builder

**Files:**
- Create: `packages/core/src/plugins/plugin-context.ts`
- Create: `packages/core/src/plugins/plugin-event-bus.ts`
- Create: `packages/core/src/plugins/plugin-router.ts`
- Create: `packages/core/src/plugins/plugin-db-context.ts`
- Create: `packages/core/src/plugins/plugin-ui-context.ts`

**Step 1: Write failing test**

Create `packages/core/src/__tests__/plugins/plugin-context.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildPluginContext } from '../../plugins/plugin-context.js';
import Database from 'better-sqlite3';

describe('buildPluginContext', () => {
  it('returns a context with all required subsystems', () => {
    const db = new Database(':memory:');
    const ctx = buildPluginContext({
      pluginId: 'test',
      db,
      globalEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      uiNotify: vi.fn(),
      uiContributions: [],
      dbMock: db,
    });

    expect(ctx.router).toBeDefined();
    expect(ctx.events).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.ui).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(ctx.services).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.onUnload).toBe('function');
  });

  it('db.runMigration executes SQL', () => {
    const db = new Database(':memory:');
    const ctx = buildPluginContext({
      pluginId: 'test',
      db,
      globalEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      uiNotify: vi.fn(),
      uiContributions: [],
      dbMock: db,
    });

    expect(() => {
      ctx.db.runMigration('CREATE TABLE test_table (id TEXT PRIMARY KEY)');
    }).not.toThrow();
  });

  it('config.get/set round-trips via settings table', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE settings (id TEXT, category TEXT, key TEXT, value TEXT, updated_at TEXT, UNIQUE(category, key))`);
    const ctx = buildPluginContext({
      pluginId: 'test',
      db,
      globalEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      uiNotify: vi.fn(),
      uiContributions: [],
      dbMock: db,
    });

    ctx.config.set('licenseKey', 'abc123');
    expect(ctx.config.get('licenseKey')).toBe('abc123');
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/core test src/__tests__/plugins/plugin-context.test.ts
```

**Step 3: Implement the context builder files**

`packages/core/src/plugins/plugin-event-bus.ts`:
```typescript
import type { PluginEventBus } from '@mainframe/types';
import { EventEmitter } from 'node:events';

export function buildPluginEventBus(pluginId: string, emitter: EventEmitter): PluginEventBus {
  const prefixed = (event: string) => `plugin:${pluginId}:${event}`;
  return {
    emit(event, data) { emitter.emit(prefixed(event), data); },
    on(event, listener) { emitter.on(prefixed(event), listener); },
    off(event, listener) { emitter.off(prefixed(event), listener); },
  };
}
```

`packages/core/src/plugins/plugin-router.ts`:
```typescript
import { Router } from 'express';
import type { PluginRouter } from '@mainframe/types';

export function buildPluginRouter(pluginId: string): { router: Router; api: PluginRouter } {
  const router = Router();
  const api: PluginRouter = {
    get: (p, h) => { router.get(p, h); },
    post: (p, h) => { router.post(p, h); },
    put: (p, h) => { router.put(p, h); },
    patch: (p, h) => { router.patch(p, h); },
    delete: (p, h) => { router.delete(p, h); },
  };
  return { router, api };
}
```

`packages/core/src/plugins/plugin-db-context.ts`:
```typescript
import type Database from 'better-sqlite3';
import type { PluginDatabaseContext } from '@mainframe/types';

export function buildPluginDbContext(db: Database.Database): PluginDatabaseContext {
  return {
    runMigration(sql) { db.exec(sql); },
    prepare(sql) { return db.prepare(sql) as any; },
    transaction(fn) { return db.transaction(fn)(); },
  };
}
```

`packages/core/src/plugins/plugin-ui-context.ts`:
```typescript
import type { PluginUIContext, PluginUIContribution } from '@mainframe/types';

export function buildPluginUIContext(
  pluginId: string,
  contributions: PluginUIContribution[],
  notify: (n: { id: string; title: string; body: string; pluginId: string }) => void,
): PluginUIContext {
  return {
    addPanel(panel) {
      contributions.push({ type: 'panel', ...panel });
    },
    sendNotification(notification) {
      notify({ ...notification, pluginId });
    },
  };
}
```

`packages/core/src/plugins/plugin-context.ts`:
```typescript
import type Database from 'better-sqlite3';
import type { PluginContext, PluginUIContribution } from '@mainframe/types';
import { EventEmitter } from 'node:events';
import { createChildLogger } from '../logger.js';
import { buildPluginEventBus } from './plugin-event-bus.js';
import { buildPluginRouter } from './plugin-router.js';
import { buildPluginDbContext } from './plugin-db-context.js';
import { buildPluginUIContext } from './plugin-ui-context.js';
import { Router } from 'express';

export interface PluginContextBuildOptions {
  pluginId: string;
  db: Database.Database;
  globalEventEmitter: EventEmitter;
  uiNotify: (n: { id: string; title: string; body: string; pluginId: string }) => void;
  uiContributions: PluginUIContribution[];
  dbMock?: Database.Database; // for testing
}

export interface BuiltPluginContext {
  ctx: PluginContext;
  expressRouter: Router;
}

export function buildPluginContext(opts: PluginContextBuildOptions): PluginContext {
  const db = opts.dbMock ?? opts.db;
  const unloadFns: Array<() => void | Promise<void>> = [];
  const { router: expressRouter, api: pluginRouter } = buildPluginRouter(opts.pluginId);

  const ctx: PluginContext = {
    router: pluginRouter,
    events: buildPluginEventBus(opts.pluginId, opts.globalEventEmitter),
    db: buildPluginDbContext(db),
    ui: buildPluginUIContext(opts.pluginId, opts.uiContributions, opts.uiNotify),
    config: {
      get(key) {
        const row = db.prepare('SELECT value FROM settings WHERE category = ? AND key = ?')
          .get(`plugin:${opts.pluginId}`, key) as { value: string } | undefined;
        return row?.value;
      },
      set(key, value) {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO settings (id, category, key, value, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(`plugin:${opts.pluginId}:${key}`, `plugin:${opts.pluginId}`, key, value, now);
      },
    },
    services: {
      chats: { getChat: () => null, listChats: () => [] },
      projects: { getProject: () => null, listProjects: () => [] },
    },
    logger: createChildLogger(`plugin:${opts.pluginId}`),
    onUnload(fn) { unloadFns.push(fn); },
  };

  // Attach express router and unload fn collector for PluginManager use
  (ctx as any).__expressRouter = expressRouter;
  (ctx as any).__getUnloadFns = () => unloadFns;

  return ctx;
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/core test src/__tests__/plugins/plugin-context.test.ts
```

**Step 5: Commit**

```bash
git add packages/core/src/plugins/
git commit -m "feat(core): add PluginContext builder and subsystems"
```

---

### Task 4: Wire PluginManager into HTTP server and daemon startup

**Files:**
- Modify: `packages/core/src/server/http.ts`
- Create: `packages/core/src/plugins/index.ts` (barrel)
- Modify: `packages/core/src/index.ts` (daemon entry point — wherever `createHttpServer` is called)

**Step 1: Create the plugins barrel**

`packages/core/src/plugins/index.ts`:
```typescript
export { PluginManager } from './plugin-manager.js';
export { buildPluginContext } from './plugin-context.js';
export type { DiscoveredPlugin } from './plugin-manager.js';
```

**Step 2: Extend `createHttpServer` signature**

In `packages/core/src/server/http.ts`, add an optional `pluginRouters` parameter:
```typescript
export function createHttpServer(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginRouters?: Map<string, import('express').Router>,
): Express {
  // ... existing code ...
  if (pluginRouters) {
    for (const [pluginId, router] of pluginRouters) {
      app.use(`/api/plugins/${pluginId}`, router);
    }
  }
  // ... existing error middleware last ...
}
```

**Step 3: Load plugins in daemon startup**

In the daemon entry point (find with: `grep -r "createHttpServer" packages/core/src --include="*.ts" -l`), add plugin loading before the server starts:

```typescript
import { PluginManager, buildPluginContext } from './plugins/index.js';

// In startup sequence, before createHttpServer:
const pluginManager = new PluginManager();
const pluginRouters = new Map<string, Router>();
const uiContributions: PluginUIContribution[] = [];

const discovered = await pluginManager.discover();
for (const plugin of discovered) {
  try {
    const ctx = buildPluginContext({
      pluginId: plugin.manifest.id,
      db: db.raw(),           // expose raw better-sqlite3 instance
      globalEventEmitter: chats,  // ChatManager is an EventEmitter
      uiNotify: (n) => wsManager.broadcastNotification(n),
      uiContributions,
    });
    const mod = await import(plugin.indexPath);
    await mod.activate(ctx);
    pluginRouters.set(plugin.manifest.id, (ctx as any).__expressRouter);
    const unloadFns: Array<() => void | Promise<void>> = (ctx as any).__getUnloadFns();
    pluginManager.registerUnload(plugin.manifest.id, async () => {
      for (const fn of unloadFns) await fn();
    });
    logger.info({ pluginId: plugin.manifest.id }, 'Plugin loaded');
  } catch (err) {
    logger.error({ pluginId: plugin.manifest.id, err }, 'Failed to load plugin');
  }
}
```

**Step 4: Expose `db.raw()` if not already available**

Check `packages/core/src/db/index.ts` — if `DatabaseManager` doesn't expose the raw `Database` instance, add:
```typescript
raw(): Database.Database { return this.db; }
```

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/core build
```

**Step 6: Commit**

```bash
git add packages/core/src/plugins/index.ts packages/core/src/server/http.ts packages/core/src/index.ts packages/core/src/db/index.ts
git commit -m "feat(core): wire PluginManager into HTTP server and daemon startup"
```

---

## Phase 2: Workflow Types

### Task 5: WorkflowDefinition and WorkflowRun types

**Files:**
- Create: `packages/types/src/workflow.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write failing test**

`packages/types/src/__tests__/workflow.test.ts`:
```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { WorkflowDefinition, WorkflowStep, WorkflowTrigger, WorkflowRun, WorkflowStepRun, StepType, TriggerType, RunStatus, StepStatus } from '../workflow.js';

describe('workflow types', () => {
  it('WorkflowStep has required fields', () => {
    expectTypeOf<WorkflowStep>().toMatchTypeOf<{ id: string; type: StepType }>();
  });
  it('WorkflowDefinition has steps array', () => {
    expectTypeOf<WorkflowDefinition['steps']>().toEqualTypeOf<WorkflowStep[]>();
  });
  it('WorkflowRun has status', () => {
    expectTypeOf<WorkflowRun['status']>().toEqualTypeOf<RunStatus>();
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/types test
```

**Step 3: Create `packages/types/src/workflow.ts`**

```typescript
export type StepType = 'prompt' | 'tool' | 'workflow' | 'human_approval';
export type TriggerType = 'manual' | 'webhook' | 'cron' | 'event';
export type RunStatus = 'pending' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type OnFailure = 'continue' | 'fail' | 'retry' | 'trigger';
export type ToolType = 'bash' | 'curl' | 'fetch' | 'file_read' | 'file_write';

export interface WorkflowTrigger {
  type: TriggerType;
  path?: string;          // webhook: URL path
  method?: string;        // webhook: HTTP method
  schedule?: string;      // cron: cron expression
  on?: string;            // event: event name
  workflow?: string;      // event: source workflow name
}

export interface WorkflowVariable {
  name: string;
  default?: string;
  required?: boolean;
}

export interface StepInput {
  name: string;
  type: 'string' | 'file' | 'json';
  required?: boolean;
}

export interface StepOutputSchema {
  schema: Record<string, unknown>; // JSON Schema
}

export interface AgentConfig {
  adapterId: string;
  agentConfig?: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
}

export interface WorkflowStep {
  id: string;
  name?: string;
  type: StepType;
  depends_on?: string[];
  condition?: string;
  on_failure?: OnFailure;
  on_failure_trigger?: string;
  // prompt step
  agent?: AgentConfig;
  prompt?: string;
  inputs?: StepInput[];
  outputs?: StepOutputSchema;
  // tool step
  tool?: ToolType;
  command?: string;
  url?: string;
  workdir?: string;
  // workflow step
  workflow?: string;
  input_mapping?: Record<string, string>;
  // human_approval step
  message?: string;
  timeout?: string;
  on_timeout?: 'fail' | 'auto_approve' | 'auto_reject';
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version?: string;
  triggers: WorkflowTrigger[];
  variables?: Record<string, string>;
  steps: WorkflowStep[];
}

export interface WorkflowRecord {
  id: string;           // "{projectId}:{name}"
  projectId: string;
  name: string;
  version?: string;
  definition: WorkflowDefinition;
  filePath: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  temporalRunId?: string;
  status: RunStatus;
  triggerType: TriggerType;
  triggerPayload?: unknown;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowStepRun {
  id: string;
  runId: string;
  stepId: string;
  status: StepStatus;
  chatId?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
}
```

**Step 4: Export from index**

```typescript
export * from './workflow.js';
```

**Step 5: Run and verify**

```bash
pnpm --filter @mainframe/types test && pnpm --filter @mainframe/types build
```

**Step 6: Commit**

```bash
git add packages/types/src/workflow.ts packages/types/src/index.ts packages/types/src/__tests__/workflow.test.ts
git commit -m "feat(types): add workflow domain types"
```

---

## Phase 3: Workflows Plugin — Foundation

### Task 6: Scaffold `packages/plugin-workflows`

**Files:**
- Create: `packages/plugin-workflows/package.json`
- Create: `packages/plugin-workflows/tsconfig.json`
- Create: `packages/plugin-workflows/src/index.ts` (placeholder)
- Modify: `pnpm-workspace.yaml` (already includes `packages/*` — no change needed)

**Step 1: Create `packages/plugin-workflows/package.json`**

```json
{
  "name": "@mainframe/plugin-workflows",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/activate.js",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mainframe/types": "workspace:*",
    "@temporalio/client": "^1.12.0",
    "@temporalio/worker": "^1.12.0",
    "@temporalio/workflow": "^1.12.0",
    "@temporalio/activity": "^1.12.0",
    "ajv": "^8.17.1",
    "js-yaml": "^4.1.0",
    "mustache": "^4.2.0",
    "nanoid": "^5.0.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@temporalio/testing": "^1.12.0",
    "@types/js-yaml": "^4.0.9",
    "@types/mustache": "^4.2.5",
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create `packages/plugin-workflows/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

Create `packages/plugin-workflows/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist"
  }
}
```

**Step 3: Create placeholder entry point**

`packages/plugin-workflows/src/activate.ts`:
```typescript
import type { PluginContext } from '@mainframe/types';

export async function activate(_ctx: PluginContext): Promise<void> {
  // implemented in later tasks
}
```

**Step 4: Install dependencies**

```bash
pnpm install
```

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/plugin-workflows typecheck
```

**Step 6: Commit**

```bash
git add packages/plugin-workflows/
git commit -m "feat(plugin-workflows): scaffold package"
```

---

### Task 7: YAML loader and Zod schema validation

**Files:**
- Create: `packages/plugin-workflows/src/workflow-loader.ts`
- Create: `packages/plugin-workflows/src/__tests__/workflow-loader.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml, loadWorkflowsFromDir } from '../workflow-loader.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const VALID_YAML = `
name: test-workflow
version: "1.0"
triggers:
  - type: manual
steps:
  - id: step-1
    type: prompt
    agent:
      adapterId: claude
    prompt: "Hello"
    outputs:
      schema:
        type: object
        properties:
          result: { type: string }
        required: [result]
`;

describe('parseWorkflowYaml', () => {
  it('parses valid workflow YAML', () => {
    const def = parseWorkflowYaml(VALID_YAML);
    expect(def.name).toBe('test-workflow');
    expect(def.steps).toHaveLength(1);
    expect(def.steps[0]!.id).toBe('step-1');
  });

  it('throws on missing name', () => {
    expect(() => parseWorkflowYaml('steps: []')).toThrow();
  });

  it('throws on unknown step type', () => {
    const bad = VALID_YAML.replace('type: prompt', 'type: unknown');
    expect(() => parseWorkflowYaml(bad)).toThrow();
  });
});

describe('loadWorkflowsFromDir', () => {
  it('loads all yml files from a directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-wf-'));
    await fs.writeFile(path.join(dir, 'test.yml'), VALID_YAML);
    const workflows = await loadWorkflowsFromDir(dir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.definition.name).toBe('test-workflow');
  });

  it('returns empty array for non-existent dir', async () => {
    const workflows = await loadWorkflowsFromDir('/tmp/does-not-exist-xyz');
    expect(workflows).toHaveLength(0);
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/workflow-loader.test.ts
```

**Step 3: Implement `packages/plugin-workflows/src/workflow-loader.ts`**

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { WorkflowDefinition } from '@mainframe/types';

const AgentConfigSchema = z.object({
  adapterId: z.string(),
  agentConfig: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'yolo']).optional(),
});

const StepInputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'file', 'json']),
  required: z.boolean().optional(),
});

const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().optional(),
  type: z.enum(['prompt', 'tool', 'workflow', 'human_approval']),
  depends_on: z.array(z.string()).optional(),
  condition: z.string().optional(),
  on_failure: z.enum(['continue', 'fail', 'retry', 'trigger']).optional(),
  on_failure_trigger: z.string().optional(),
  agent: AgentConfigSchema.optional(),
  prompt: z.string().optional(),
  inputs: z.array(StepInputSchema).optional(),
  outputs: z.object({ schema: z.record(z.unknown()) }).optional(),
  tool: z.enum(['bash', 'curl', 'fetch', 'file_read', 'file_write']).optional(),
  command: z.string().optional(),
  url: z.string().optional(),
  workdir: z.string().optional(),
  workflow: z.string().optional(),
  input_mapping: z.record(z.string()).optional(),
  message: z.string().optional(),
  timeout: z.string().optional(),
  on_timeout: z.enum(['fail', 'auto_approve', 'auto_reject']).optional(),
});

const TriggerSchema = z.object({
  type: z.enum(['manual', 'webhook', 'cron', 'event']),
  path: z.string().optional(),
  method: z.string().optional(),
  schedule: z.string().optional(),
  on: z.string().optional(),
  workflow: z.string().optional(),
});

const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  triggers: z.array(TriggerSchema).default([{ type: 'manual' }]),
  variables: z.record(z.string()).optional(),
  steps: z.array(WorkflowStepSchema),
});

export function parseWorkflowYaml(content: string): WorkflowDefinition {
  const raw = yaml.load(content);
  const result = WorkflowDefinitionSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid workflow YAML: ${result.error.message}`);
  }
  return result.data as WorkflowDefinition;
}

export interface LoadedWorkflow {
  definition: WorkflowDefinition;
  filePath: string;
}

export async function loadWorkflowsFromDir(dir: string): Promise<LoadedWorkflow[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const loaded: LoadedWorkflow[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const filePath = path.join(dir, entry);
    const content = await fs.readFile(filePath, 'utf-8');
    try {
      const definition = parseWorkflowYaml(content);
      loaded.push({ definition, filePath });
    } catch (err) {
      console.warn(`Skipping invalid workflow file ${filePath}: ${(err as Error).message}`);
    }
  }
  return loaded;
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/workflow-loader.test.ts
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/workflow-loader.ts packages/plugin-workflows/src/__tests__/workflow-loader.test.ts
git commit -m "feat(plugin-workflows): add YAML loader and Zod schema validation"
```

---

### Task 8: DB migrations and WorkflowRegistry

**Files:**
- Create: `packages/plugin-workflows/src/db-migrations.ts`
- Create: `packages/plugin-workflows/src/workflow-registry.ts`
- Create: `packages/plugin-workflows/src/__tests__/workflow-registry.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runWorkflowMigrations } from '../db-migrations.js';
import { WorkflowRegistry } from '../workflow-registry.js';
import type { WorkflowDefinition } from '@mainframe/types';

const SAMPLE_DEF: WorkflowDefinition = {
  name: 'test',
  triggers: [{ type: 'manual' }],
  steps: [{ id: 'step-1', type: 'prompt', agent: { adapterId: 'claude' }, prompt: 'Hi' }],
};

describe('WorkflowRegistry', () => {
  let db: Database.Database;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    runWorkflowMigrations(db);
    registry = new WorkflowRegistry(db);
  });

  it('saves and retrieves a workflow', () => {
    registry.upsert({ projectId: 'proj1', definition: SAMPLE_DEF, filePath: '/tmp/test.yml' });
    const workflows = registry.listByProject('proj1');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe('test');
  });

  it('upsert updates existing workflow', () => {
    registry.upsert({ projectId: 'proj1', definition: SAMPLE_DEF, filePath: '/tmp/test.yml' });
    registry.upsert({ projectId: 'proj1', definition: { ...SAMPLE_DEF, version: '2.0' }, filePath: '/tmp/test.yml' });
    const workflows = registry.listByProject('proj1');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.version).toBe('2.0');
  });

  it('createRun and getRunById round-trip', () => {
    registry.upsert({ projectId: 'proj1', definition: SAMPLE_DEF, filePath: '/tmp/test.yml' });
    const runId = registry.createRun({ workflowId: 'proj1:test', triggerType: 'manual', inputs: {} });
    const run = registry.getRunById(runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('pending');
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/workflow-registry.test.ts
```

**Step 3: Implement `db-migrations.ts`**

```typescript
import type Database from 'better-sqlite3';

export function runWorkflowMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT,
      definition JSON NOT NULL,
      file_path TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      temporal_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_type TEXT NOT NULL,
      trigger_payload JSON,
      inputs JSON,
      outputs JSON,
      started_at TEXT,
      completed_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_step_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      chat_id TEXT,
      inputs JSON,
      outputs JSON,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_step_runs_run ON workflow_step_runs(run_id);
  `);
}
```

**Step 4: Implement `workflow-registry.ts`**

```typescript
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { WorkflowDefinition, WorkflowRecord, WorkflowRun, WorkflowStepRun, TriggerType, RunStatus, StepStatus } from '@mainframe/types';

export class WorkflowRegistry {
  constructor(private db: Database.Database) {}

  upsert(args: { projectId: string; definition: WorkflowDefinition; filePath: string }): void {
    const id = `${args.projectId}:${args.definition.name}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflows (id, project_id, name, version, definition, file_path, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        definition = excluded.definition,
        file_path = excluded.file_path,
        updated_at = excluded.updated_at
    `).run(id, args.projectId, args.definition.name, args.definition.version ?? null, JSON.stringify(args.definition), args.filePath, now);
  }

  listByProject(projectId: string): WorkflowRecord[] {
    const rows = this.db.prepare('SELECT * FROM workflows WHERE project_id = ?').all(projectId) as any[];
    return rows.map(this.rowToRecord);
  }

  getById(id: string): WorkflowRecord | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    return row ? this.rowToRecord(row) : undefined;
  }

  private rowToRecord(row: any): WorkflowRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      version: row.version ?? undefined,
      definition: JSON.parse(row.definition),
      filePath: row.file_path,
      updatedAt: row.updated_at,
    };
  }

  createRun(args: { workflowId: string; triggerType: TriggerType; inputs?: Record<string, unknown>; triggerPayload?: unknown }): string {
    const id = nanoid();
    this.db.prepare(`
      INSERT INTO workflow_runs (id, workflow_id, status, trigger_type, trigger_payload, inputs)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `).run(id, args.workflowId, args.triggerType, args.triggerPayload ? JSON.stringify(args.triggerPayload) : null, args.inputs ? JSON.stringify(args.inputs) : null);
    return id;
  }

  updateRunStatus(id: string, status: RunStatus, extra?: { temporalRunId?: string; outputs?: unknown; error?: string }): void {
    const now = new Date().toISOString();
    const completed = ['completed', 'failed', 'cancelled'].includes(status) ? now : null;
    const started = status === 'running' ? now : undefined;
    this.db.prepare(`
      UPDATE workflow_runs SET status = ?, temporal_run_id = COALESCE(?, temporal_run_id),
      outputs = COALESCE(?, outputs), error = COALESCE(?, error),
      ${started !== undefined ? 'started_at = COALESCE(started_at, ?),' : ''}
      completed_at = COALESCE(completed_at, ?)
      WHERE id = ?
    `).run(status, extra?.temporalRunId ?? null, extra?.outputs ? JSON.stringify(extra.outputs) : null, extra?.error ?? null, ...(started !== undefined ? [now] : []), completed, id);
  }

  getRunById(id: string): WorkflowRun | undefined {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      workflowId: row.workflow_id,
      temporalRunId: row.temporal_run_id ?? undefined,
      status: row.status,
      triggerType: row.trigger_type,
      triggerPayload: row.trigger_payload ? JSON.parse(row.trigger_payload) : undefined,
      inputs: row.inputs ? JSON.parse(row.inputs) : undefined,
      outputs: row.outputs ? JSON.parse(row.outputs) : undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
    };
  }

  listRunsByWorkflow(workflowId: string): WorkflowRun[] {
    const rows = this.db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY rowid DESC LIMIT 50').all(workflowId) as any[];
    return rows.map((r) => this.getRunById(r.id)!);
  }

  createStepRun(args: { runId: string; stepId: string; inputs?: Record<string, unknown> }): string {
    const id = nanoid();
    this.db.prepare(`
      INSERT INTO workflow_step_runs (id, run_id, step_id, status, inputs)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, args.runId, args.stepId, args.inputs ? JSON.stringify(args.inputs) : null);
    return id;
  }

  updateStepRunStatus(id: string, status: StepStatus, extra?: { chatId?: string; outputs?: unknown; error?: string; retryCount?: number }): void {
    const now = new Date().toISOString();
    const completed = ['completed', 'failed', 'skipped'].includes(status) ? now : null;
    this.db.prepare(`
      UPDATE workflow_step_runs SET status = ?,
      chat_id = COALESCE(?, chat_id),
      outputs = COALESCE(?, outputs),
      error = COALESCE(?, error),
      retry_count = COALESCE(?, retry_count),
      started_at = CASE WHEN status = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
      completed_at = COALESCE(completed_at, ?)
      WHERE id = ?
    `).run(status, extra?.chatId ?? null, extra?.outputs ? JSON.stringify(extra.outputs) : null, extra?.error ?? null, extra?.retryCount ?? null, now, completed, id);
  }

  listStepRunsByRun(runId: string): WorkflowStepRun[] {
    const rows = this.db.prepare('SELECT * FROM workflow_step_runs WHERE run_id = ?').all(runId) as any[];
    return rows.map((r): WorkflowStepRun => ({
      id: r.id, runId: r.run_id, stepId: r.step_id, status: r.status,
      chatId: r.chat_id ?? undefined,
      inputs: r.inputs ? JSON.parse(r.inputs) : undefined,
      outputs: r.outputs ? JSON.parse(r.outputs) : undefined,
      startedAt: r.started_at ?? undefined, completedAt: r.completed_at ?? undefined,
      error: r.error ?? undefined, retryCount: r.retry_count,
    }));
  }
}
```

**Step 5: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/workflow-registry.test.ts
```

**Step 6: Commit**

```bash
git add packages/plugin-workflows/src/db-migrations.ts packages/plugin-workflows/src/workflow-registry.ts packages/plugin-workflows/src/__tests__/workflow-registry.test.ts
git commit -m "feat(plugin-workflows): add DB migrations and WorkflowRegistry"
```

---

## Phase 4: Temporal Worker + Activities

### Task 9: Temporal dependencies and dev server setup

**Step 1: Install Temporal CLI (for local dev server)**

The Temporal dev server runs as a single process. During development use the Temporal CLI:

```bash
# Install once (macOS)
brew install temporal
# Start dev server (runs in background, stores state in memory)
temporal server start-dev
```

This starts Temporal on `localhost:7233` (default). The Temporal Web UI is at `http://localhost:8233`.

For production: use Docker Compose. Add `docs/temporal/docker-compose.yml`:
```yaml
version: "3.8"
services:
  temporal:
    image: temporalio/auto-setup:1.25
    ports:
      - "7233:7233"
    environment:
      - DB=sqlite
```

**Step 2: Verify installation**

```bash
temporal workflow list
```
Expected: empty list (no error).

**Step 3: Add Temporal connection config to plugin**

Create `packages/plugin-workflows/src/temporal-client.ts`:
```typescript
import { Connection, Client } from '@temporalio/client';

export interface TemporalConfig {
  address?: string;   // default: 'localhost:7233'
  namespace?: string; // default: 'default'
}

export async function createTemporalClient(config: TemporalConfig = {}): Promise<Client> {
  const connection = await Connection.connect({
    address: config.address ?? 'localhost:7233',
  });
  return new Client({
    connection,
    namespace: config.namespace ?? 'default',
  });
}
```

**Step 4: Commit**

```bash
git add packages/plugin-workflows/src/temporal-client.ts docs/temporal/
git commit -m "feat(plugin-workflows): add Temporal client and dev server docs"
```

---

### Task 10: Mustache interpolation helper

**Files:**
- Create: `packages/plugin-workflows/src/interpolate.ts`
- Create: `packages/plugin-workflows/src/__tests__/interpolate.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { interpolate } from '../interpolate.js';

describe('interpolate', () => {
  it('substitutes workflow variables', () => {
    const result = interpolate('Hello {{ NAME }}', { NAME: 'World' }, {});
    expect(result).toBe('Hello World');
  });

  it('substitutes step outputs', () => {
    const result = interpolate(
      'Bug: {{ steps.capture.outputs.title }}',
      {},
      { capture: { outputs: { title: 'Login fails' } } },
    );
    expect(result).toBe('Bug: Login fails');
  });

  it('leaves unknown keys as empty string', () => {
    const result = interpolate('{{ UNKNOWN }}', {}, {});
    expect(result).toBe('');
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/interpolate.test.ts
```

**Step 3: Implement `interpolate.ts`**

```typescript
import Mustache from 'mustache';

export function interpolate(
  template: string,
  variables: Record<string, string | undefined>,
  stepOutputs: Record<string, { outputs?: Record<string, unknown> }>,
): string {
  // Build a flat view for Mustache
  const view: Record<string, unknown> = { ...variables };

  // Expose steps.stepId.outputs.field as nested object
  const steps: Record<string, unknown> = {};
  for (const [stepId, stepData] of Object.entries(stepOutputs)) {
    steps[stepId] = stepData;
  }
  view['steps'] = steps;

  try {
    return Mustache.render(template, view);
  } catch {
    return template;
  }
}

export function evaluateCondition(
  condition: string,
  variables: Record<string, string | undefined>,
  stepOutputs: Record<string, { outputs?: Record<string, unknown> }>,
): boolean {
  // Simple condition evaluation: interpolate then eval in a restricted context
  const interpolated = interpolate(condition, variables, stepOutputs);
  try {
    // Only allow simple boolean expressions, no side effects
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`"use strict"; return (${interpolated})`)());
  } catch {
    return false;
  }
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/interpolate.test.ts
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/interpolate.ts packages/plugin-workflows/src/__tests__/interpolate.test.ts
git commit -m "feat(plugin-workflows): add Mustache interpolation helper"
```

---

### Task 10.5: WorkflowStepHandler interface, StepHandlerRegistry, and step handler implementations

**Files:**
- Create: `packages/plugin-workflows/src/steps/handler.ts`
- Create: `packages/plugin-workflows/src/steps/registry.ts`
- Create: `packages/plugin-workflows/src/steps/prompt-step.ts`
- Create: `packages/plugin-workflows/src/steps/bash-step.ts`
- Create: `packages/plugin-workflows/src/steps/http-step.ts`
- Create: `packages/plugin-workflows/src/steps/slack-step.ts`
- Create: `packages/plugin-workflows/src/steps/file-read-step.ts`
- Create: `packages/plugin-workflows/src/steps/file-write-step.ts`
- Create: `packages/plugin-workflows/src/steps/subworkflow-step.ts`
- Create: `packages/plugin-workflows/src/steps/human-approval-step.ts`
- Create: `packages/plugin-workflows/src/__tests__/steps/registry.test.ts`
- Create: `packages/plugin-workflows/src/__tests__/steps/bash-step.test.ts`
- Create: `packages/plugin-workflows/src/__tests__/steps/http-step.test.ts`
- Create: `packages/plugin-workflows/src/__tests__/steps/slack-step.test.ts`

Step type handlers are an internal registry inside the workflows plugin. They are NOT
mainframe-level plugins and do not go through the mainframe consent/install flow. They
share the workflows plugin's declared capabilities (`http:outbound`, `process:exec`).
The `ToolActivity` (Task 12) delegates to this registry rather than containing inline
bash/HTTP logic.

**Step 1: Write failing tests**

`packages/plugin-workflows/src/__tests__/steps/registry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { StepHandlerRegistry } from '../../steps/registry.js';
import type { WorkflowStepHandler } from '../../steps/handler.js';

const makeHandler = (type: string): WorkflowStepHandler => ({
  type,
  validate: () => ({ valid: true, errors: [] }),
  configSchema: () => ({ type: 'object', properties: {} }),
  execute: async () => ({ type, result: 'ok' }),
});

describe('StepHandlerRegistry', () => {
  it('registers and retrieves handlers by type', () => {
    const registry = new StepHandlerRegistry();
    registry.register(makeHandler('bash'));
    expect(registry.get('bash').type).toBe('bash');
  });

  it('throws ValidationError for unknown type', () => {
    const registry = new StepHandlerRegistry();
    expect(() => registry.get('unknown')).toThrow('Unknown step type');
  });

  it('lists all registered types', () => {
    const registry = new StepHandlerRegistry();
    registry.register(makeHandler('bash'));
    registry.register(makeHandler('http'));
    expect(registry.allTypes()).toEqual(expect.arrayContaining(['bash', 'http']));
  });
});
```

`packages/plugin-workflows/src/__tests__/steps/bash-step.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { BashStepHandler } from '../../steps/bash-step.js';

describe('BashStepHandler', () => {
  const handler = new BashStepHandler();

  it('type is bash', () => expect(handler.type).toBe('bash'));

  it('executes a command and returns stdout', async () => {
    const result = await handler.execute(
      { id: 's1', type: 'tool', tool: 'bash', command: 'echo hello', workdir: '/tmp' } as any,
      { runId: 'r1', stepId: 's1', projectPath: '/tmp', variables: {}, config: {} as any, chatService: {} as any, logger: console as any },
    );
    expect(result['stdout']).toContain('hello');
    expect(result['exit_code']).toBe(0);
  });

  it('validates: requires command field', () => {
    const result = handler.validate({ id: 's1', type: 'tool', tool: 'bash' } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('command');
  });
});
```

`packages/plugin-workflows/src/__tests__/steps/http-step.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { HttpStepHandler } from '../../steps/http-step.js';

describe('HttpStepHandler', () => {
  it('makes a request and returns body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    });
    const handler = new HttpStepHandler(mockFetch as any);
    const result = await handler.execute(
      { id: 's1', type: 'tool', tool: 'http', url: 'https://example.com', method: 'GET' } as any,
      { runId: 'r1', stepId: 's1', projectPath: '/tmp', variables: {}, config: {} as any, chatService: {} as any, logger: console as any },
    );
    expect(result['status']).toBe(200);
    expect(result['body']).toBe('{"ok":true}');
  });
});
```

`packages/plugin-workflows/src/__tests__/steps/slack-step.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { SlackStepHandler } from '../../steps/slack-step.js';

describe('SlackStepHandler', () => {
  it('throws ValidationError when token is not configured', async () => {
    const config = { get: () => undefined } as any;
    const handler = new SlackStepHandler(config, console as any);
    await expect(
      handler.execute(
        { id: 's1', type: 'tool', tool: 'slack', channel: '#general', message: 'hi' } as any,
        { runId: 'r1', stepId: 's1', projectPath: '/tmp', variables: {}, config, chatService: {} as any, logger: console as any },
      )
    ).rejects.toThrow('Slack token not configured');
  });

  it('posts message to Slack API', async () => {
    const config = { get: () => 'xoxb-test-token' } as any;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const handler = new SlackStepHandler(config, console as any, mockFetch as any);
    const result = await handler.execute(
      { id: 's1', type: 'tool', tool: 'slack', channel: '#general', message: 'hi' } as any,
      { runId: 'r1', stepId: 's1', projectPath: '/tmp', variables: {}, config, chatService: {} as any, logger: console as any },
    );
    expect(result['ok']).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

**Step 2: Run to verify failures**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/steps/
```
Expected: FAIL — none of the step files exist yet.

**Step 3: Implement `steps/handler.ts`**

```typescript
import type { PluginConfig } from '@mainframe/types';
import type { ChatServiceAPI } from '@mainframe/types';
import type { Logger } from 'pino';
import type { StepDefinition } from '../workflow-loader.js';

export interface StepExecutionContext {
  runId: string;
  stepId: string;
  projectPath: string;
  variables: Record<string, unknown>;
  config: PluginConfig;
  chatService: ChatServiceAPI;
  logger: Logger;
}

export interface StepValidationResult {
  valid: boolean;
  errors: string[];
}

export type StepOutput = Record<string, unknown>;

export interface WorkflowStepHandler {
  readonly type: string;
  validate(step: StepDefinition): StepValidationResult;
  configSchema(): Record<string, unknown>;
  execute(step: StepDefinition, ctx: StepExecutionContext): Promise<StepOutput>;
}
```

**Step 4: Implement `steps/registry.ts`**

```typescript
import type { WorkflowStepHandler } from './handler.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StepHandlerRegistry {
  private handlers = new Map<string, WorkflowStepHandler>();

  register(handler: WorkflowStepHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): WorkflowStepHandler {
    const h = this.handlers.get(type);
    if (!h) throw new ValidationError(`Unknown step type: '${type}'`);
    return h;
  }

  allTypes(): string[] {
    return [...this.handlers.keys()];
  }

  allSchemas(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
      [...this.handlers.entries()].map(([t, h]) => [t, h.configSchema()]),
    );
  }
}
```

**Step 5: Implement `steps/bash-step.ts`**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkflowStepHandler, StepExecutionContext, StepOutput, StepValidationResult } from './handler.js';
import type { StepDefinition } from '../workflow-loader.js';
import { ValidationError } from './registry.js';

const execFileAsync = promisify(execFile);

export class BashStepHandler implements WorkflowStepHandler {
  readonly type = 'bash';

  validate(step: StepDefinition): StepValidationResult {
    const errors: string[] = [];
    if (!step.command) errors.push('bash step requires a "command" field');
    return { valid: errors.length === 0, errors };
  }

  configSchema() {
    return {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        workdir: { type: 'string', description: 'Working directory' },
      },
    };
  }

  async execute(step: StepDefinition, ctx: StepExecutionContext): Promise<StepOutput> {
    const workdir = step.workdir ?? ctx.projectPath;
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-c', step.command ?? ''], {
        cwd: workdir,
        timeout: 5 * 60 * 1000,
      });
      return { exit_code: 0, stdout, stderr };
    } catch (err: any) {
      return {
        exit_code: err.code ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? String(err),
      };
    }
  }
}
```

**Step 6: Implement `steps/http-step.ts`**

```typescript
import type { WorkflowStepHandler, StepExecutionContext, StepOutput, StepValidationResult } from './handler.js';
import type { StepDefinition } from '../workflow-loader.js';

export class HttpStepHandler implements WorkflowStepHandler {
  readonly type = 'http';
  constructor(private fetch: typeof globalThis.fetch = globalThis.fetch) {}

  validate(step: StepDefinition): StepValidationResult {
    const errors: string[] = [];
    if (!step.url) errors.push('http step requires a "url" field');
    return { valid: errors.length === 0, errors };
  }

  configSchema() {
    return {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
        headers: { type: 'object' },
        body: { type: 'string' },
      },
    };
  }

  async execute(step: StepDefinition, _ctx: StepExecutionContext): Promise<StepOutput> {
    const resp = await this.fetch(step.url!, {
      method: step.method ?? 'GET',
      headers: step.headers as Record<string, string> | undefined,
      body: step.body,
    });
    const body = await resp.text();
    return { status: resp.status, ok: resp.ok, body };
  }
}
```

**Step 7: Implement `steps/slack-step.ts`**

```typescript
import type { WorkflowStepHandler, StepExecutionContext, StepOutput, StepValidationResult } from './handler.js';
import type { StepDefinition } from '../workflow-loader.js';
import type { PluginConfig } from '@mainframe/types';
import type { Logger } from 'pino';
import { ValidationError } from './registry.js';

export class SlackStepHandler implements WorkflowStepHandler {
  readonly type = 'slack';

  constructor(
    private config: PluginConfig,
    private logger: Logger,
    private fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  validate(step: StepDefinition): StepValidationResult {
    const errors: string[] = [];
    if (!step.channel) errors.push('slack step requires a "channel" field');
    if (!step.message) errors.push('slack step requires a "message" field');
    return { valid: errors.length === 0, errors };
  }

  configSchema() {
    return {
      type: 'object',
      required: ['channel', 'message'],
      properties: {
        channel: { type: 'string', description: 'Slack channel (e.g. #general)' },
        message: { type: 'string', description: 'Message text (supports {{ interpolation }})' },
      },
    };
  }

  async execute(step: StepDefinition, ctx: StepExecutionContext): Promise<StepOutput> {
    const token = ctx.config.get('integrations.slack.token') as string | undefined;
    if (!token) {
      throw new ValidationError(
        'Slack token not configured. Add it in Workflows → Settings → Integrations.'
      );
    }

    const resp = await this.fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: step.channel, text: step.message }),
    });
    const json = await resp.json() as { ok: boolean; error?: string };
    if (!json.ok) {
      throw new Error(`Slack API error: ${json.error ?? 'unknown'}`);
    }
    return { ok: true };
  }
}
```

**Step 8: Implement remaining handlers (file-read, file-write, subworkflow, human-approval)**

Each follows the same `WorkflowStepHandler` interface. Implementations are straightforward:

- `FileReadStepHandler` — `readFile(step.path, 'utf-8')`, returns `{ content }`
- `FileWriteStepHandler` — `writeFile(step.path, step.content)`, returns `{ written: true }`
- `SubworkflowStepHandler` — calls `temporalClient.execute(subWorkflowName, inputs)`, returns sub-run outputs
- `HumanApprovalStepHandler` — used only as a registry entry for validation/schema; actual Temporal signal handling lives in `human-input-activity.ts`

**Step 9: Run all step tests**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/steps/
```
Expected: PASS.

**Step 10: Typecheck**

```bash
pnpm --filter @mainframe/plugin-workflows typecheck
```
Expected: PASS.

**Step 11: Commit**

```bash
git add packages/plugin-workflows/src/steps/ packages/plugin-workflows/src/__tests__/steps/
git commit -m "feat(plugin-workflows): add WorkflowStepHandler interface, StepHandlerRegistry, and all step handler implementations"
```

---

### Task 11: PromptActivity

**Files:**
- Create: `packages/plugin-workflows/src/temporal/activities/prompt-activity.ts`
- Create: `packages/plugin-workflows/src/__tests__/activities/prompt-activity.test.ts`

The PromptActivity creates a Chat via the daemon HTTP API and polls for completion. Since activities run inside the Temporal worker (which is a separate process context from the main daemon), it calls the daemon's REST API rather than calling `ChatManager` directly.

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPromptActivityFunctions } from '../../temporal/activities/prompt-activity.js';

const mockFetch = vi.fn();

describe('PromptActivity', () => {
  let activities: ReturnType<typeof createPromptActivityFunctions>;

  beforeEach(() => {
    activities = createPromptActivityFunctions({
      daemonUrl: 'http://localhost:31415',
      fetch: mockFetch as any,
    });
  });

  it('creates a chat and returns when chat completes', async () => {
    // Mock: POST /chats returns chatId
    // Mock: GET /chats/:id polls until status is 'ended'
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'chat-1', status: 'active' }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'chat-1', processState: 'idle', status: 'active' }) }) // GET poll 1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'chat-1', processState: null, status: 'ended' }) }); // GET poll 2

    const result = await activities.runPromptStep({
      runId: 'run-1',
      stepId: 'step-1',
      projectId: 'proj-1',
      prompt: 'Hello',
      agent: { adapterId: 'claude' },
      stepRunId: 'sr-1',
    });

    expect(result.chatId).toBe('chat-1');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/prompt-activity.test.ts
```

**Step 3: Implement `prompt-activity.ts`**

```typescript
import { sleep } from '@temporalio/activity';
import type { AgentConfig } from '@mainframe/types';

export interface PromptStepInput {
  runId: string;
  stepId: string;
  stepRunId: string;
  projectId: string;
  prompt: string;
  agent: AgentConfig;
}

export interface PromptStepOutput {
  chatId: string;
  rawOutput: string;
  parsedOutput?: Record<string, unknown>;
}

export interface PromptActivityDeps {
  daemonUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function createPromptActivityFunctions(deps: PromptActivityDeps) {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.daemonUrl;

  async function runPromptStep(input: PromptStepInput): Promise<PromptStepOutput> {
    // 1. Create a chat
    const createRes = await fetcher(`${baseUrl}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        adapterId: input.agent.adapterId,
        model: input.agent.model,
        permissionMode: input.agent.permissionMode ?? 'acceptEdits',
        initialMessage: input.prompt,
        metadata: { workflowRunId: input.runId, stepId: input.stepId },
      }),
    });
    if (!createRes.ok) throw new Error(`Failed to create chat: ${createRes.status}`);
    const chat = await createRes.json() as { id: string };

    // 2. Poll until chat.processState is null (process exited) or status is 'ended'
    let lastRawOutput = '';
    for (let i = 0; i < 360; i++) {  // max 30 min (5s * 360)
      await sleep(5000);
      const pollRes = await fetcher(`${baseUrl}/chats/${chat.id}`);
      if (!pollRes.ok) throw new Error(`Failed to poll chat: ${pollRes.status}`);
      const polled = await pollRes.json() as { id: string; processState: string | null; status: string };
      if (polled.processState === null || polled.status === 'ended') {
        // 3. Fetch final message to extract output
        const histRes = await fetcher(`${baseUrl}/chats/${chat.id}/history`);
        if (histRes.ok) {
          const hist = await histRes.json() as { messages: Array<{ type: string; content: Array<{ type: string; text?: string }> }> };
          const lastAssistant = [...hist.messages].reverse().find((m) => m.type === 'assistant');
          lastRawOutput = lastAssistant?.content.find((c) => c.type === 'text')?.text ?? '';
        }
        return { chatId: chat.id, rawOutput: lastRawOutput };
      }
    }
    throw new Error(`Chat ${chat.id} did not complete within timeout`);
  }

  return { runPromptStep };
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/prompt-activity.test.ts
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/temporal/activities/prompt-activity.ts packages/plugin-workflows/src/__tests__/activities/prompt-activity.test.ts
git commit -m "feat(plugin-workflows): add PromptActivity"
```

---

### Task 12: ToolActivity — delegates to StepHandlerRegistry

`ToolActivity` is now a thin Temporal activity wrapper that receives the `StepHandlerRegistry`
(constructed in `activate()` and passed into the worker) and calls
`registry.get(step.tool).execute(step, ctx)`. All tool-specific logic lives in the handler
classes from Task 10.5. This task only wires the Temporal activity boundary.

**Files:**
- Create: `packages/plugin-workflows/src/temporal/activities/tool-activity.ts`
- Create: `packages/plugin-workflows/src/__tests__/activities/tool-activity.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createToolActivityFunctions } from '../../temporal/activities/tool-activity.js';
import { StepHandlerRegistry } from '../../steps/registry.js';
import { BashStepHandler } from '../../steps/bash-step.js';

describe('ToolActivity', () => {
  it('delegates to the registered handler for the step tool type', async () => {
    const registry = new StepHandlerRegistry();
    registry.register(new BashStepHandler());

    const { runToolStep } = createToolActivityFunctions({ registry, daemonUrl: 'http://localhost:31415' });
    const result = await runToolStep({
      runId: 'r1', stepId: 's1', stepRunId: 'sr1',
      step: { id: 's1', type: 'tool', tool: 'bash', command: 'echo hello' } as any,
      projectPath: '/tmp',
      variables: {},
    });
    expect(result['exit_code']).toBe(0);
    expect(result['stdout']).toContain('hello');
  });

  it('throws for unknown tool type', async () => {
    const registry = new StepHandlerRegistry();
    const { runToolStep } = createToolActivityFunctions({ registry, daemonUrl: 'http://localhost:31415' });
    await expect(
      runToolStep({ runId: 'r1', stepId: 's1', stepRunId: 'sr1',
        step: { id: 's1', type: 'tool', tool: 'unknown-tool' } as any,
        projectPath: '/tmp', variables: {} })
    ).rejects.toThrow('Unknown step type');
  });
});
```

**Step 2: Run to verify failure**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/tool-activity.test.ts
```
Expected: FAIL.

**Step 3: Implement `tool-activity.ts`**

```typescript
import type { StepHandlerRegistry } from '../../steps/registry.js';
import type { StepDefinition } from '../../workflow-loader.js';
import type { PluginConfig } from '@mainframe/types';

export interface ToolActivityDeps {
  registry: StepHandlerRegistry;
  daemonUrl: string;
  config?: PluginConfig;
}

export interface ToolStepInput {
  runId: string;
  stepId: string;
  stepRunId: string;
  step: StepDefinition;
  projectPath: string;
  variables: Record<string, unknown>;
}

export function createToolActivityFunctions(deps: ToolActivityDeps) {
  return {
    async runToolStep(input: ToolStepInput): Promise<Record<string, unknown>> {
      const handler = deps.registry.get(input.step.tool ?? '');
      return handler.execute(input.step, {
        runId: input.runId,
        stepId: input.stepId,
        projectPath: input.projectPath,
        variables: input.variables,
        config: deps.config ?? ({ get: () => undefined, set: () => {}, getAll: () => ({}) } as any),
        chatService: {} as any, // prompt steps don't go through ToolActivity
        logger: console as any,
      });
    },
  };
}
```

**Step 4: Run tests**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/tool-activity.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/temporal/activities/tool-activity.ts packages/plugin-workflows/src/__tests__/activities/tool-activity.test.ts
git commit -m "feat(plugin-workflows): add ToolActivity delegating to StepHandlerRegistry"
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/tool-activity.test.ts
```

**Step 3: Implement `tool-activity.ts`**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolType } from '@mainframe/types';

const execFileAsync = promisify(execFile);

export interface ToolStepInput {
  runId: string;
  stepId: string;
  stepRunId: string;
  tool: ToolType;
  command?: string;
  url?: string;
  workdir?: string;
  body?: string;
  method?: string;
  headers?: Record<string, string>;
  filePath?: string;
  fileContent?: string;
}

export interface ToolStepOutput {
  exit_code: number;
  stdout: string;
  stderr?: string;
  body?: string;
  status?: number;
  content?: string;
}

export async function runToolStep(input: ToolStepInput): Promise<ToolStepOutput> {
  switch (input.tool) {
    case 'bash': return runBash(input);
    case 'curl':
    case 'fetch': return runFetch(input);
    case 'file_read': return runFileRead(input);
    case 'file_write': return runFileWrite(input);
    default: throw new Error(`Unknown tool: ${String(input.tool)}`);
  }
}

async function runBash(input: ToolStepInput): Promise<ToolStepOutput> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', input.command ?? ''], {
      cwd: input.workdir ?? process.cwd(),
      timeout: 5 * 60 * 1000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exit_code: 0, stdout, stderr };
  } catch (err: any) {
    return {
      exit_code: err.code ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

async function runFetch(input: ToolStepInput): Promise<ToolStepOutput> {
  const res = await globalThis.fetch(input.url ?? '', {
    method: input.method ?? 'GET',
    headers: input.headers,
    body: input.body,
  });
  const body = await res.text();
  return { exit_code: res.ok ? 0 : 1, stdout: body, status: res.status, body };
}

async function runFileRead(input: ToolStepInput): Promise<ToolStepOutput> {
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(input.filePath ?? '', 'utf-8');
  return { exit_code: 0, stdout: content, content };
}

async function runFileWrite(input: ToolStepInput): Promise<ToolStepOutput> {
  const fs = await import('node:fs/promises');
  await fs.writeFile(input.filePath ?? '', input.fileContent ?? '', 'utf-8');
  return { exit_code: 0, stdout: `Written to ${input.filePath}` };
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/activities/tool-activity.test.ts
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/temporal/activities/tool-activity.ts packages/plugin-workflows/src/__tests__/activities/tool-activity.test.ts
git commit -m "feat(plugin-workflows): add ToolActivity (bash, fetch, file)"
```

---

### Task 13: HumanInputActivity + mainframe-workflow-runner

**Files:**
- Create: `packages/plugin-workflows/src/temporal/activities/human-input-activity.ts`
- Create: `packages/plugin-workflows/src/temporal/workflows/runner.ts`
- Create: `packages/plugin-workflows/src/temporal/worker.ts`

**Note on Temporal bundling:** Temporal workflow code must be bundled separately from activity code. The `@temporalio/worker` package provides `bundleWorkflowCode()` for this. The runner workflow file must only import from `@temporalio/workflow` — it cannot import Node.js built-ins or other non-workflow packages.

**Step 1: Implement `human-input-activity.ts`**

```typescript
import { setHandler, defineSignal, condition } from '@temporalio/workflow';

// This signal is sent by the daemon when the user approves/rejects
export const humanInputSignal = defineSignal<[{ approved: boolean; data?: unknown }]>('human-input');

export interface HumanInputResult {
  approved: boolean;
  data?: unknown;
}

// This runs INSIDE the workflow (not an activity), using Temporal's signal mechanism
export async function waitForHumanInput(timeoutMs: number): Promise<HumanInputResult> {
  let result: HumanInputResult | null = null;
  setHandler(humanInputSignal, (input) => { result = input; });
  const completed = await condition(() => result !== null, timeoutMs);
  if (!completed) throw new Error('Human input timed out');
  return result!;
}
```

**Step 2: Implement `runner.ts` (workflow code — no Node.js imports)**

```typescript
import { proxyActivities, sleep, ApplicationFailure } from '@temporalio/workflow';
import type { createPromptActivityFunctions } from '../activities/prompt-activity.js';
import type { runToolStep } from '../activities/tool-activity.js';
import type { WorkflowDefinition } from '@mainframe/types';
import { waitForHumanInput } from '../activities/human-input-activity.js';

const { runPromptStep } = proxyActivities<ReturnType<typeof createPromptActivityFunctions>>({
  startToCloseTimeout: '30m',
  scheduleToCloseTimeout: '2h',
  retry: { maximumAttempts: 3, nonRetryableErrorTypes: ['ValidationError'] },
});

const { runToolStep: runTool } = proxyActivities<{ runToolStep: typeof runToolStep }>({
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 3 },
});

export interface RunnerInput {
  runId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, unknown>;
  projectId: string;
  daemonUrl: string;
}

// Topological sort of steps respecting depends_on
function topoSort(steps: WorkflowDefinition['steps']): string[][] {
  const idToStep = new Map(steps.map((s) => [s.id, s]));
  const resolved = new Set<string>();
  const batches: string[][] = [];
  let remaining = steps.map((s) => s.id);

  while (remaining.length > 0) {
    const ready = remaining.filter((id) => {
      const step = idToStep.get(id)!;
      return (step.depends_on ?? []).every((dep) => resolved.has(dep));
    });
    if (ready.length === 0) throw ApplicationFailure.create({ message: 'Circular dependency in workflow steps' });
    batches.push(ready);
    for (const id of ready) resolved.add(id);
    remaining = remaining.filter((id) => !ready.includes(id));
  }
  return batches;
}

export async function mainframeWorkflowRunner(input: RunnerInput): Promise<void> {
  const { definition, inputs, runId, projectId } = input;
  const stepOutputs: Record<string, { outputs?: Record<string, unknown> }> = {};
  const variables = { ...definition.variables, ...(inputs as Record<string, string>) };
  const batches = topoSort(definition.steps);

  for (const batch of batches) {
    // Run all steps in this batch in parallel
    await Promise.all(batch.map(async (stepId) => {
      const step = definition.steps.find((s) => s.id === stepId)!;
      const stepRunId = `${runId}:${stepId}`;

      switch (step.type) {
        case 'prompt': {
          const result = await runPromptStep({
            runId, stepId, stepRunId, projectId,
            prompt: step.prompt ?? '',
            agent: step.agent ?? { adapterId: 'claude' },
          });
          stepOutputs[stepId] = { outputs: { chatId: result.chatId, raw: result.rawOutput } };
          break;
        }
        case 'tool': {
          const result = await runTool({
            runId, stepId, stepRunId,
            tool: step.tool ?? 'bash',
            command: step.command,
            url: step.url,
            workdir: step.workdir,
          });
          stepOutputs[stepId] = { outputs: result as Record<string, unknown> };
          break;
        }
        case 'human_approval': {
          const timeoutMs = parseTimeout(step.timeout ?? '24h');
          const result = await waitForHumanInput(timeoutMs);
          if (!result.approved) throw ApplicationFailure.create({ message: `Human rejected step ${stepId}` });
          stepOutputs[stepId] = { outputs: { approved: true, data: result.data } };
          break;
        }
        case 'workflow': {
          // Sub-workflow: the parent workflow starts a child workflow run
          // (simplified: just record as skipped for now — full impl in Phase 5)
          stepOutputs[stepId] = { outputs: {} };
          break;
        }
      }
    }));
  }
}

function parseTimeout(timeout: string): number {
  const match = /^(\d+)(h|m|s)$/.exec(timeout);
  if (!match) return 24 * 60 * 60 * 1000;
  const [, n, unit] = match;
  const num = parseInt(n!, 10);
  if (unit === 'h') return num * 60 * 60 * 1000;
  if (unit === 'm') return num * 60 * 1000;
  return num * 1000;
}
```

**Step 3: Implement `worker.ts`**

```typescript
import { Worker, bundleWorkflowCode } from '@temporalio/worker';
import { createPromptActivityFunctions } from './activities/prompt-activity.js';
import { runToolStep } from './activities/tool-activity.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WorkerConfig {
  temporalAddress?: string;
  daemonUrl?: string;
}

export async function startTemporalWorker(config: WorkerConfig = {}): Promise<{ shutdown(): Promise<void> }> {
  const daemonUrl = config.daemonUrl ?? 'http://localhost:31415';

  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.resolve(__dirname, './workflows/runner.js'),
  });

  const worker = await Worker.create({
    workflowBundle,
    activities: {
      ...createPromptActivityFunctions({ daemonUrl }),
      runToolStep,
    },
    taskQueue: 'mainframe-workflows',
    connection: undefined, // uses TEMPORAL_ADDRESS env or localhost:7233
  });

  worker.run(); // starts processing (non-blocking in practice, returns a promise that resolves on shutdown)

  return {
    shutdown: async () => {
      worker.shutdown();
    },
  };
}
```

**Step 4: Typecheck**

```bash
pnpm --filter @mainframe/plugin-workflows typecheck
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/temporal/
git commit -m "feat(plugin-workflows): add Temporal worker, runner workflow, and HumanInputActivity"
```

---

## Phase 5: WorkflowManager + REST Routes + Triggers

### Task 14: WorkflowManager and manual trigger route

**Files:**
- Create: `packages/plugin-workflows/src/workflow-manager.ts`
- Create: `packages/plugin-workflows/src/routes/workflows.ts`
- Create: `packages/plugin-workflows/src/routes/runs.ts`

**Step 1: Implement `workflow-manager.ts`**

```typescript
import type { Client } from '@temporalio/client';
import type { WorkflowRegistry } from './workflow-registry.js';
import type { WorkflowRun, TriggerType } from '@mainframe/types';
import { nanoid } from 'nanoid';

export class WorkflowManager {
  constructor(
    private registry: WorkflowRegistry,
    private temporalClient: Client,
  ) {}

  async triggerRun(args: {
    workflowId: string;
    triggerType: TriggerType;
    inputs?: Record<string, unknown>;
    triggerPayload?: unknown;
    projectId: string;
    daemonUrl: string;
  }): Promise<WorkflowRun> {
    const workflow = this.registry.getById(args.workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${args.workflowId}`);

    const runId = nanoid();
    this.registry.createRun({
      workflowId: args.workflowId,
      triggerType: args.triggerType,
      inputs: args.inputs,
      triggerPayload: args.triggerPayload,
    });

    const handle = await this.temporalClient.workflow.start('mainframeWorkflowRunner', {
      taskQueue: 'mainframe-workflows',
      workflowId: runId,
      args: [{
        runId,
        workflowId: args.workflowId,
        definition: workflow.definition,
        inputs: args.inputs ?? {},
        projectId: args.projectId,
        daemonUrl: args.daemonUrl,
      }],
    });

    this.registry.updateRunStatus(runId, 'running', { temporalRunId: handle.workflowId });

    return this.registry.getRunById(runId)!;
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.registry.getRunById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.temporalRunId) {
      const handle = this.temporalClient.workflow.getHandle(run.temporalRunId);
      await handle.cancel();
    }
    this.registry.updateRunStatus(runId, 'cancelled');
  }

  async signalRun(runId: string, approved: boolean, data?: unknown): Promise<void> {
    const run = this.registry.getRunById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (!run.temporalRunId) throw new Error('Run has no Temporal ID');
    const handle = this.temporalClient.workflow.getHandle(run.temporalRunId);
    await handle.signal('human-input', { approved, data });
    this.registry.updateRunStatus(runId, 'running');
  }
}
```

**Step 2: Implement `routes/workflows.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowRegistry } from '../workflow-registry.js';
import type { WorkflowManager } from '../workflow-manager.js';

const TriggerSchema = z.object({
  inputs: z.record(z.unknown()).optional(),
  projectId: z.string(),
});

export function createWorkflowRoutes(registry: WorkflowRegistry, manager: WorkflowManager, daemonUrl: string): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { projectId } = req.query;
    if (typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId required' });
      return;
    }
    res.json(registry.listByProject(projectId));
  });

  router.get('/:id', (req, res) => {
    const workflow = registry.getById(req.params.id!);
    if (!workflow) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(workflow);
  });

  router.post('/:id/runs', async (req, res, next) => {
    try {
      const body = TriggerSchema.parse(req.body);
      const run = await manager.triggerRun({
        workflowId: req.params.id!,
        triggerType: 'manual',
        inputs: body.inputs,
        projectId: body.projectId,
        daemonUrl,
      });
      res.status(201).json(run);
    } catch (err) { next(err); }
  });

  return router;
}
```

**Step 3: Implement `routes/runs.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowRegistry } from '../workflow-registry.js';
import type { WorkflowManager } from '../workflow-manager.js';

const SignalSchema = z.object({ approved: z.boolean(), data: z.unknown().optional() });

export function createRunRoutes(registry: WorkflowRegistry, manager: WorkflowManager): Router {
  const router = Router();

  router.get('/runs/:id', (req, res) => {
    const run = registry.getRunById(req.params.id!);
    if (!run) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(run);
  });

  router.get('/runs/:id/steps', (req, res) => {
    res.json(registry.listStepRunsByRun(req.params.id!));
  });

  router.post('/runs/:id/cancel', async (req, res, next) => {
    try {
      await manager.cancelRun(req.params.id!);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/runs/:id/signal', async (req, res, next) => {
    try {
      const body = SignalSchema.parse(req.body);
      await manager.signalRun(req.params.id!, body.approved, body.data);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
```

**Step 4: Write route test**

`packages/plugin-workflows/src/__tests__/routes/workflows.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowRoutes } from '../../routes/workflows.js';

describe('GET /workflows', () => {
  it('returns 400 when projectId is missing', async () => {
    const mockRegistry = { listByProject: vi.fn(() => []) } as any;
    const mockManager = {} as any;
    const app = express();
    app.use(express.json());
    app.use('/', createWorkflowRoutes(mockRegistry, mockManager, 'http://localhost:31415'));
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
  });

  it('lists workflows by projectId', async () => {
    const mockRegistry = { listByProject: vi.fn(() => [{ id: 'proj:wf', name: 'wf' }]) } as any;
    const mockManager = {} as any;
    const app = express();
    app.use(express.json());
    app.use('/', createWorkflowRoutes(mockRegistry, mockManager, 'http://localhost:31415'));
    const res = await request(app).get('/').query({ projectId: 'proj' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
```

**Step 5: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/routes/workflows.test.ts
```

**Step 6: Commit**

```bash
git add packages/plugin-workflows/src/workflow-manager.ts packages/plugin-workflows/src/routes/
git commit -m "feat(plugin-workflows): add WorkflowManager and REST routes"
```

---

### Task 15: Webhook + Cron + Event triggers

**Files:**
- Create: `packages/plugin-workflows/src/routes/webhooks.ts`
- Create: `packages/plugin-workflows/src/triggers.ts`

**Step 1: Implement `routes/webhooks.ts`**

```typescript
import { Router } from 'express';
import type { WorkflowRegistry } from '../workflow-registry.js';
import type { WorkflowManager } from '../workflow-manager.js';

export function createWebhookRoutes(registry: WorkflowRegistry, manager: WorkflowManager, daemonUrl: string): Router {
  const router = Router();

  router.post('/webhooks/:workflowName', async (req, res, next) => {
    try {
      // Find workflow with a webhook trigger matching this path
      const { workflowName } = req.params;
      // workflowId format is "{projectId}:{name}" — we search by name suffix
      // The request must include projectId in body or query
      const projectId = (req.body?.projectId ?? req.query['projectId']) as string | undefined;
      if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

      const workflowId = `${projectId}:${workflowName}`;
      const run = await manager.triggerRun({
        workflowId,
        triggerType: 'webhook',
        inputs: req.body,
        triggerPayload: req.body,
        projectId,
        daemonUrl,
      });
      res.status(201).json({ runId: run.id });
    } catch (err) { next(err); }
  });

  return router;
}
```

**Step 2: Implement `triggers.ts` (cron + event triggers)**

```typescript
import type { Client, ScheduleHandle } from '@temporalio/client';
import type { WorkflowRegistry } from './workflow-registry.js';
import type { WorkflowManager } from './workflow-manager.js';
import type { PluginEventBus } from '@mainframe/types';

export class TriggerManager {
  private scheduleHandles = new Map<string, ScheduleHandle>();

  constructor(
    private registry: WorkflowRegistry,
    private manager: WorkflowManager,
    private temporalClient: Client,
    private events: PluginEventBus,
    private daemonUrl: string,
  ) {}

  async setupTriggersForWorkflow(workflowId: string, projectId: string): Promise<void> {
    const workflow = this.registry.getById(workflowId);
    if (!workflow) return;

    for (const trigger of workflow.definition.triggers) {
      if (trigger.type === 'cron' && trigger.schedule) {
        await this.setupCronTrigger(workflowId, projectId, trigger.schedule);
      } else if (trigger.type === 'event' && trigger.on) {
        this.setupEventTrigger(workflowId, projectId, trigger.on);
      }
    }
  }

  private async setupCronTrigger(workflowId: string, projectId: string, schedule: string): Promise<void> {
    const scheduleId = `cron:${workflowId}`;
    try {
      const handle = await this.temporalClient.schedule.create({
        scheduleId,
        spec: { cronExpressions: [schedule] },
        action: {
          type: 'startWorkflow',
          workflowType: 'mainframeWorkflowRunner',
          taskQueue: 'mainframe-workflows',
          args: [{ workflowId, triggerType: 'cron', inputs: {}, projectId, daemonUrl: this.daemonUrl }],
        },
      });
      this.scheduleHandles.set(scheduleId, handle);
    } catch (err: any) {
      if (err.code === 6 /* ALREADY_EXISTS */) {
        // Schedule already registered — update it
        const handle = this.temporalClient.schedule.getHandle(scheduleId);
        this.scheduleHandles.set(scheduleId, handle);
      } else {
        throw err;
      }
    }
  }

  private setupEventTrigger(workflowId: string, projectId: string, eventName: string): void {
    this.events.on(eventName, async () => {
      await this.manager.triggerRun({
        workflowId,
        triggerType: 'event',
        inputs: {},
        projectId,
        daemonUrl: this.daemonUrl,
      });
    });
  }

  async teardown(): Promise<void> {
    for (const [, handle] of this.scheduleHandles) {
      await handle.delete().catch(() => {/* ignore */});
    }
    this.scheduleHandles.clear();
  }
}
```

**Step 3: Commit**

```bash
git add packages/plugin-workflows/src/routes/webhooks.ts packages/plugin-workflows/src/triggers.ts
git commit -m "feat(plugin-workflows): add webhook, cron, and event triggers"
```

---

## Phase 6: License Validation

### Task 16: License key validation

**Files:**
- Create: `packages/plugin-workflows/src/license.ts`
- Create: `packages/plugin-workflows/src/__tests__/license.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { validateLicense } from '../license.js';

describe('validateLicense', () => {
  it('returns true for valid key from server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true }),
    });
    const result = await validateLicense({
      key: 'valid-key-123',
      serverUrl: 'https://license.mainframe.app',
      fetch: mockFetch as any,
    });
    expect(result).toBe(true);
  });

  it('returns false for invalid key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false }),
    });
    const result = await validateLicense({
      key: 'bad-key',
      serverUrl: 'https://license.mainframe.app',
      fetch: mockFetch as any,
    });
    expect(result).toBe(false);
  });

  it('returns false when server is unreachable and no cache', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await validateLicense({
      key: 'any-key',
      serverUrl: 'https://license.mainframe.app',
      fetch: mockFetch as any,
      cache: null,
    });
    expect(result).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/license.test.ts
```

**Step 3: Implement `license.ts`**

```typescript
import os from 'node:os';
import crypto from 'node:crypto';

function getMachineId(): string {
  // Stable fingerprint from hostname + platform + username
  const raw = `${os.hostname()}:${os.platform()}:${os.userInfo().username}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export interface LicenseCache {
  get(): { valid: boolean; expiresAt: number } | null;
  set(valid: boolean, expiresAt: number): void;
}

export interface ValidateLicenseOptions {
  key: string;
  serverUrl: string;
  fetch?: typeof globalThis.fetch;
  cache?: LicenseCache | null;
}

export async function validateLicense(opts: ValidateLicenseOptions): Promise<boolean> {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // Check cache first
  if (opts.cache !== null && opts.cache !== undefined) {
    const cached = opts.cache.get();
    if (cached && cached.expiresAt > Date.now()) {
      return cached.valid;
    }
  }

  try {
    const res = await fetcher(`${opts.serverUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: opts.key, machineId: getMachineId() }),
    });
    const body = await res.json() as { valid: boolean };
    const valid = res.ok && body.valid === true;

    // Cache for 7 days
    if (opts.cache !== null && opts.cache !== undefined) {
      opts.cache.set(valid, Date.now() + sevenDaysMs);
    }

    return valid;
  } catch {
    // Network error: use cache if available (even if expired, grace period)
    if (opts.cache !== null && opts.cache !== undefined) {
      const stale = opts.cache.get();
      if (stale?.valid) return true;
    }
    return false;
  }
}
```

**Step 4: Run to verify it passes**

```bash
pnpm --filter @mainframe/plugin-workflows test src/__tests__/license.test.ts
```

**Step 5: Commit**

```bash
git add packages/plugin-workflows/src/license.ts packages/plugin-workflows/src/__tests__/license.test.ts
git commit -m "feat(plugin-workflows): add license key validation with 7-day offline cache"
```

---

## Phase 7: activate() — Wire Everything Together

### Task 17: Complete activate.ts

**Files:**
- Modify: `packages/plugin-workflows/src/activate.ts`

**Step 1: Implement the full activate function**

```typescript
import type { PluginContext } from '@mainframe/types';
import { runWorkflowMigrations } from './db-migrations.js';
import { WorkflowRegistry } from './workflow-registry.js';
import { WorkflowManager } from './workflow-manager.js';
import { TriggerManager } from './triggers.js';
import { createWorkflowRoutes } from './routes/workflows.js';
import { createRunRoutes } from './routes/runs.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createTemporalClient } from './temporal-client.js';
import { startTemporalWorker } from './temporal/worker.js';
import { validateLicense } from './license.js';

const LICENSE_SERVER = 'https://license.mainframe.app';
const DAEMON_URL = process.env['MAINFRAME_DAEMON_URL'] ?? 'http://localhost:31415';
const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';

export async function activate(ctx: PluginContext): Promise<void> {
  // 1. License check
  const licenseKey = ctx.config.get('licenseKey');
  if (!licenseKey) {
    ctx.logger.error('Workflows plugin: no license key set. Set it via the Workflows panel settings.');
    return;
  }
  const valid = await validateLicense({ key: licenseKey, serverUrl: LICENSE_SERVER });
  if (!valid) {
    ctx.logger.error('Workflows plugin: invalid license key. Purchase at mainframe.app');
    return;
  }

  // 2. DB migrations
  ctx.db.runMigration(/* SQL from db-migrations.ts — inline or import */
    `CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, version TEXT, definition JSON, file_path TEXT, updated_at TEXT)`
  );

  // 3. Build the step handler registry — all integrations registered here.
  //    Adding a new integration = write a handler class + one line below.
  const stepRegistry = new StepHandlerRegistry();
  stepRegistry.register(new PromptStepHandler(ctx.services.chats, ctx.logger));
  stepRegistry.register(new BashStepHandler());
  stepRegistry.register(new HttpStepHandler());
  stepRegistry.register(new SlackStepHandler(ctx.config, ctx.logger));
  stepRegistry.register(new FileReadStepHandler());
  stepRegistry.register(new FileWriteStepHandler());
  stepRegistry.register(new SubworkflowStepHandler());
  stepRegistry.register(new HumanApprovalStepHandler());

  // 4. Initialize workflow registry, Temporal client, managers
  const workflowRegistry = new WorkflowRegistry(ctx.db as any);
  const temporalClient = await createTemporalClient({ address: TEMPORAL_ADDRESS });
  const manager = new WorkflowManager(workflowRegistry, temporalClient);
  const triggerManager = new TriggerManager(workflowRegistry, manager, temporalClient, ctx.events, DAEMON_URL);

  // 5. Start Temporal worker — receives the step registry, passes it to ToolActivity
  const worker = await startTemporalWorker({
    temporalAddress: TEMPORAL_ADDRESS,
    daemonUrl: DAEMON_URL,
    stepRegistry,
    config: ctx.config,
  });

  // 6. Register routes
  // (mount sub-routers on ctx.router — see Task 14 route mounting note)

  // 7. Integration config route (GET/PUT /integrations/:id)
  ctx.router.get('/integrations/:id', (req, res) => {
    const id = req.params.id;
    const configured = Boolean(ctx.config.get(`integrations.${id}.token`) ?? ctx.config.get(`integrations.${id}.key`));
    res.json({ id, configured });
  });
  ctx.router.put('/integrations/:id', (req, res) => {
    const id = req.params.id;
    // Accept token, key, or webhook_url depending on integration type
    for (const [k, v] of Object.entries(req.body as Record<string, string>)) {
      ctx.config.set(`integrations.${id}.${k}`, v);
    }
    res.json({ ok: true });
  });

  // 8. Add UI panel
  ctx.ui.addPanel({ id: 'workflows', label: 'Workflows', icon: 'GitBranch', position: 'sidebar-primary', entryPoint: './ui.mjs' });

  // 9. Register cleanup
  ctx.onUnload(async () => {
    await worker.shutdown();
    await triggerManager.teardown();
    temporalClient.connection.close();
  });

  ctx.logger.info('Workflows plugin activated');
}
```

**Note:** The route mounting needs a small refactor of `plugin-router.ts` to accept a sub-router (express `Router`) directly, not just individual method registrations. Update `PluginRouter` to add:
```typescript
use(path: string, router: Router): void;
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/plugin-workflows typecheck
```

**Step 3: Commit**

```bash
git add packages/plugin-workflows/src/activate.ts
git commit -m "feat(plugin-workflows): complete activate() wiring"
```

---

## Phase 8: UI — iframe-Based Plugin Panels

> **Architecture note:** All plugin UI lives in self-contained iframe apps served by the daemon.
> The desktop never imports plugin React components directly. Communication between iframe and
> host happens exclusively via `postMessage`. This keeps plugins fully isolated and extensible
> by third-party developers without modifying desktop source code.

### Task 18: Plugin UI contribution types + daemon static file serving

**Files:**
- Modify: `packages/types/src/plugin.ts` (add zone types + postMessage message types)
- Modify: `packages/core/src/plugins/plugin-ui-context.ts` (add zone to addPanel)
- Modify: `packages/core/src/server/http.ts` (serve plugin UI static files + ui-contributions endpoint)

**Step 1: Update `PluginUIContribution` in `packages/types/src/plugin.ts`**

Add zone support and the full postMessage bridge contract:

```typescript
export type UIZone = 'left' | 'center' | 'right';

export interface PluginUIContribution {
  pluginId: string;
  id: string;
  label?: string;      // shown in tab strip for left/right zones
  icon?: string;
  zone: UIZone;
}

// Messages the iframe sends TO the host via window.parent.postMessage
export type PluginToHostMessage =
  | { type: 'mainframe:navigate'; zone: 'center' | 'right'; viewId: string; params?: Record<string, unknown> }
  | { type: 'mainframe:notify'; title: string; body: string; notificationId: string }
  | { type: 'mainframe:ready' };  // iframe signals it's loaded and ready for context

// Messages the host sends TO an iframe via iframe.contentWindow.postMessage
export type HostToPluginMessage =
  | { type: 'mainframe:context'; projectId: string | null; theme: 'dark' | 'light'; params?: Record<string, unknown> }
  | { type: 'mainframe:navigate'; viewId: string; params?: Record<string, unknown> };
```

**Step 2: Update `addPanel` signature in `plugin-ui-context.ts`**

```typescript
export function buildPluginUIContext(
  pluginId: string,
  contributions: PluginUIContribution[],
  notify: (n: { id: string; title: string; body: string; pluginId: string }) => void,
): PluginUIContext {
  return {
    addPanel({ id, label, icon, zone = 'left' }) {
      contributions.push({ pluginId, id, label, icon, zone });
    },
    sendNotification(notification) {
      notify({ ...notification, pluginId });
    },
  };
}
```

Also update `PluginUIContext` interface in `packages/types/src/plugin.ts`:
```typescript
export interface PluginUIContext {
  addPanel(opts: { id: string; label?: string; icon?: string; zone?: UIZone }): void;
  sendNotification(notification: { id: string; title: string; body: string; pluginId: string }): void;
}
```

**Step 3: Add daemon endpoints in `packages/core/src/server/http.ts`**

Add two new route groups after the existing plugin router mounts:

```typescript
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import mime from 'mime-types';  // add: pnpm --filter @mainframe/core add mime-types

// GET /api/plugins/ui-contributions — returns all registered panel contributions
app.get('/api/plugins/ui-contributions', (_req, res) => {
  res.json(uiContributions);  // the same array built up during plugin loading
});

// GET /api/plugins/:pluginId/ui/:filePath(*) — serves static UI assets from plugin dir
app.get('/api/plugins/:pluginId/ui/:filePath(*)', async (req, res) => {
  const { pluginId, filePath } = req.params;
  // Validate pluginId
  if (!/^[a-zA-Z0-9_-]+$/.test(pluginId ?? '')) {
    res.status(400).end(); return;
  }
  const pluginsDir = path.join(os.homedir(), '.mainframe', 'plugins');
  const resolved = path.resolve(pluginsDir, pluginId!, 'ui', filePath ?? 'index.html');
  // Security: resolved path must stay within the plugin's ui/ dir
  const allowedPrefix = path.resolve(pluginsDir, pluginId!, 'ui');
  if (!resolved.startsWith(allowedPrefix + path.sep) && resolved !== allowedPrefix) {
    res.status(403).end(); return;
  }
  try {
    await fs.access(resolved);
  } catch {
    res.status(404).end(); return;
  }
  const contentType = mime.lookup(resolved) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  createReadStream(resolved).pipe(res);
});
```

**Step 4: Write a test for the static serving route**

`packages/core/src/__tests__/routes/plugin-ui.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('plugin UI static serving', () => {
  it('returns 400 for invalid plugin id', async () => {
    const app = express();
    // minimal setup — mount just the plugin UI route
    app.get('/api/plugins/:pluginId/ui/:filePath(*)', async (req, res) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(req.params.pluginId ?? '')) {
        res.status(400).end(); return;
      }
      res.status(200).end();
    });
    const res = await request(app).get('/api/plugins/../secret/ui/index.html');
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing file', async () => {
    const app = express();
    app.get('/api/plugins/:pluginId/ui/:filePath(*)', async (_req, res) => {
      res.status(404).end();
    });
    const res = await request(app).get('/api/plugins/workflows/ui/nonexistent.js');
    expect(res.status).toBe(404);
  });
});
```

**Step 5: Run the test**

```bash
pnpm --filter @mainframe/core test src/__tests__/routes/plugin-ui.test.ts
```

**Step 6: Typecheck**

```bash
pnpm --filter @mainframe/types build
pnpm --filter @mainframe/core build
```

**Step 7: Commit**

```bash
git add packages/types/src/plugin.ts packages/core/src/plugins/plugin-ui-context.ts packages/core/src/server/http.ts packages/core/src/__tests__/routes/plugin-ui.test.ts
git commit -m "feat(core): add plugin UI zone types, ui-contributions endpoint, and static file serving"
```

---

### Task 19: Dynamic LeftPanel + PluginPanel iframe renderer

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`
- Create: `packages/desktop/src/renderer/components/panels/PluginPanel.tsx`
- Create: `packages/desktop/src/renderer/hooks/usePluginContributions.ts`
- Create: `packages/desktop/src/renderer/lib/plugin-bridge.ts`

**Step 1: Write failing test for `usePluginContributions`**

`packages/desktop/src/__tests__/usePluginContributions.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePluginContributions } from '../renderer/hooks/usePluginContributions.js';

describe('usePluginContributions', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches contributions from daemon', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ pluginId: 'workflows', id: 'workflows-left', label: 'Workflows', zone: 'left' }],
    } as any);

    const { result } = renderHook(() => usePluginContributions());
    await waitFor(() => expect(result.current.contributions).toHaveLength(1));
    expect(result.current.contributions[0]!.pluginId).toBe('workflows');
  });

  it('returns empty array when daemon unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => usePluginContributions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contributions).toHaveLength(0);
  });
});
```

**Step 2: Run to verify it fails**

```bash
pnpm --filter @mainframe/desktop test src/__tests__/usePluginContributions.test.ts
```

**Step 3: Implement `usePluginContributions.ts`**

```typescript
import { useState, useEffect } from 'react';
import type { PluginUIContribution } from '@mainframe/types';

const DAEMON_URL = 'http://localhost:31415';

export function usePluginContributions() {
  const [contributions, setContributions] = useState<PluginUIContribution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${DAEMON_URL}/api/plugins/ui-contributions`)
      .then((r) => r.json())
      .then((data) => setContributions(data as PluginUIContribution[]))
      .catch(() => {/* no plugins installed */})
      .finally(() => setLoading(false));
  }, []);

  return { contributions, loading };
}
```

**Step 4: Implement the postMessage bridge in `plugin-bridge.ts`**

This module sends context to iframes and listens for navigation messages from them:

```typescript
import type { HostToPluginMessage, PluginToHostMessage } from '@mainframe/types';

export interface PluginBridgeOptions {
  pluginId: string;
  projectId: string | null;
  theme: 'dark' | 'light';
  params?: Record<string, unknown>;
  onNavigate: (zone: 'center' | 'right', viewId: string, params?: Record<string, unknown>) => void;
  onNotify: (pluginId: string, title: string, body: string, notificationId: string) => void;
}

export function attachPluginBridge(
  iframe: HTMLIFrameElement,
  opts: PluginBridgeOptions,
): () => void {
  const DAEMON_ORIGIN = 'http://localhost:31415';

  const sendContext = () => {
    const msg: HostToPluginMessage = {
      type: 'mainframe:context',
      projectId: opts.projectId,
      theme: opts.theme,
      params: opts.params,
    };
    iframe.contentWindow?.postMessage(msg, DAEMON_ORIGIN);
  };

  const handleMessage = (event: MessageEvent) => {
    // Only accept messages from the daemon origin
    if (event.origin !== DAEMON_ORIGIN) return;
    const msg = event.data as PluginToHostMessage;
    switch (msg.type) {
      case 'mainframe:ready':
        sendContext();
        break;
      case 'mainframe:navigate':
        opts.onNavigate(msg.zone, msg.viewId, msg.params);
        break;
      case 'mainframe:notify':
        opts.onNotify(opts.pluginId, msg.title, msg.body, msg.notificationId);
        break;
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}

export function sendNavigationToPlugin(
  iframe: HTMLIFrameElement,
  viewId: string,
  params?: Record<string, unknown>,
): void {
  const msg: HostToPluginMessage = { type: 'mainframe:navigate', viewId, params };
  iframe.contentWindow?.postMessage(msg, 'http://localhost:31415');
}
```

**Step 5: Implement `PluginPanel.tsx`**

```tsx
import { useRef, useEffect, useState } from 'react';
import type { PluginUIContribution } from '@mainframe/types';
import { attachPluginBridge, sendNavigationToPlugin } from '../../lib/plugin-bridge.js';

const DAEMON_URL = 'http://localhost:31415';

interface PluginPanelProps {
  contribution: PluginUIContribution;
  projectId: string | null;
  theme: 'dark' | 'light';
  // Center panel navigation state passed down from parent
  centerView?: { viewId: string; params?: Record<string, unknown> };
  onNavigate: (zone: 'center' | 'right', viewId: string, params?: Record<string, unknown>) => void;
}

export function PluginPanel({ contribution, projectId, theme, centerView, onNavigate }: PluginPanelProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Attach the postMessage bridge
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    return attachPluginBridge(iframe, {
      pluginId: contribution.pluginId,
      projectId,
      theme,
      onNavigate,
      onNotify: (_pluginId, title, body, notificationId) => {
        // TODO: wire to notification system
        console.warn('Plugin notification', { title, body, notificationId });
      },
    });
  }, [contribution.pluginId, projectId, theme, onNavigate]);

  // When the parent wants the plugin to navigate to a different view, tell the iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !centerView) return;
    sendNavigationToPlugin(iframe, centerView.viewId, centerView.params);
  }, [centerView]);

  const src = `${DAEMON_URL}/api/plugins/${contribution.pluginId}/ui/index.html`;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms"
      title={contribution.label ?? contribution.pluginId}
    />
  );
}
```

**Step 6: Make `LeftPanel.tsx` data-driven**

Replace the existing static tabs in `packages/desktop/src/renderer/components/panels/LeftPanel.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs.js';
import { ChatsPanel } from './ChatsPanel.js';
import { SkillsPanel } from './SkillsPanel.js';
import { AgentsPanel } from './AgentsPanel.js';
import { PluginPanel } from './PluginPanel.js';
import { usePluginContributions } from '../../hooks/usePluginContributions.js';

// Shared state for center panel plugin views — lifted here so left panel
// tabs can trigger center panel navigation
interface CenterPluginView {
  pluginId: string;
  viewId: string;
  params?: Record<string, unknown>;
}

export function LeftPanel(): React.ReactElement {
  const { contributions } = usePluginContributions();
  const leftContributions = contributions.filter((c) => c.zone === 'left');
  const [centerView, setCenterView] = useState<CenterPluginView | null>(null);

  const handleNavigate = useCallback((
    pluginId: string,
    zone: 'center' | 'right',
    viewId: string,
    params?: Record<string, unknown>,
  ) => {
    if (zone === 'center') {
      setCenterView({ pluginId, viewId, params });
    }
    // right panel handled similarly when implemented
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="sessions" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 px-[10px] bg-transparent justify-start gap-1 shrink-0 rounded-none">
          <TabsTrigger value="sessions" className="text-mf-small">Sessions</TabsTrigger>
          <TabsTrigger value="skills"   className="text-mf-small">Skills</TabsTrigger>
          <TabsTrigger value="agents"   className="text-mf-small">Agents</TabsTrigger>
          {leftContributions.map((c) => (
            <TabsTrigger key={c.pluginId} value={`plugin:${c.pluginId}`} className="text-mf-small">
              {c.label ?? c.pluginId}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="sessions" className="flex-1 overflow-hidden mt-0"><ChatsPanel /></TabsContent>
        <TabsContent value="skills"   className="flex-1 overflow-hidden mt-0"><SkillsPanel /></TabsContent>
        <TabsContent value="agents"   className="flex-1 overflow-hidden mt-0"><AgentsPanel /></TabsContent>

        {leftContributions.map((c) => (
          <TabsContent key={c.pluginId} value={`plugin:${c.pluginId}`} className="flex-1 overflow-hidden mt-0">
            <PluginPanel
              contribution={c}
              projectId={null /* TODO: wire from active project store */}
              theme="dark"
              onNavigate={(zone, viewId, params) => handleNavigate(c.pluginId, zone, viewId, params)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

**Note:** `centerView` state will need to be lifted further up (to `App.tsx` or a Zustand store) so the center panel can react to it. For now, wiring the state lift is a follow-on step documented in the E2E task.

**Step 7: Run tests**

```bash
pnpm --filter @mainframe/desktop test src/__tests__/usePluginContributions.test.ts
```

**Step 8: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/LeftPanel.tsx packages/desktop/src/renderer/components/panels/PluginPanel.tsx packages/desktop/src/renderer/hooks/usePluginContributions.ts packages/desktop/src/renderer/lib/plugin-bridge.ts packages/desktop/src/__tests__/usePluginContributions.test.ts
git commit -m "feat(desktop): dynamic plugin panel tabs with iframe rendering and postMessage bridge"
```

---

### Task 20: Workflows plugin UI (self-contained Vite app)

> **Key principle:** This Vite app lives inside `packages/plugin-workflows/ui/` and is entirely
> separate from `@mainframe/desktop`. It bundles its own React and React Flow. The daemon serves
> its built output as static files. No workflow UI code lives in the desktop package.

**Files:**
- Create: `packages/plugin-workflows/ui/package.json`
- Create: `packages/plugin-workflows/ui/vite.config.ts`
- Create: `packages/plugin-workflows/ui/index.html`
- Create: `packages/plugin-workflows/ui/src/main.tsx`
- Create: `packages/plugin-workflows/ui/src/App.tsx` (router: left sidebar view vs center views)
- Create: `packages/plugin-workflows/ui/src/views/WorkflowListView.tsx`
- Create: `packages/plugin-workflows/ui/src/views/WorkflowEditorView.tsx`
- Create: `packages/plugin-workflows/ui/src/views/WorkflowRunView.tsx`
- Create: `packages/plugin-workflows/ui/src/lib/graph-serializer.ts`
- Create: `packages/plugin-workflows/ui/src/lib/bridge.ts` (postMessage helpers)
- Create: `packages/plugin-workflows/ui/src/nodes/PromptNode.tsx`
- Create: `packages/plugin-workflows/ui/src/nodes/ToolNode.tsx`

**Step 1: Scaffold the UI package**

`packages/plugin-workflows/ui/package.json`:
```json
{
  "name": "@mainframe/plugin-workflows-ui",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@xyflow/react": "^12.0.0",
    "@dagrejs/dagre": "^1.1.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/dagre": "^0.7.52",
    "typescript": "^5.3.3",
    "vite": "^7.0.0",
    "vitest": "^4.0.0",
    "@vitest/ui": "^4.0.0"
  }
}
```

`packages/plugin-workflows/ui/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
  // In dev mode, proxy API calls to the daemon
  server: {
    proxy: {
      '/api': 'http://localhost:31415',
    },
  },
});
```

**Step 2: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Workflows</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root { height: 100%; margin: 0; padding: 0; }
    body { background: transparent; color: #e4e4e7; font-family: system-ui, sans-serif; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Step 3: Implement the postMessage bridge helper `src/lib/bridge.ts`**

This is the iframe side of the bridge (mirrors `plugin-bridge.ts` in the desktop):

```typescript
import type { PluginToHostMessage, HostToPluginMessage } from '../types.js';

// Re-declare the types locally since this app doesn't depend on @mainframe/types
export interface Context {
  projectId: string | null;
  theme: 'dark' | 'light';
  params?: Record<string, unknown>;
}

type NavigateListener = (viewId: string, params?: Record<string, unknown>) => void;

let contextListener: ((ctx: Context) => void) | null = null;
let navigateListener: NavigateListener | null = null;

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToPluginMessage;
  if (msg.type === 'mainframe:context') {
    contextListener?.({ projectId: msg.projectId, theme: msg.theme, params: msg.params });
  } else if (msg.type === 'mainframe:navigate') {
    navigateListener?.(msg.viewId, msg.params);
  }
});

export const bridge = {
  onContext(fn: (ctx: Context) => void) { contextListener = fn; },
  onNavigate(fn: NavigateListener) { navigateListener = fn; },

  navigate(zone: 'center' | 'right', viewId: string, params?: Record<string, unknown>) {
    const msg: PluginToHostMessage = { type: 'mainframe:navigate', zone, viewId, params };
    window.parent.postMessage(msg, '*');
  },

  notify(title: string, body: string, notificationId: string) {
    const msg: PluginToHostMessage = { type: 'mainframe:notify', title, body, notificationId };
    window.parent.postMessage(msg, '*');
  },

  ready() {
    const msg: PluginToHostMessage = { type: 'mainframe:ready' };
    window.parent.postMessage(msg, '*');
  },
};
```

**Step 4: Implement `src/App.tsx`** (route by `?view=` query param)

The left panel iframe always loads `index.html` with no params. Center panel views load `index.html?view=editor&workflowId=...` or `index.html?view=run&runId=...`. The app reads the URL to decide which view to render.

```tsx
import { useState, useEffect } from 'react';
import { WorkflowListView } from './views/WorkflowListView.js';
import { WorkflowEditorView } from './views/WorkflowEditorView.js';
import { WorkflowRunView } from './views/WorkflowRunView.js';
import { bridge, type Context } from './lib/bridge.js';

export function App(): React.ReactElement {
  const [ctx, setCtx] = useState<Context>({ projectId: null, theme: 'dark' });
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') ?? 'list');
  const [viewParams, setViewParams] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));

  useEffect(() => {
    bridge.onContext(setCtx);
    bridge.onNavigate((viewId, params) => {
      setView(viewId);
      if (params) setViewParams(params as Record<string, string>);
    });
    bridge.ready();  // tell host we're ready for context
  }, []);

  if (view === 'editor') {
    return <WorkflowEditorView workflowId={viewParams['workflowId'] ?? ''} projectId={ctx.projectId} />;
  }
  if (view === 'run') {
    return <WorkflowRunView runId={viewParams['runId'] ?? ''} />;
  }
  // Default: left panel list view
  return <WorkflowListView projectId={ctx.projectId} />;
}
```

**Step 5: Implement `WorkflowListView.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { bridge } from '../lib/bridge.js';

interface WorkflowRecord { id: string; name: string; }

export function WorkflowListView({ projectId }: { projectId: string | null }): React.ReactElement {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/plugins/workflows/workflows?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => setWorkflows(data as WorkflowRecord[]))
      .catch(() => {});
  }, [projectId]);

  const openEditor = (workflowId: string) => {
    bridge.navigate('center', 'editor', { workflowId });
  };

  const triggerRun = async (workflowId: string) => {
    if (!projectId) return;
    const res = await fetch(`/api/plugins/workflows/workflows/${encodeURIComponent(workflowId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const run = await res.json() as { id: string };
    bridge.navigate('center', 'run', { runId: run.id });
  };

  if (!projectId) {
    return <div style={{ padding: 12, color: '#71717a' }}>Open a project to see workflows</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #27272a', fontWeight: 500 }}>
        Workflows
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {workflows.length === 0 && (
          <div style={{ padding: 12, color: '#71717a', fontSize: 12 }}>
            No workflows found. Create a .mainframe/workflows/*.yml file.
          </div>
        )}
        {workflows.map((wf) => (
          <div key={wf.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #18181b' }}>
            <button onClick={() => openEditor(wf.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: '#e4e4e7', cursor: 'pointer', fontSize: 13 }}>
              {wf.name}
            </button>
            <button onClick={() => triggerRun(wf.id)} style={{ fontSize: 11, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}>
              Run
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 6: Write failing test for graph serializer (lives in plugin UI)**

`packages/plugin-workflows/ui/src/__tests__/graph-serializer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { graphToWorkflow, workflowToGraph } from '../lib/graph-serializer.js';

const SAMPLE = {
  name: 'test',
  triggers: [{ type: 'manual' as const }],
  steps: [
    { id: 'a', type: 'prompt' as const, agent: { adapterId: 'claude' }, prompt: 'Hi' },
    { id: 'b', type: 'tool' as const, tool: 'bash' as const, command: 'echo hi', depends_on: ['a'] },
  ],
};

describe('graph-serializer', () => {
  it('workflowToGraph produces nodes and edges', () => {
    const { nodes, edges } = workflowToGraph(SAMPLE);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('a');
    expect(edges[0]!.target).toBe('b');
  });

  it('graphToWorkflow round-trips', () => {
    const { nodes, edges } = workflowToGraph(SAMPLE);
    const def = graphToWorkflow({ nodes, edges, name: SAMPLE.name, triggers: SAMPLE.triggers });
    expect(def.steps).toHaveLength(2);
    expect(def.steps[1]!.depends_on).toContain('a');
  });
});
```

**Step 7: Implement `src/lib/graph-serializer.ts`**

```typescript
// Minimal local types (mirrors @mainframe/types without the dependency)
export interface WorkflowStep {
  id: string; type: string; depends_on?: string[]; condition?: string;
  agent?: { adapterId: string }; prompt?: string;
  tool?: string; command?: string;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  name: string;
  triggers: Array<{ type: string }>;
  variables?: Record<string, string>;
  steps: WorkflowStep[];
}

export interface GraphNode { id: string; type: string; position: { x: number; y: number }; data: { step: WorkflowStep }; }
export interface GraphEdge { id: string; source: string; target: string; label?: string; }

export function workflowToGraph(def: WorkflowDefinition): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = def.steps.map((step, i) => ({
    id: step.id,
    type: step.type,
    position: { x: 250, y: i * 140 },
    data: { step },
  }));

  const edges: GraphEdge[] = [];
  for (const step of def.steps) {
    for (const dep of step.depends_on ?? []) {
      edges.push({ id: `${dep}->${step.id}`, source: dep, target: step.id, label: step.condition });
    }
  }
  return { nodes, edges };
}

export function graphToWorkflow(args: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  name: string;
  triggers: Array<{ type: string }>;
  variables?: Record<string, string>;
}): WorkflowDefinition {
  const steps: WorkflowStep[] = args.nodes.map((node) => {
    const deps = args.edges.filter((e) => e.target === node.id).map((e) => e.source);
    return { ...node.data.step, depends_on: deps.length > 0 ? deps : undefined };
  });
  return { name: args.name, triggers: args.triggers, variables: args.variables, steps };
}
```

**Step 8: Implement `WorkflowEditorView.tsx`** (React Flow canvas — center panel)

```tsx
import { useEffect, useState, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, addEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { workflowToGraph, graphToWorkflow, type WorkflowDefinition, type GraphNode, type GraphEdge } from '../lib/graph-serializer.js';
import { PromptNode } from '../nodes/PromptNode.js';
import { ToolNode } from '../nodes/ToolNode.js';
import { bridge } from '../lib/bridge.js';

const nodeTypes = { prompt: PromptNode, tool: ToolNode };

export function WorkflowEditorView({ workflowId, projectId }: { workflowId: string; projectId: string | null }): React.ReactElement {
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge[]>([]);

  useEffect(() => {
    if (!workflowId) return;
    fetch(`/api/plugins/workflows/workflows/${encodeURIComponent(workflowId)}`)
      .then((r) => r.json())
      .then((data: { definition: WorkflowDefinition }) => {
        setDefinition(data.definition);
        const { nodes: n, edges: e } = workflowToGraph(data.definition);
        setNodes(n);
        setEdges(e);
      })
      .catch(() => {});
  }, [workflowId]);

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const handleSave = async () => {
    if (!definition || !projectId) return;
    const updated = graphToWorkflow({ nodes, edges, name: definition.name, triggers: definition.triggers });
    await fetch(`/api/plugins/workflows/workflows/${encodeURIComponent(workflowId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: updated, projectId }),
    });
  };

  const handleRun = async () => {
    if (!projectId) return;
    const res = await fetch(`/api/plugins/workflows/workflows/${encodeURIComponent(workflowId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const run = await res.json() as { id: string };
    bridge.navigate('center', 'run', { runId: run.id });
  };

  if (!definition) return <div style={{ padding: 16, color: '#71717a' }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #27272a' }}>
        <span style={{ fontWeight: 500 }}>{definition.name}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
          <button onClick={handleRun} style={{ fontSize: 12, color: '#22c55e', background: 'none', border: 'none', cursor: 'pointer' }}>▶ Run</button>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background color="#27272a" />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
```

**Step 9: Implement `WorkflowRunView.tsx`** (center panel — live status)

```tsx
import { useEffect, useState } from 'react';

interface StepRun { stepId: string; status: string; startedAt?: string; completedAt?: string; error?: string; }
interface Run { id: string; status: string; startedAt?: string; completedAt?: string; error?: string; }

const STATUS_COLOR: Record<string, string> = {
  pending: '#71717a', running: '#6366f1', completed: '#22c55e', failed: '#ef4444', skipped: '#a1a1aa',
};

export function WorkflowRunView({ runId }: { runId: string }): React.ReactElement {
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<StepRun[]>([]);

  useEffect(() => {
    if (!runId) return;
    const poll = setInterval(async () => {
      const [r, s] = await Promise.all([
        fetch(`/api/plugins/workflows/runs/${runId}`).then((x) => x.json() as Promise<Run>),
        fetch(`/api/plugins/workflows/runs/${runId}/steps`).then((x) => x.json() as Promise<StepRun[]>),
      ]);
      setRun(r);
      setSteps(s);
      if (['completed', 'failed', 'cancelled'].includes(r.status)) clearInterval(poll);
    }, 2000);
    return () => clearInterval(poll);
  }, [runId]);

  if (!run) return <div style={{ padding: 16, color: '#71717a' }}>Loading run…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #27272a', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>Run {run.id.slice(0, 8)}</span>
        <span style={{ fontSize: 11, color: STATUS_COLOR[run.status] ?? '#71717a' }}>{run.status}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {steps.map((step) => (
          <div key={step.stepId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #18181b' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[step.status] ?? '#71717a', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{step.stepId}</span>
            <span style={{ fontSize: 11, color: '#71717a' }}>{step.status}</span>
          </div>
        ))}
        {run.error && (
          <div style={{ marginTop: 12, padding: 8, background: '#450a0a', borderRadius: 4, color: '#fca5a5', fontSize: 12 }}>
            {run.error}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 10: Create node components**

`src/nodes/PromptNode.tsx`:
```tsx
import { Handle, Position } from '@xyflow/react';
import type { WorkflowStep } from '../lib/graph-serializer.js';

export function PromptNode({ data }: { data: { step: WorkflowStep } }): React.ReactElement {
  return (
    <div style={{ background: '#18181b', border: '1px solid #6366f1', borderRadius: 8, padding: '8px 12px', minWidth: 160 }}>
      <Handle type="target" position={Position.Top} style={{ background: '#6366f1' }} />
      <div style={{ fontSize: 10, color: '#818cf8', marginBottom: 4 }}>Prompt</div>
      <div style={{ fontWeight: 500 }}>{data.step.name ?? data.step.id}</div>
      <div style={{ fontSize: 11, color: '#71717a' }}>{(data.step.agent as any)?.adapterId}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1' }} />
    </div>
  );
}
```

`src/nodes/ToolNode.tsx`:
```tsx
import { Handle, Position } from '@xyflow/react';
import type { WorkflowStep } from '../lib/graph-serializer.js';

export function ToolNode({ data }: { data: { step: WorkflowStep } }): React.ReactElement {
  return (
    <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, padding: '8px 12px', minWidth: 160 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: 10, color: '#71717a', marginBottom: 4 }}>Tool</div>
      <div style={{ fontWeight: 500 }}>{data.step.name ?? data.step.id}</div>
      <div style={{ fontSize: 11, color: '#71717a' }}>{String(data.step.tool)}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 11: Add `main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('No root element');
createRoot(root).render(<StrictMode><App /></StrictMode>);
```

**Step 12: Run UI tests**

```bash
pnpm --filter @mainframe/plugin-workflows-ui test
```

**Step 13: Build the UI**

```bash
pnpm --filter @mainframe/plugin-workflows-ui build
# Output goes to packages/plugin-workflows/dist/ui/
```

**Step 14: Commit**

```bash
git add packages/plugin-workflows/ui/
git commit -m "feat(plugin-workflows): add self-contained iframe UI app with React Flow editor, list view, and run view"
```

## Phase 9: End-to-End Verification

### Task 21: End-to-end smoke test

**Step 1: Start Temporal dev server**

```bash
temporal server start-dev
```

**Step 2: Lift center plugin view state to App.tsx**

Before testing the full flow, wire the `centerView` state from `LeftPanel` up to `App.tsx` so the center panel can render plugin iframes. In `packages/desktop/src/renderer/App.tsx`:

```tsx
// Add state for active center plugin view
const [centerPluginView, setCenterPluginView] = useState<{
  pluginId: string; viewId: string; params?: Record<string, unknown>;
} | null>(null);

// Pass down to LeftPanel and render in center panel:
// <LeftPanel onCenterNavigate={setCenterPluginView} />
// In center panel: if centerPluginView → render <PluginPanel contribution={...} centerView={...} />
```

This wiring will be specific to your `App.tsx` layout — trace from `Layout.tsx` to understand where center panel content is currently rendered and add the plugin view slot there.

**Step 3: Create a test workflow file**

In any open project, create `.mainframe/workflows/hello.yml`:
```yaml
name: hello
triggers:
  - type: manual
steps:
  - id: greet
    type: tool
    tool: bash
    command: echo "Hello from workflow!"
    outputs:
      schema:
        type: object
        properties:
          exit_code: { type: integer }
          stdout: { type: string }
```

**Step 4: Build and install the plugin (dev mode)**

```bash
# Build both the daemon-side plugin and the UI app
pnpm --filter @mainframe/plugin-workflows build
pnpm --filter @mainframe/plugin-workflows-ui build
# Output is in packages/plugin-workflows/dist/ (daemon code)
# and packages/plugin-workflows/dist/ui/ (served as static files)

# Install into plugin dir
mkdir -p ~/.mainframe/plugins/workflows
cp packages/plugin-workflows/manifest.json ~/.mainframe/plugins/workflows/
# Symlink for dev so rebuilds are reflected without reinstalling
ln -sf "$(pwd)/packages/plugin-workflows/dist/activate.js" ~/.mainframe/plugins/workflows/index.js
ln -sf "$(pwd)/packages/plugin-workflows/dist/ui" ~/.mainframe/plugins/workflows/ui
```

Add `manifest.json` to `~/.mainframe/plugins/workflows/`:
```json
{ "id": "workflows", "name": "Workflows", "version": "1.0.0" }
```

**Step 4: Set a test license key**

For development, temporarily bypass license check in `activate.ts` by checking for a dev key:
```typescript
if (licenseKey !== 'dev-license-bypass' && !valid) {
  ctx.logger.error('...');
  return;
}
```

Set the dev key:
```bash
# POST /api/plugins/workflows/config (or via SQLite)
sqlite3 ~/.mainframe/mainframe.db "INSERT INTO settings (id, category, key, value, updated_at) VALUES ('plugin:workflows:licenseKey', 'plugin:workflows', 'licenseKey', 'dev-license-bypass', datetime('now'))"
```

**Step 5: Start the daemon and trigger a run**

```bash
pnpm --filter @mainframe/core dev
# In another terminal:
curl -X POST http://localhost:31415/api/plugins/workflows/workflows/proj-id:hello/runs \
  -H 'Content-Type: application/json' \
  -d '{"projectId": "proj-id"}'
```

Expected: `201` with a run object, `status: "running"`.

**Step 6: Check run status**

```bash
curl http://localhost:31415/api/plugins/workflows/runs/<runId>
```

Expected: eventually `status: "completed"`.

**Step 7: Verify in Temporal UI**

Open `http://localhost:8233` → Workflows → see `mainframeWorkflowRunner` completed successfully.

**Step 8: Commit final state**

```bash
git add .
git commit -m "feat: workflows plugin MVP — end-to-end verified"
```

---

## Phase 10: Git Submodule Setup

> **Why submodules:** Each plugin lives in its own GitHub repo so it can be developed,
> versioned, and sold independently of the OSS core. The monorepo references it as a
> git submodule — contributors to the OSS repo never see plugin source code.

### Task 22: Extract plugin-workflows into a git submodule

**Files:**
- Remove: `packages/plugin-workflows/` from monorepo tracking
- Add: `.gitmodules` entry
- Modify: `pnpm-workspace.yaml` (keep `packages/*` — submodule dir is still there on disk)

**Step 1: Create the plugin repo on GitHub**

```bash
# Create a new private repo for the plugin (do this on GitHub first, then:)
git init /tmp/plugin-workflows-init
cd /tmp/plugin-workflows-init
git remote add origin git@github.com:doruchiulan/mainframe-plugin-workflows.git
```

**Step 2: Move plugin source into its own repo**

From the monorepo root:
```bash
# Copy the plugin directory to a temp location
cp -r packages/plugin-workflows /tmp/mainframe-plugin-workflows

# Remove it from the monorepo git tracking (keep files on disk)
git rm -r --cached packages/plugin-workflows
git commit -m "chore: remove plugin-workflows from monorepo (moving to submodule)"

# Set up the plugin as its own git repo
cd /tmp/mainframe-plugin-workflows
git init
git remote add origin git@github.com:doruchiulan/mainframe-plugin-workflows.git
git add .
git commit -m "feat: initial commit from mainframe monorepo"
git push -u origin main
```

**Step 3: Add it back as a submodule**

```bash
# From the monorepo root:
cd /Users/doruchiulan/Projects/qlan/mainframe
git submodule add git@github.com:doruchiulan/mainframe-plugin-workflows.git packages/plugin-workflows
git commit -m "chore: add plugin-workflows as git submodule"
```

This creates `.gitmodules`:
```ini
[submodule "packages/plugin-workflows"]
	path = packages/plugin-workflows
	url = git@github.com:doruchiulan/mainframe-plugin-workflows.git
```

**Step 4: Verify pnpm workspace still resolves the package**

```bash
pnpm install
pnpm --filter @mainframe/plugin-workflows typecheck
```

The submodule directory is still at `packages/plugin-workflows/` so pnpm picks it up as before.

**Step 5: Document submodule workflow for contributors**

Add to the monorepo `README.md`:
```markdown
## Plugin Development

Plugins live in separate git repos added as submodules under `packages/`.

**OSS contributors** (no access to private plugin repos):
```bash
git clone git@github.com:doruchiulan/mainframe.git
# Submodule directories (e.g. packages/plugin-workflows/) will be empty — that is expected.
```

**Mainframe team** (with access to private plugin repos):
```bash
git clone --recurse-submodules git@github.com:doruchiulan/mainframe.git
```

Update all submodules to latest (team only):
```bash
git submodule update --remote --merge
```

The OSS core (`packages/types`, `packages/core`, `packages/desktop`) never contains plugin source code.

> **Note:** `.gitmodules` lists the SSH URL of private plugin repos. This is an acceptable trade-off — OSS contributors can see the repo name but cannot clone it without access.
```

**Step 6: Configure CI to skip submodule checkout for OSS builds**

In `.github/workflows/ci.yml`, ensure the OSS CI job does NOT recurse submodules:
```yaml
- uses: actions/checkout@v4
  with:
    submodules: false   # OSS CI never sees plugin source
```

The plugin repo has its own separate CI workflow.

**Step 7: Commit**

```bash
git add .gitmodules README.md .github/
git commit -m "chore: document submodule workflow and configure OSS CI to skip submodule checkout"
```

---

## Summary

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| 1 — Plugin System | 1–4 | PluginManager, PluginContext, Express integration |
| 2 — Types | 5 | WorkflowDefinition, WorkflowRun types in @mainframe/types |
| 3 — Plugin Foundation | 6–8 | Package scaffold, YAML parser, DB + registry |
| 4 — Temporal | 9–13 | Worker, PromptActivity, ToolActivity, HumanInput, runner |
| 5 — Routes + Triggers | 14–15 | REST API, webhook, cron, event triggers |
| 6 — License | 16 | License key + server validation with cache |
| 7 — activate() | 17 | Full plugin wiring |
| 8 — UI | 18–20 | iframe plugin zones, dynamic LeftPanel, self-contained Vite UI app |
| 9 — E2E | 21 | Smoke test end-to-end |
| 10 — Submodule | 22 | plugin-workflows extracted to its own GitHub repo |

**Key commands for development:**
- `temporal server start-dev` — start local Temporal
- `git submodule update --remote --merge` — pull latest plugin code
- `pnpm --filter @mainframe/plugin-workflows test` — run plugin tests
- `pnpm --filter @mainframe/plugin-workflows-ui build` — build the iframe UI
- `pnpm --filter @mainframe/core test` — run core tests
- `pnpm --filter @mainframe/desktop dev` — start desktop in dev mode
- `temporal workflow list` — check Temporal for running workflows
