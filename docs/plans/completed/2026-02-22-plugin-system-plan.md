# Plugin System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-02-22
**Design doc:** `docs/plans/2026-02-22-plugin-system-design.md`
**Status:** Ready to implement (after prerequisite plans complete)

---

## Execution Order

```
Phase 0 (prerequisites — existing plans, execute first):
  A. 2026-02-17-unified-event-pipeline.md       (~2h)
  B. 2026-02-17-adapter-event-handlers-plan.md  (~4h)
  C. 2026-02-17-adapter-session-refactor.md     (~1 day)

Phase 1: Plugin System Types              (~2h)
Phase 2: Plugin System Core — Backend     (~1 day)
Phase 3: Plugin HTTP Routes               (~2h)
Phase 4: Desktop Plugin Shell             (~4h)
Phase 5: Claude as Bundled Plugin         (~2h)
Phase 6: Integration & Tests              (~4h)
```

Phases 1–3 can be worked on concurrently with desktop work in Phase 4.

---

## Phase 0 — Prerequisites

Execute these three existing plans IN ORDER before starting Phase 1. Each is
self-contained with its own tasks and commit cadence.

| Order | Plan file | Reason required |
|---|---|---|
| 1st | `2026-02-17-unified-event-pipeline.md` | Eliminates duplicate tool_result logic before event handler extraction |
| 2nd | `2026-02-17-adapter-event-handlers-plan.md` | Decouples Claude-specific handling, adds `ToolCategories` — unblocks adapter plugin interface |
| 3rd | `2026-02-17-adapter-session-refactor.md` | `createSession()` / `AdapterSession` pattern is what adapter plugins register |

Do not start Phase 1 until Phase 0 is 100% done and `pnpm build` passes.

---

## Phase 1 — Plugin System Types

### Task 1.1: Add plugin types to @mainframe/types

**Files:**
- Create: `packages/types/src/plugin.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the plugin types**

Create `packages/types/src/plugin.ts`:

```typescript
import type { Logger } from 'pino';
import type { Router } from 'express';

export type PluginCapability =
  | 'storage'
  | 'ui:panels'
  | 'ui:notifications'
  | 'daemon:public-events'
  | 'chat:read'
  | 'chat:read:content'
  | 'chat:create'
  | 'adapters'
  | 'process:exec'
  | 'http:outbound';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  capabilities: PluginCapability[];
  /** Adapter plugins only */
  adapter?: {
    binaryName: string;
    displayName: string;
  };
}

// ─── Public daemon events (never contain message content) ────────────────────
export type PublicDaemonEventName =
  | 'chat.started'
  | 'chat.completed'
  | 'chat.error'
  | 'project.added'
  | 'project.removed';

export type PublicDaemonEvent =
  | { type: 'chat.started'; chatId: string; projectId: string; adapterId: string }
  | { type: 'chat.completed'; chatId: string; projectId: string; cost: number; durationMs: number }
  | { type: 'chat.error'; chatId: string; projectId: string; errorMessage: string }
  | { type: 'project.added'; projectId: string; path: string }
  | { type: 'project.removed'; projectId: string };

// ─── Plugin panel registration ────────────────────────────────────────────────
export type PluginPanelPosition = 'sidebar-primary' | 'sidebar-secondary' | 'bottom';

export interface PluginPanelSpec {
  id: string;
  label: string;
  icon?: string;           // Lucide icon name
  position: PluginPanelPosition;
  entryPoint: string;      // Absolute path to ESM UI bundle
}

// ─── Service APIs exposed to plugins ─────────────────────────────────────────
export interface ChatSummary {
  id: string;
  title: string | null;
  projectId: string;
  adapterId: string;
  createdAt: string;
  source: string;          // 'user' | 'plugin:{pluginId}'
  totalCost: number;
}

export interface ChatServiceAPI {
  listChats(projectId: string): Promise<ChatSummary[]>;
  getChatById(chatId: string): Promise<ChatSummary | null>;
  // Only when 'chat:read:content' is declared:
  getMessages?: (chatId: string) => Promise<import('./chat.js').ChatMessage[]>;
  // Only when 'chat:create' is declared:
  createChat?: (options: {
    projectId: string;
    adapterId?: string;
    model?: string;
    initialMessage?: string;
  }) => Promise<{ chatId: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
}

export interface ProjectServiceAPI {
  listProjects(): Promise<ProjectSummary[]>;
  getProjectById(id: string): Promise<ProjectSummary | null>;
}

export interface AdapterRegistrationAPI {
  register(adapter: import('./adapter.js').Adapter): void;
}

// ─── PluginContext ────────────────────────────────────────────────────────────
export interface PluginDatabaseStatement<T> {
  run(...params: unknown[]): void;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface PluginDatabaseContext {
  runMigration(sql: string): void;
  prepare<T = Record<string, unknown>>(sql: string): PluginDatabaseStatement<T>;
  transaction<T>(fn: () => T): T;
}

export interface PluginEventBus {
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void): void;
  onDaemonEvent(
    event: PublicDaemonEventName,
    handler: (event: PublicDaemonEvent) => void,
  ): void;
}

export interface PluginUIContext {
  addPanel(spec: PluginPanelSpec): void;
  removePanel(panelId: string): void;
  notify(options: { title: string; body: string; level?: 'info' | 'warning' | 'error' }): void;
}

export interface PluginConfig {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly logger: Logger;
  onUnload(fn: () => void): void;

  // Always available
  readonly router: Router;
  readonly config: PluginConfig;
  readonly services: {
    chats: ChatServiceAPI;
    projects: ProjectServiceAPI;
  };

  // Requires 'storage'
  readonly db: PluginDatabaseContext;

  // Requires 'daemon:public-events'
  readonly events: PluginEventBus;

  // Requires 'ui:panels' or 'ui:notifications'
  readonly ui: PluginUIContext;

  // Requires 'adapters'
  readonly adapters?: AdapterRegistrationAPI;
}

// ─── Plugin entry point contract ─────────────────────────────────────────────
export interface PluginModule {
  activate(ctx: PluginContext): void | Promise<void>;
}
```

**Step 2: Export from index.ts**

Add to `packages/types/src/index.ts`:

```typescript
export type {
  PluginCapability,
  PluginManifest,
  PublicDaemonEventName,
  PublicDaemonEvent,
  PluginPanelSpec,
  PluginPanelPosition,
  ChatSummary,
  ChatServiceAPI,
  ProjectSummary,
  ProjectServiceAPI,
  AdapterRegistrationAPI,
  PluginDatabaseContext,
  PluginDatabaseStatement,
  PluginEventBus,
  PluginUIContext,
  PluginConfig,
  PluginContext,
  PluginModule,
} from './plugin.js';
```

**Step 3: Build types package**

Run: `pnpm --filter @mainframe/types build`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/types/src/plugin.ts packages/types/src/index.ts
git commit -m "feat(types): add plugin system types"
```

---

## Phase 2 — Plugin System Core (Backend)

### Task 2.1: Plugin manifest validator

**Files:**
- Create: `packages/core/src/plugins/security/manifest-validator.ts`
- Test: `packages/core/src/__tests__/plugins/manifest-validator.test.ts`

**Step 1: Write failing test**

```typescript
import { validateManifest } from '../../plugins/security/manifest-validator.js';

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['storage', 'ui:panels'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid id (uppercase)', () => {
    const result = validateManifest({ id: 'MyPlugin', name: 'x', version: '1', capabilities: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('id');
  });

  it('rejects unknown capability', () => {
    const result = validateManifest({ id: 'x', name: 'x', version: '1', capabilities: ['malware'] });
    expect(result.success).toBe(false);
  });

  it('requires adapter field when adapters capability is declared', () => {
    const result = validateManifest({ id: 'x', name: 'x', version: '1', capabilities: ['adapters'] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('adapter');
  });
});
```

**Step 2: Implement**

Create `packages/core/src/plugins/security/manifest-validator.ts`:

```typescript
import { z } from 'zod';
import type { PluginManifest } from '@mainframe/types';

const VALID_CAPABILITIES = [
  'storage', 'ui:panels', 'ui:notifications', 'daemon:public-events',
  'chat:read', 'chat:read:content', 'chat:create',
  'adapters', 'process:exec', 'http:outbound',
] as const;

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  capabilities: z.array(z.enum(VALID_CAPABILITIES)),
  adapter: z.object({
    binaryName: z.string().min(1),
    displayName: z.string().min(1),
  }).optional(),
}).superRefine((data, ctx) => {
  if (data.capabilities.includes('adapters') && !data.adapter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'adapter field is required when "adapters" capability is declared',
    });
  }
});

export function validateManifest(raw: unknown): { success: true; manifest: PluginManifest } | { success: false; error: string } {
  const result = ManifestSchema.safeParse(raw);
  if (result.success) {
    return { success: true, manifest: result.data as PluginManifest };
  }
  return { success: false, error: result.error.issues.map((i) => i.message).join('; ') };
}
```

**Step 3: Run tests, commit**

Run: `pnpm --filter @mainframe/core test -- manifest-validator`
Expected: PASS.

```bash
git add packages/core/src/plugins/security/manifest-validator.ts packages/core/src/__tests__/plugins/manifest-validator.test.ts
git commit -m "feat(plugins): add manifest Zod validator"
```

---

### Task 2.2: PluginDatabaseContext

**Files:**
- Create: `packages/core/src/plugins/db-context.ts`
- Test: `packages/core/src/__tests__/plugins/db-context.test.ts`

**Step 1: Write failing test**

```typescript
import { createPluginDatabaseContext } from '../../plugins/db-context.js';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

describe('PluginDatabaseContext', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plugin-db-test-'));
    dbPath = path.join(dir, 'data.db');
  });

  it('runs migrations and allows typed queries', () => {
    const ctx = createPluginDatabaseContext(dbPath);
    ctx.runMigration('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)');
    ctx.prepare('INSERT INTO items VALUES (?, ?)').run('k1', 'v1');
    const row = ctx.prepare<{ id: string; value: string }>('SELECT * FROM items WHERE id = ?').get('k1');
    expect(row).toEqual({ id: 'k1', value: 'v1' });
  });

  it('supports transactions', () => {
    const ctx = createPluginDatabaseContext(dbPath);
    ctx.runMigration('CREATE TABLE t (n INTEGER)');
    ctx.transaction(() => {
      ctx.prepare('INSERT INTO t VALUES (?)').run(1);
      ctx.prepare('INSERT INTO t VALUES (?)').run(2);
    });
    const rows = ctx.prepare<{ n: number }>('SELECT * FROM t').all();
    expect(rows).toHaveLength(2);
  });
});
```

**Step 2: Implement**

Create `packages/core/src/plugins/db-context.ts`:

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PluginDatabaseContext, PluginDatabaseStatement } from '@mainframe/types';

export function createPluginDatabaseContext(dbPath: string): PluginDatabaseContext {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    runMigration(sql: string): void {
      db.exec(sql);
    },

    prepare<T = Record<string, unknown>>(sql: string): PluginDatabaseStatement<T> {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => { stmt.run(...params); },
        get: (...params) => stmt.get(...params) as T | undefined,
        all: (...params) => stmt.all(...params) as T[],
      };
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}
```

**Step 3: Run tests, commit**

```bash
git add packages/core/src/plugins/db-context.ts packages/core/src/__tests__/plugins/db-context.test.ts
git commit -m "feat(plugins): add isolated PluginDatabaseContext"
```

---

### Task 2.3: PluginEventBus

**Files:**
- Create: `packages/core/src/plugins/event-bus.ts`
- Test: `packages/core/src/__tests__/plugins/event-bus.test.ts`

**Step 1: Write failing test**

```typescript
import { createPluginEventBus } from '../../plugins/event-bus.js';
import { EventEmitter } from 'node:events';

describe('PluginEventBus', () => {
  it('emits and receives plugin-scoped events', () => {
    const daemonBus = new EventEmitter();
    const bus = createPluginEventBus('my-plugin', daemonBus);
    const received: unknown[] = [];
    bus.on('item.created', (p) => received.push(p));
    bus.emit('item.created', { id: '1' });
    expect(received).toEqual([{ id: '1' }]);
  });

  it('receives sanitized daemon events', () => {
    const daemonBus = new EventEmitter();
    const bus = createPluginEventBus('my-plugin', daemonBus);
    const received: unknown[] = [];
    bus.onDaemonEvent('chat.completed', (e) => received.push(e));
    daemonBus.emit('plugin:public:chat.completed', { type: 'chat.completed', chatId: 'c1', projectId: 'p1', cost: 0.01, durationMs: 1000 });
    expect(received).toHaveLength(1);
  });

  it('does NOT receive raw daemon events (only public ones)', () => {
    const daemonBus = new EventEmitter();
    const bus = createPluginEventBus('my-plugin', daemonBus);
    let received = false;
    // Plugin tries to subscribe to a raw internal event
    (bus as any).internalEmitter?.on('message.added', () => { received = true; });
    daemonBus.emit('message.added', { content: 'secret' });
    expect(received).toBe(false); // isolated — never received
  });
});
```

**Step 2: Implement**

Create `packages/core/src/plugins/event-bus.ts`:

```typescript
import { EventEmitter } from 'node:events';
import type { PluginEventBus, PublicDaemonEventName, PublicDaemonEvent } from '@mainframe/types';

export const PUBLIC_DAEMON_EVENT_PREFIX = 'plugin:public:';

export function createPluginEventBus(pluginId: string, daemonBus: EventEmitter): PluginEventBus {
  const internalEmitter = new EventEmitter();

  return {
    emit(event: string, payload: unknown): void {
      internalEmitter.emit(`${pluginId}:${event}`, payload);
    },

    on(event: string, handler: (payload: unknown) => void): void {
      internalEmitter.on(`${pluginId}:${event}`, handler);
    },

    onDaemonEvent(
      event: PublicDaemonEventName,
      handler: (e: PublicDaemonEvent) => void,
    ): void {
      // Only subscribes to the namespaced public channel — never to raw daemon events
      daemonBus.on(`${PUBLIC_DAEMON_EVENT_PREFIX}${event}`, handler);
    },
  };
}

/**
 * Emit a sanitized public daemon event to all plugin buses.
 * Called by ChatManager / ProjectManager — never passes raw message content.
 */
export function emitPublicDaemonEvent(daemonBus: EventEmitter, event: PublicDaemonEvent): void {
  daemonBus.emit(`${PUBLIC_DAEMON_EVENT_PREFIX}${event.type}`, event);
}
```

**Step 3: Run tests, commit**

```bash
git add packages/core/src/plugins/event-bus.ts packages/core/src/__tests__/plugins/event-bus.test.ts
git commit -m "feat(plugins): add scoped PluginEventBus with public-only daemon events"
```

---

### Task 2.4: PluginConfig

**Files:**
- Create: `packages/core/src/plugins/config-context.ts`
- Test: `packages/core/src/__tests__/plugins/config-context.test.ts`

**Step 1: Test**

```typescript
import { createPluginConfig } from '../../plugins/config-context.js';

describe('PluginConfig', () => {
  it('stores and retrieves plugin-namespaced keys', () => {
    const settingsStore = new Map<string, string>();
    const getSetting = (k: string) => settingsStore.get(k) ? JSON.parse(settingsStore.get(k)!) : undefined;
    const setSetting = (k: string, v: unknown) => settingsStore.set(k, JSON.stringify(v));

    const config = createPluginConfig('my-plugin', getSetting, setSetting);
    config.set('apiKey', 'abc123');
    expect(config.get('apiKey')).toBe('abc123');
    expect(settingsStore.has('plugin:my-plugin:apiKey')).toBe(true);
  });
});
```

**Step 2: Implement**

Create `packages/core/src/plugins/config-context.ts`:

```typescript
import type { PluginConfig } from '@mainframe/types';

export function createPluginConfig(
  pluginId: string,
  getSetting: (key: string) => unknown,
  setSetting: (key: string, value: unknown) => void,
): PluginConfig {
  const prefix = `plugin:${pluginId}:`;
  const keys: string[] = [];

  return {
    get(key: string): unknown {
      return getSetting(`${prefix}${key}`);
    },
    set(key: string, value: unknown): void {
      if (!keys.includes(key)) keys.push(key);
      setSetting(`${prefix}${key}`, value);
    },
    getAll(): Record<string, unknown> {
      return Object.fromEntries(keys.map((k) => [k, getSetting(`${prefix}${k}`)]));
    },
  };
}
```

**Step 3: Commit**

```bash
git add packages/core/src/plugins/config-context.ts packages/core/src/__tests__/plugins/config-context.test.ts
git commit -m "feat(plugins): add plugin config context"
```

---

### Task 2.5: PluginUIContext

**Files:**
- Create: `packages/core/src/plugins/ui-context.ts`
- Test: `packages/core/src/__tests__/plugins/ui-context.test.ts`

This collects panel registrations and notifies the daemon's WS broadcaster.

**Step 1: Test**

```typescript
import { createPluginUIContext } from '../../plugins/ui-context.js';

describe('PluginUIContext', () => {
  it('calls emit on addPanel', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.addPanel({ id: 'main', label: 'My Panel', position: 'sidebar-primary', entryPoint: './ui.mjs' });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin.panel.registered', pluginId: 'my-plugin' })
    );
  });

  it('resolves entryPoint to absolute path', () => {
    const emitEvent = vi.fn();
    const ui = createPluginUIContext('my-plugin', '/path/to/plugin', emitEvent);
    ui.addPanel({ id: 'main', label: 'L', position: 'sidebar-primary', entryPoint: './ui.mjs' });
    const call = emitEvent.mock.calls[0][0];
    expect(call.entryPoint).toBe('/path/to/plugin/ui.mjs');
  });
});
```

**Step 2: Implement**

Create `packages/core/src/plugins/ui-context.ts`:

```typescript
import path from 'node:path';
import type { PluginUIContext, PluginPanelSpec } from '@mainframe/types';
import type { DaemonEvent } from '@mainframe/types';

export function createPluginUIContext(
  pluginId: string,
  pluginDir: string,
  emitEvent: (event: DaemonEvent) => void,
): PluginUIContext {
  return {
    addPanel(spec: PluginPanelSpec): void {
      const absoluteEntryPoint = path.resolve(pluginDir, spec.entryPoint);
      emitEvent({
        type: 'plugin.panel.registered',
        pluginId,
        panelId: spec.id,
        label: spec.label,
        icon: spec.icon,
        position: spec.position,
        entryPoint: absoluteEntryPoint,
      } as DaemonEvent);
    },

    removePanel(panelId: string): void {
      emitEvent({
        type: 'plugin.panel.unregistered',
        pluginId,
        panelId,
      } as DaemonEvent);
    },

    notify(options): void {
      emitEvent({
        type: 'plugin.notification',
        pluginId,
        ...options,
      } as DaemonEvent);
    },
  };
}
```

**Step 3: Commit**

```bash
git add packages/core/src/plugins/ui-context.ts packages/core/src/__tests__/plugins/ui-context.test.ts
git commit -m "feat(plugins): add PluginUIContext for panel and notification registration"
```

---

### Task 2.6: PluginContext builder (capability gating)

**Files:**
- Create: `packages/core/src/plugins/context.ts`
- Test: `packages/core/src/__tests__/plugins/context.test.ts`

This is the factory that assembles a `PluginContext` and enforces capability declarations.
Any access to an undeclared capability's APIs throws at runtime.

**Step 1: Test**

```typescript
import { buildPluginContext } from '../../plugins/context.js';
// ... (mock dependencies)

describe('buildPluginContext capability gating', () => {
  it('provides db only when storage capability is declared', () => {
    const ctx = buildPluginContext({ manifest: { ...manifest, capabilities: [] }, ...deps });
    expect(() => ctx.db.prepare('SELECT 1')).toThrow(/storage/);
  });

  it('provides db when storage capability is declared', () => {
    const ctx = buildPluginContext({ manifest: { ...manifest, capabilities: ['storage'] }, ...deps });
    expect(() => ctx.db.prepare('SELECT 1')).not.toThrow();
  });

  it('provides adapters only when adapters capability is declared', () => {
    const ctx = buildPluginContext({ manifest: { ...manifest, capabilities: [] }, ...deps });
    expect(ctx.adapters).toBeUndefined();
  });
});
```

**Step 2: Implement `packages/core/src/plugins/context.ts`**

Build a `PluginContext` where each capability-gated property is either:
- The real implementation (if capability declared)
- A Proxy that throws a `PluginCapabilityError` (if not declared)

```typescript
import type { PluginContext, PluginManifest } from '@mainframe/types';
import { createPluginDatabaseContext } from './db-context.js';
import { createPluginEventBus } from './event-bus.js';
import { createPluginConfig } from './config-context.js';
import { createPluginUIContext } from './ui-context.js';
import type { EventEmitter } from 'node:events';
import type { Router } from 'express';
import type { Logger } from 'pino';
import type { DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';

function capabilityGuard(capability: string): never {
  throw new Error(`Plugin capability '${capability}' is required but not declared in manifest`);
}

interface PluginContextDeps {
  manifest: PluginManifest;
  pluginDir: string;
  router: Router;
  logger: Logger;
  daemonBus: EventEmitter;
  db: DatabaseManager;
  adapters: AdapterRegistry;
  emitEvent: (event: DaemonEvent) => void;
  onUnloadCallbacks: (() => void)[];
}

export function buildPluginContext(deps: PluginContextDeps): PluginContext {
  const { manifest, pluginDir } = deps;
  const has = (cap: string) => manifest.capabilities.includes(cap as any);

  const dbContext = has('storage')
    ? createPluginDatabaseContext(`${pluginDir}/data.db`)
    : new Proxy({} as any, { get: () => () => capabilityGuard('storage') });

  const eventBus = has('daemon:public-events')
    ? createPluginEventBus(manifest.id, deps.daemonBus)
    : new Proxy({} as any, { get: () => () => capabilityGuard('daemon:public-events') });

  const uiContext = (has('ui:panels') || has('ui:notifications'))
    ? createPluginUIContext(manifest.id, pluginDir, deps.emitEvent)
    : new Proxy({} as any, { get: () => () => capabilityGuard('ui:panels or ui:notifications') });

  const config = createPluginConfig(
    manifest.id,
    (key) => deps.db.settings.get(key),
    (key, value) => deps.db.settings.set(key, String(value)),
  );

  const chatService = buildChatService(manifest, deps.db);
  const projectService = buildProjectService(deps.db);

  const adaptersApi = has('adapters')
    ? { register: (adapter: any) => deps.adapters.register(adapter) }
    : undefined;

  return {
    manifest,
    logger: deps.logger,
    router: deps.router,
    config,
    db: dbContext,
    events: eventBus,
    ui: uiContext,
    services: { chats: chatService, projects: projectService },
    adapters: adaptersApi,
    onUnload(fn) { deps.onUnloadCallbacks.push(fn); },
  };
}
```

**Step 3: Commit**

```bash
git add packages/core/src/plugins/context.ts packages/core/src/__tests__/plugins/context.test.ts
git commit -m "feat(plugins): add capability-gated PluginContext builder"
```

---

### Task 2.7: PluginManager

**Files:**
- Create: `packages/core/src/plugins/manager.ts`
- Test: `packages/core/src/__tests__/plugins/manager.test.ts`

This is the orchestrator: discovers plugins, loads them, calls `activate()`, and handles unload.

**Step 1: Write failing test**

```typescript
import { PluginManager } from '../../plugins/manager.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('PluginManager', () => {
  it('loads a valid plugin and calls activate', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-'));
    const pluginDir = path.join(pluginsDir, 'my-plugin');
    mkdirSync(pluginDir);
    writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'my-plugin', name: 'My Plugin', version: '1.0.0', capabilities: [],
    }));
    writeFileSync(path.join(pluginDir, 'index.js'), `
      module.exports = { activate(ctx) { ctx.config.set('activated', true); } };
    `);

    const manager = new PluginManager({ pluginsDirs: [pluginsDir], ...mockDeps });
    await manager.loadAll();
    expect(manager.getPlugin('my-plugin')).toBeDefined();
  });

  it('skips plugin with invalid manifest without crashing', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-invalid-'));
    const pluginDir = path.join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ id: 'BAD' }));
    writeFileSync(path.join(pluginDir, 'index.js'), `module.exports = { activate() {} };`);

    const manager = new PluginManager({ pluginsDirs: [pluginsDir], ...mockDeps });
    await manager.loadAll();
    expect(manager.getPlugin('BAD')).toBeUndefined();
  });
});
```

**Step 2: Implement `packages/core/src/plugins/manager.ts`**

```typescript
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Router } from 'express';
import type { PluginContext, PluginModule } from '@mainframe/types';
import { validateManifest } from './security/manifest-validator.js';
import { buildPluginContext } from './context.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('plugin-manager');

interface LoadedPlugin {
  id: string;
  ctx: PluginContext;
  unloadCallbacks: (() => void)[];
}

export class PluginManager {
  private loaded = new Map<string, LoadedPlugin>();
  private require = createRequire(import.meta.url);

  constructor(private deps: PluginManagerDeps) {}

  async loadAll(): Promise<void> {
    for (const dir of this.deps.pluginsDirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        await this.loadPlugin(path.join(dir, entry.name)).catch((err) => {
          log.warn({ err, name: entry.name }, 'Plugin load failed — skipping');
        });
      }
    }
  }

  private async loadPlugin(pluginDir: string): Promise<void> {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) return;

    const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const validation = validateManifest(rawManifest);
    if (!validation.success) {
      log.warn({ pluginDir, error: validation.error }, 'Invalid plugin manifest — skipping');
      return;
    }
    const { manifest } = validation;

    if (this.loaded.has(manifest.id)) {
      log.warn({ id: manifest.id }, 'Duplicate plugin id — skipping');
      return;
    }

    const unloadCallbacks: (() => void)[] = [];
    const pluginRouter = Router();
    this.deps.expressApp.use(`/api/plugins/${manifest.id}`, pluginRouter);

    const ctx = buildPluginContext({
      manifest,
      pluginDir,
      router: pluginRouter,
      logger: createChildLogger(`plugin:${manifest.id}`),
      daemonBus: this.deps.daemonBus,
      db: this.deps.db,
      adapters: this.deps.adapters,
      emitEvent: this.deps.emitEvent,
      onUnloadCallbacks: unloadCallbacks,
    });

    const entryPath = path.join(pluginDir, 'index.js');
    if (!existsSync(entryPath)) {
      log.warn({ id: manifest.id }, 'Plugin has no index.js — skipping activation');
      return;
    }

    const mod = this.require(entryPath) as PluginModule;
    await mod.activate(ctx);

    this.loaded.set(manifest.id, { id: manifest.id, ctx, unloadCallbacks });
    log.info({ id: manifest.id, name: manifest.name }, 'Plugin loaded');
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.loaded.values()) {
      for (const fn of plugin.unloadCallbacks) {
        try { fn(); } catch (err) { log.warn({ err, id: plugin.id }, 'onUnload error'); }
      }
    }
    this.loaded.clear();
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.loaded.get(id);
  }

  getAll(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }
}
```

**Step 3: Run tests, commit**

```bash
git add packages/core/src/plugins/ packages/core/src/__tests__/plugins/
git commit -m "feat(plugins): add PluginManager with directory scanning and lifecycle"
```

---

### Task 2.8: Wire PluginManager into daemon startup

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Find daemon entry point**

Read `packages/core/src/index.ts` to find where the Express app and WebSocket server are initialized.

**Step 2: Add PluginManager initialization**

```typescript
import { PluginManager } from './plugins/manager.js';
import { homedir } from 'node:os';
import path from 'node:path';

// After adapters, db, and emitEvent are set up:
const pluginManager = new PluginManager({
  pluginsDirs: [
    path.join(homedir(), '.mainframe', 'plugins'),
    // Project-local plugins added dynamically when projects open
  ],
  expressApp: app,
  daemonBus,
  db,
  adapters,
  emitEvent,
});

await pluginManager.loadAll();

// On shutdown:
process.on('SIGTERM', async () => {
  await pluginManager.unloadAll();
  process.exit(0);
});
```

**Step 3: Build and typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): wire PluginManager into daemon startup"
```

---

## Phase 3 — Plugin HTTP Routes

### Task 3.1: Plugin listing routes

**Files:**
- Create: `packages/core/src/server/routes/plugins.ts`
- Modify: `packages/core/src/server/http.ts`
- Test: `packages/core/src/__tests__/routes/plugins.test.ts`

**Step 1: Implement routes**

```typescript
// GET /api/plugins
// GET /api/plugins/:id
import { Router } from 'express';
import type { PluginManager } from '../../plugins/manager.js';

export function createPluginRoutes(pluginManager: PluginManager): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const plugins = pluginManager.getAll().map((p) => ({
      id: p.id,
      name: p.ctx.manifest.name,
      version: p.ctx.manifest.version,
      capabilities: p.ctx.manifest.capabilities,
    }));
    res.json({ plugins });
  });

  router.get('/:id', (req, res) => {
    const plugin = pluginManager.getPlugin(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json({
      id: plugin.id,
      name: plugin.ctx.manifest.name,
      version: plugin.ctx.manifest.version,
      description: plugin.ctx.manifest.description,
      capabilities: plugin.ctx.manifest.capabilities,
    });
  });

  return router;
}
```

**Step 2: Mount in http.ts**

```typescript
import { createPluginRoutes } from './routes/plugins.js';
app.use('/api/plugins', createPluginRoutes(pluginManager));
```

Note: Plugin-specific routes are mounted by `PluginManager` under `/api/plugins/:id/`.
The listing routes live here at `/api/plugins` and `/api/plugins/:id` (no trailing slash).
There is no conflict since `:id` only matches if not caught by the listing routes first.

**Step 3: Add WS event types for plugin panels**

In `packages/types/src/events.ts`, add:

```typescript
| { type: 'plugin.panel.registered'; pluginId: string; panelId: string; label: string; icon?: string; position: string; entryPoint: string }
| { type: 'plugin.panel.unregistered'; pluginId: string; panelId: string }
| { type: 'plugin.notification'; pluginId: string; title: string; body: string; level?: string }
```

**Step 4: Run tests, commit**

```bash
git add packages/core/src/server/routes/plugins.ts packages/types/src/events.ts packages/core/src/server/http.ts
git commit -m "feat(core): add plugin listing routes and WS event types"
```

---

## Phase 4 — Desktop Plugin Shell

### Task 4.1: Plugin Zustand store

**Files:**
- Create: `packages/desktop/src/renderer/store/plugins.ts`
- Modify: `packages/desktop/src/renderer/store/index.ts`

**Step 1: Create plugins store**

```typescript
// packages/desktop/src/renderer/store/plugins.ts
import { create } from 'zustand';
import type { PluginPanelSpec } from '@mainframe/types';

interface RegisteredPanel {
  pluginId: string;
  panelId: string;
  label: string;
  icon?: string;
  position: string;
  entryPoint: string;
}

interface PluginsState {
  panels: RegisteredPanel[];
  addPanel(panel: RegisteredPanel): void;
  removePanel(pluginId: string, panelId: string): void;
}

export const usePluginsStore = create<PluginsState>((set) => ({
  panels: [],
  addPanel: (panel) =>
    set((s) => ({ panels: [...s.panels.filter((p) => !(p.pluginId === panel.pluginId && p.panelId === panel.panelId)), panel] })),
  removePanel: (pluginId, panelId) =>
    set((s) => ({ panels: s.panels.filter((p) => !(p.pluginId === pluginId && p.panelId === panelId)) })),
}));
```

**Step 2: Handle WS events in the daemon event listener**

In the existing WS event handler (where `message.added`, `process.started`, etc. are dispatched):

```typescript
case 'plugin.panel.registered':
  usePluginsStore.getState().addPanel(event);
  break;
case 'plugin.panel.unregistered':
  usePluginsStore.getState().removePanel(event.pluginId, event.panelId);
  break;
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/plugins.ts packages/desktop/src/renderer/store/index.ts
git commit -m "feat(desktop): add plugins Zustand store for panel registry"
```

---

### Task 4.2: Dynamic plugin panel loading

**Files:**
- Create: `packages/desktop/src/renderer/components/plugins/PluginPanel.tsx`
- Create: `packages/desktop/src/renderer/components/plugins/PluginError.tsx`
- Create: `packages/desktop/src/renderer/hooks/usePluginComponent.ts`

**Step 1: Dynamic import hook**

```typescript
// packages/desktop/src/renderer/hooks/usePluginComponent.ts
import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

type PluginPanelAPI = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

export function usePluginComponent(entryPoint: string): ComponentType<{ api: PluginPanelAPI }> | null {
  const [Component, setComponent] = useState<ComponentType<{ api: PluginPanelAPI }> | null>(null);
  const loaded = useRef(new Map<string, ComponentType<any>>());

  useEffect(() => {
    if (loaded.current.has(entryPoint)) {
      setComponent(() => loaded.current.get(entryPoint)!);
      return;
    }
    // Dynamic ESM import — Electron renderer can load file:// paths
    import(/* @vite-ignore */ `file://${entryPoint}`)
      .then((mod: { PanelComponent: ComponentType<any> }) => {
        loaded.current.set(entryPoint, mod.PanelComponent);
        setComponent(() => mod.PanelComponent);
      })
      .catch((err) => {
        console.warn(`[plugin] Failed to load ${entryPoint}:`, err);
      });
  }, [entryPoint]);

  return Component;
}
```

**Step 2: PluginPanel component**

```tsx
// packages/desktop/src/renderer/components/plugins/PluginPanel.tsx
import { Suspense } from 'react';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { usePluginComponent } from '../../hooks/usePluginComponent.js';
import { PluginError } from './PluginError.js';
import { buildPluginPanelAPI } from '../../lib/plugin-panel-api.js';

interface Props {
  pluginId: string;
  entryPoint: string;
}

export function PluginPanel({ pluginId, entryPoint }: Props) {
  const Component = usePluginComponent(entryPoint);
  const api = buildPluginPanelAPI(pluginId);

  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Suspense fallback={<div className="p-4 text-mf-text-secondary">Loading plugin…</div>}>
        {Component ? <Component api={api} /> : null}
      </Suspense>
    </ErrorBoundary>
  );
}
```

**Step 3: PluginPanelAPI builder**

```typescript
// packages/desktop/src/renderer/lib/plugin-panel-api.ts
export function buildPluginPanelAPI(pluginId: string) {
  return {
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      const base = `http://localhost:31415/api/plugins/${pluginId}`;
      const url = path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
      return globalThis.fetch(url, init);
    },
  };
}
```

**Step 4: Render plugin panels in sidebar**

In the appropriate sidebar component, add:

```tsx
import { usePluginsStore } from '../../store/plugins.js';
import { PluginPanel } from '../plugins/PluginPanel.js';

// In sidebar render:
const panels = usePluginsStore((s) => s.panels.filter((p) => p.position === 'sidebar-primary'));
{panels.map((p) => (
  <PluginPanel key={`${p.pluginId}:${p.panelId}`} pluginId={p.pluginId} entryPoint={p.entryPoint} />
))}
```

**Step 5: Build and typecheck**

Run: `pnpm --filter @mainframe/desktop build`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/plugins/ packages/desktop/src/renderer/hooks/usePluginComponent.ts packages/desktop/src/renderer/lib/plugin-panel-api.ts
git commit -m "feat(desktop): add dynamic plugin panel loading with ErrorBoundary"
```

---

## Phase 5 — Claude as Bundled Plugin

This phase wraps `ClaudeAdapter` in the plugin contract to validate the entire adapter
plugin path end-to-end. ClaudeAdapter itself is NOT moved or changed — it's just
activated via a builtin plugin.

### Task 5.1: Create builtin claude plugin

**Files:**
- Create: `packages/core/src/plugins/builtin/claude/manifest.json`
- Create: `packages/core/src/plugins/builtin/claude/index.ts`
- Modify: `packages/core/src/plugins/manager.ts` (load builtins before user plugins)

**Step 1: Manifest**

```json
{
  "id": "claude",
  "name": "Claude CLI",
  "version": "1.0.0",
  "description": "Claude CLI adapter — built-in",
  "capabilities": ["adapters", "process:exec"],
  "adapter": {
    "binaryName": "claude",
    "displayName": "Claude CLI"
  }
}
```

**Step 2: Entry point**

```typescript
// packages/core/src/plugins/builtin/claude/index.ts
import type { PluginContext } from '@mainframe/types';
import { ClaudeAdapter } from '../../../adapters/claude.js';

export function activate(ctx: PluginContext): void {
  const adapter = new ClaudeAdapter();
  ctx.adapters!.register(adapter);
  ctx.onUnload(() => adapter.killAll());
  ctx.logger.info('Claude CLI adapter registered');
}
```

**Step 3: Load builtin in PluginManager**

Add a `loadBuiltin(pluginDir: string)` private method to `PluginManager` that bypasses
the file-system manifest read and uses the imported manifest directly (no `require()`
for builtins — just call `activate(ctx)` directly).

```typescript
// In PluginManager.loadAll(), before user plugins:
await this.loadBuiltinPlugin(claudeManifest, claudeActivate);
```

This way, ClaudeAdapter starts via the plugin system, validating the whole path.
Importantly, the `AdapterRegistry` is now populated by plugins, not hardcoded in core.

**Step 4: Verify ClaudeAdapter still registers correctly**

Run daemon manually, send a chat message, verify it works identically to before.

**Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/
git commit -m "feat(plugins): wrap ClaudeAdapter as a builtin plugin to validate adapter plugin path"
```

---

## Phase 6 — Integration Tests & Verification

### Task 6.1: Plugin system integration test

**Files:**
- Create: `packages/core/src/__tests__/plugins/plugin-integration.test.ts`

Write an integration test that:
1. Creates a temp plugin directory with a complete plugin (manifest + index.js)
2. Starts a `PluginManager` with that directory
3. Asserts routes are mounted (mock Express app)
4. Asserts DB context is isolated (writes to temp DB file)
5. Asserts UI panel is registered (mock emitEvent)
6. Calls `unloadAll()` and asserts cleanup callbacks fired

**Step 2: Full build**

Run: `pnpm build`
Expected: PASS — all three packages compile.

**Step 3: All tests pass**

Run: `pnpm test`
Expected: PASS — no regressions, all new plugin tests green.

**Step 4: Verify security properties**

Manual checklist:
- [ ] A plugin without `'storage'` cannot call `ctx.db.prepare()` without getting an error
- [ ] A plugin without `'adapters'` has `ctx.adapters === undefined`
- [ ] Plugin routes are mounted only under `/api/plugins/{pluginId}/`
- [ ] The daemon public event bus NEVER emits a `message.added` event to plugin handlers
- [ ] Claude adapter still works (all existing E2E flows pass)

**Step 5: Commit**

```bash
git add packages/core/src/__tests__/plugins/plugin-integration.test.ts
git commit -m "test(plugins): add plugin system integration test"
```

---

## Summary of Deliverables

| Deliverable | Files | Tests |
|---|---|---|
| Plugin manifest validation | `security/manifest-validator.ts` | ✅ |
| Isolated plugin DB | `db-context.ts` | ✅ |
| Scoped event bus | `event-bus.ts` | ✅ |
| Plugin config | `config-context.ts` | ✅ |
| UI panel registration | `ui-context.ts` | ✅ |
| Capability-gated context | `context.ts` | ✅ |
| Plugin lifecycle manager | `manager.ts` | ✅ |
| Plugin HTTP routes | `server/routes/plugins.ts` | ✅ |
| WS event types | `@mainframe/types` | — |
| Desktop panel store | `store/plugins.ts` | — |
| Dynamic panel loading | `components/plugins/` | — |
| Claude builtin plugin | `builtin/claude/` | manual |

---

## What Comes Next (Out of Scope Here)

- `plugin-workflows` package — the Temporal-backed workflow engine (separate plan)
- Plugin install UX — download + extract flow for `~/.mainframe/plugins/`
- Project-local plugin scoping — auto-load `.mainframe/plugins/` when project opens
- Plugin update mechanism — version comparison + hot-reload
- `@mainframe/plugin-api` npm package — published type definitions for plugin authors
