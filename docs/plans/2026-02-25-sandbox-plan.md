# App Preview Panel (Sandbox) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a bottom panel to Mainframe with an embedded web preview, element inspector, screenshot capture, and agent context attachment, driven by `project/.mainframe/launch.json` dev server configs.

**Architecture:** The daemon manages dev server processes (reads `launch.json`, spawns/stops via `execFile`, streams stdout/stderr as `DaemonEvent: launch.output`). The desktop Electron renderer uses a native `<webview>` tag for the preview with zero IPC overhead — element inspection and cropped screenshots run entirely in the renderer via `webviewEl.executeJavaScript()` and `webviewEl.capturePage()`. Captured images plus CSS selectors accumulate in a Zustand `sandbox` store and auto-attach to the next chat message.

**Tech Stack:** TypeScript strict/NodeNext, Zod, pino, Express, `<webview>` Electron API, Zustand, React, Tailwind

**Design doc:** `docs/plans/2026-02-25-sandbox-design.md`

---

## Overview of Tasks

1. Shared types — `LaunchConfig`, `DaemonEvent` extensions
2. Core — `launch-config.ts` (read + validate `launch.json`)
3. Core — `launch-manager.ts` (spawn, stop, stream output)
4. Core — `launch.ts` route (REST API)
5. Core — wire `LaunchManager` into server
6. Desktop — enable `webviewTag` in `BrowserWindow`
7. Desktop — `sandbox` Zustand store (captures + process state)
8. Desktop — update `ui` store (`bottomPanelTab` adds `'preview'`)
9. Desktop — launch REST API client
10. Desktop — `BottomPanel` component + wire into `Layout.tsx`
11. Desktop — `PreviewTab` (webview, toolbar, element inspector)
12. Desktop — `LogsTab` (process list + output)
13. Desktop — route `launch.*` WS events into sandbox store
14. Desktop — capture stack → chat composer integration

---

## Task 1: Shared Types

**Files:**
- Create: `packages/types/src/launch.ts`
- Modify: `packages/types/src/events.ts`
- Modify: `packages/types/src/index.ts`

No runtime logic — pure TypeScript. No tests needed; typecheck is the gate.

**Step 1: Create `packages/types/src/launch.ts`**

```typescript
export type LaunchProcessStatus = 'stopped' | 'starting' | 'running' | 'failed';

export interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
}

export interface LaunchConfig {
  version: string;
  configurations: LaunchConfiguration[];
}
```

**Step 2: Add events to `packages/types/src/events.ts`**

In the `DaemonEvent` union, add after the last `plugin.*` entry:

```typescript
  | { type: 'launch.output'; projectId: string; name: string; data: string; stream: 'stdout' | 'stderr' }
  | { type: 'launch.status'; projectId: string; name: string; status: LaunchProcessStatus }
```

Also add the import at the top of `events.ts`:

```typescript
import type { LaunchProcessStatus } from './launch.js';
```

**Step 3: Add barrel export in `packages/types/src/index.ts`**

```typescript
export * from './launch.js';
```

**Step 4: Typecheck**

```bash
pnpm --filter @mainframe/types build
```

Expected: clean build, no errors.

**Step 5: Commit**

```bash
git add packages/types/src/launch.ts packages/types/src/events.ts packages/types/src/index.ts
git commit -m "feat(types): add LaunchConfig types and launch.* DaemonEvents"
```

---

## Task 2: Core — `launch-config.ts`

**Files:**
- Create: `packages/core/src/launch/launch-config.ts`
- Create: `packages/core/src/__tests__/launch-config.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/launch-config.test.ts
import { describe, it, expect } from 'vitest';
import { parseLaunchConfig, getPreviewUrl } from '../launch/launch-config.js';

const VALID_CONFIG = {
  version: '0.0.1',
  configurations: [
    { name: 'API', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 4000, url: null },
    { name: 'UI', runtimeExecutable: 'pnpm', runtimeArgs: ['run', 'dev'], port: 3000, url: null, preview: true },
  ],
};

describe('parseLaunchConfig', () => {
  it('parses a valid config', () => {
    const result = parseLaunchConfig(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.configurations).toHaveLength(2);
  });

  it('rejects a config with no configurations', () => {
    const result = parseLaunchConfig({ version: '0.0.1', configurations: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a config with a shell-injection runtimeExecutable', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [
        { ...VALID_CONFIG.configurations[0]!, runtimeExecutable: 'node; rm -rf /' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when more than one preview:true', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [
        { ...VALID_CONFIG.configurations[0]!, preview: true },
        { ...VALID_CONFIG.configurations[1]!, preview: true },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('getPreviewUrl', () => {
  it('uses url field when present', () => {
    const config = {
      ...VALID_CONFIG,
      configurations: [
        { name: 'UI', runtimeExecutable: 'pnpm', runtimeArgs: [], port: 3000, url: 'http://myproxy.local', preview: true },
      ],
    };
    expect(getPreviewUrl(config.configurations)).toBe('http://myproxy.local');
  });

  it('constructs localhost url from port', () => {
    expect(getPreviewUrl(VALID_CONFIG.configurations)).toBe('http://localhost:3000');
  });

  it('returns null when no preview config', () => {
    const configs = [{ name: 'API', runtimeExecutable: 'node', runtimeArgs: [], port: 4000, url: null }];
    expect(getPreviewUrl(configs)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose launch-config
```

Expected: FAIL with "Cannot find module '../launch/launch-config.js'"

**Step 3: Implement `packages/core/src/launch/launch-config.ts`**

```typescript
import { z } from 'zod';
import type { LaunchConfig, LaunchConfiguration } from '@mainframe/types';

// Allowed executables: common package managers + node. No shell operators.
const SAFE_EXECUTABLE = /^(node|pnpm|npm|yarn|bun|python|python3|[a-zA-Z0-9_\-./]+)$/;

const LaunchConfigurationSchema = z.object({
  name: z.string().min(1),
  runtimeExecutable: z
    .string()
    .min(1)
    .refine((v) => SAFE_EXECUTABLE.test(v) && !v.includes(';') && !v.includes('|') && !v.includes('&'), {
      message: 'runtimeExecutable must be a safe executable name (no shell operators)',
    }),
  runtimeArgs: z.array(z.string()),
  port: z.number().int().positive().nullable(),
  url: z.string().url().nullable(),
  preview: z.boolean().optional(),
});

const LaunchConfigSchema = z
  .object({
    version: z.string(),
    configurations: z.array(LaunchConfigurationSchema).min(1, 'At least one configuration is required'),
  })
  .refine(
    (v) => v.configurations.filter((c) => c.preview).length <= 1,
    { message: 'At most one configuration may have preview: true' },
  );

export function parseLaunchConfig(
  data: unknown,
): { success: true; data: LaunchConfig } | { success: false; error: string } {
  const result = LaunchConfigSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => i.message).join(', ') };
  }
  return { success: true, data: result.data as LaunchConfig };
}

export function getPreviewUrl(configurations: LaunchConfiguration[]): string | null {
  const preview = configurations.find((c) => c.preview);
  if (!preview) return null;
  if (preview.url) return preview.url;
  if (preview.port) return `http://localhost:${preview.port}`;
  return null;
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose launch-config
```

Expected: all 7 tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/launch/launch-config.ts packages/core/src/__tests__/launch-config.test.ts
git commit -m "feat(core): add launch-config parser with Zod validation"
```

---

## Task 3: Core — `launch-manager.ts`

**Files:**
- Create: `packages/core/src/launch/launch-manager.ts`
- Create: `packages/core/src/launch/index.ts`
- Create: `packages/core/src/__tests__/launch-manager.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/launch-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LaunchManager } from '../launch/launch-manager.js';
import type { DaemonEvent } from '@mainframe/types';

const ECHO_CONFIG = {
  version: '0.0.1',
  configurations: [
    {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'process.stdout.write("hello"); process.exit(0);'],
      port: 3000,
      url: null,
      preview: true,
    },
  ],
};

describe('LaunchManager', () => {
  let events: DaemonEvent[];
  let manager: LaunchManager;

  beforeEach(() => {
    events = [];
    manager = new LaunchManager('proj-1', '/tmp', (e) => events.push(e));
  });

  afterEach(() => {
    manager.stopAll();
  });

  it('starts a process and emits status running', async () => {
    await manager.start(ECHO_CONFIG.configurations[0]!);
    const statusEvents = events.filter((e) => e.type === 'launch.status') as Array<{
      type: 'launch.status';
      status: string;
    }>;
    expect(statusEvents.some((e) => e.status === 'starting' || e.status === 'running')).toBe(true);
  });

  it('emits output events from stdout', async () => {
    await manager.start(ECHO_CONFIG.configurations[0]!);
    // Give the process time to write stdout
    await new Promise((r) => setTimeout(r, 200));
    const outputEvents = events.filter((e) => e.type === 'launch.output') as Array<{
      type: 'launch.output';
      data: string;
      stream: string;
    }>;
    expect(outputEvents.some((e) => e.data.includes('hello'))).toBe(true);
  });

  it('stop emits status stopped', async () => {
    // Use a long-running process
    const config = {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'setInterval(() => {}, 10000);'],
      port: 3001,
      url: null,
      preview: false,
    };
    await manager.start(config);
    manager.stop('server');
    await new Promise((r) => setTimeout(r, 100));
    const statusEvents = events
      .filter((e) => e.type === 'launch.status')
      .map((e) => (e as { type: 'launch.status'; status: string }).status);
    expect(statusEvents).toContain('stopped');
  });

  it('getStatus returns stopped for unknown name', () => {
    expect(manager.getStatus('nonexistent')).toBe('stopped');
  });

  it('getStatus returns running while process is alive', async () => {
    const config = {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'setInterval(() => {}, 10000);'],
      port: 3001,
      url: null,
      preview: false,
    };
    await manager.start(config);
    expect(manager.getStatus('server')).toBe('running');
    manager.stop('server');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose launch-manager
```

Expected: FAIL with "Cannot find module"

**Step 3: Implement `packages/core/src/launch/launch-manager.ts`**

```typescript
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { DaemonEvent, LaunchConfiguration, LaunchProcessStatus } from '@mainframe/types';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('launch');

interface ManagedProcess {
  process: ChildProcess;
  status: LaunchProcessStatus;
}

export class LaunchManager {
  private processes = new Map<string, ManagedProcess>();

  constructor(
    private projectId: string,
    private projectPath: string,
    private onEvent: (event: DaemonEvent) => void,
  ) {}

  async start(config: LaunchConfiguration): Promise<void> {
    if (this.processes.has(config.name)) {
      log.warn({ name: config.name }, 'process already running, skipping start');
      return;
    }

    this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'starting' });

    const child = spawn(config.runtimeExecutable, config.runtimeArgs, {
      cwd: this.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const managed: ManagedProcess = { process: child, status: 'starting' };
    this.processes.set(config.name, managed);

    child.stdout?.on('data', (chunk: Buffer) => {
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        name: config.name,
        data: chunk.toString('utf-8'),
        stream: 'stdout',
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        name: config.name,
        data: chunk.toString('utf-8'),
        stream: 'stderr',
      });
    });

    child.on('spawn', () => {
      managed.status = 'running';
      this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'running' });
      log.info({ name: config.name, pid: child.pid }, 'process started');
    });

    child.on('error', (err) => {
      log.error({ err, name: config.name }, 'process error');
      managed.status = 'failed';
      this.processes.delete(config.name);
      this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'failed' });
    });

    child.on('exit', (code) => {
      log.info({ name: config.name, code }, 'process exited');
      if (managed.status !== 'stopped') {
        managed.status = code === 0 ? 'stopped' : 'failed';
        this.emit({
          type: 'launch.status',
          projectId: this.projectId,
          name: config.name,
          status: managed.status,
        });
      }
      this.processes.delete(config.name);
    });
  }

  stop(name: string): void {
    const managed = this.processes.get(name);
    if (!managed) return;
    managed.status = 'stopped';
    this.emit({ type: 'launch.status', projectId: this.projectId, name, status: 'stopped' });
    managed.process.kill('SIGTERM');
    this.processes.delete(name);
    log.info({ name }, 'process stopped');
  }

  stopAll(): void {
    for (const name of this.processes.keys()) {
      this.stop(name);
    }
  }

  getStatus(name: string): LaunchProcessStatus {
    return this.processes.get(name)?.status ?? 'stopped';
  }

  getAllStatuses(): Record<string, LaunchProcessStatus> {
    const result: Record<string, LaunchProcessStatus> = {};
    for (const [name, managed] of this.processes) {
      result[name] = managed.status;
    }
    return result;
  }

  private emit(event: DaemonEvent): void {
    this.onEvent(event);
  }
}
```

**Step 4: Create `packages/core/src/launch/index.ts`**

```typescript
export { LaunchManager } from './launch-manager.js';
export { parseLaunchConfig, getPreviewUrl } from './launch-config.js';
```

**Step 5: Run test to verify it passes**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose launch-manager
```

Expected: all 5 tests pass.

**Step 6: Commit**

```bash
git add packages/core/src/launch/ packages/core/src/__tests__/launch-manager.test.ts
git commit -m "feat(core): add LaunchManager for dev server process lifecycle"
```

---

## Task 4: Core — Launch API Routes

**Files:**
- Create: `packages/core/src/server/routes/launch.ts`
- Create: `packages/core/src/__tests__/routes/launch.test.ts`

The routes handle: GET (read config), POST start/stop per config, GET all statuses.
The `LaunchManager` instances are created per-project on demand, stored by `projectId` in a `Map` inside a `LaunchRegistry` helper passed via `RouteContext`.

**Step 1: Write the failing tests**

```typescript
// packages/core/src/__tests__/routes/launch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchRoutes } from '../../server/routes/launch.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', path: '/tmp/proj' }),
      },
    } as any,
    chats: {} as any,
    adapters: {} as any,
    launchRegistry: {
      getOrCreate: vi.fn().mockReturnValue({
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        getStatus: vi.fn().mockReturnValue('stopped'),
        getAllStatuses: vi.fn().mockReturnValue({}),
      }),
    } as any,
  };
}

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

function extractHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('launchRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('GET /api/projects/:id/launch/status returns all statuses', async () => {
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({
      getAllStatuses: vi.fn().mockReturnValue({ server: 'running' }),
    });
    const handler = extractHandler(launchRoutes(ctx), 'get', '/api/projects/:id/launch/status');
    const req: any = { params: { id: 'proj-1' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { server: 'running' } });
  });

  it('POST start returns 404 when project not found', async () => {
    (ctx.db.projects.get as any).mockReturnValue(undefined);
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'missing', name: 'server' }, body: { configuration: {} } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST start calls manager.start with configuration', async () => {
    const mockStart = vi.fn().mockResolvedValue(undefined);
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({ start: mockStart });
    const config = { name: 'server', runtimeExecutable: 'node', runtimeArgs: [], port: 3000, url: null };
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/start');
    const req: any = { params: { id: 'proj-1', name: 'server' }, body: { configuration: config } };
    const res = mockRes();
    await handler(req, res);
    expect(mockStart).toHaveBeenCalledWith(config);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST stop calls manager.stop', async () => {
    const mockStop = vi.fn();
    (ctx.launchRegistry!.getOrCreate as any).mockReturnValue({ stop: mockStop });
    const handler = extractHandler(launchRoutes(ctx), 'post', '/api/projects/:id/launch/:name/stop');
    const req: any = { params: { id: 'proj-1', name: 'server' } };
    const res = mockRes();
    await handler(req, res);
    expect(mockStop).toHaveBeenCalledWith('server');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose routes/launch
```

Expected: FAIL with "Cannot find module"

**Step 3: Implement `packages/core/src/server/routes/launch.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { validate } from './schemas.js';
import { z } from 'zod';

const StartBody = z.object({
  configuration: z.object({
    name: z.string().min(1),
    runtimeExecutable: z.string().min(1),
    runtimeArgs: z.array(z.string()),
    port: z.number().nullable(),
    url: z.string().nullable(),
    preview: z.boolean().optional(),
  }),
});

export function launchRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/launch/status',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      const statuses = manager?.getAllStatuses() ?? {};
      res.json({ success: true, data: statuses });
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/start',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const parsed = validate(StartBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      if (!manager) {
        res.status(500).json({ success: false, error: 'LaunchRegistry not available' });
        return;
      }
      await manager.start(parsed.data.configuration);
      res.json({ success: true });
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/stop',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const name = param(req, 'name');
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      manager?.stop(name);
      res.json({ success: true });
    }),
  );

  return router;
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose routes/launch
```

Expected: all 4 tests pass.

**Step 5: Commit**

```bash
git add packages/core/src/server/routes/launch.ts packages/core/src/__tests__/routes/launch.test.ts
git commit -m "feat(core): add launch API routes for dev server process control"
```

---

## Task 5: Core — Wire LaunchManager into Server

**Files:**
- Create: `packages/core/src/launch/launch-registry.ts`
- Modify: `packages/core/src/server/routes/types.ts`
- Modify: `packages/core/src/server/routes/index.ts`
- Modify: `packages/core/src/server/http.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create `packages/core/src/launch/launch-registry.ts`**

A simple registry that creates one `LaunchManager` per project.

```typescript
import type { DaemonEvent } from '@mainframe/types';
import { LaunchManager } from './launch-manager.js';

export class LaunchRegistry {
  private managers = new Map<string, LaunchManager>();

  constructor(private onEvent: (event: DaemonEvent) => void) {}

  getOrCreate(projectId: string, projectPath: string): LaunchManager {
    let manager = this.managers.get(projectId);
    if (!manager) {
      manager = new LaunchManager(projectId, projectPath, this.onEvent);
      this.managers.set(projectId, manager);
    }
    return manager;
  }

  stopAll(): void {
    for (const manager of this.managers.values()) {
      manager.stopAll();
    }
    this.managers.clear();
  }
}
```

Update `packages/core/src/launch/index.ts` to export it:

```typescript
export { LaunchManager } from './launch-manager.js';
export { LaunchRegistry } from './launch-registry.js';
export { parseLaunchConfig, getPreviewUrl } from './launch-config.js';
```

**Step 2: Add `launchRegistry` to `RouteContext` in `packages/core/src/server/routes/types.ts`**

```typescript
import type { LaunchRegistry } from '../../launch/index.js';

export interface RouteContext {
  db: DatabaseManager;
  chats: ChatManager;
  adapters: AdapterRegistry;
  attachmentStore?: AttachmentStore;
  launchRegistry?: LaunchRegistry;  // ← add this line
}
```

**Step 3: Export `launchRoutes` from `packages/core/src/server/routes/index.ts`**

```typescript
export { launchRoutes } from './launch.js';
```

(Add this line to the existing barrel file.)

**Step 4: Register `launchRoutes` in `packages/core/src/server/http.ts`**

In `createHttpServer`, add `launchRegistry?: LaunchRegistry` as a parameter and wire it:

```typescript
// Add import:
import type { LaunchRegistry } from '../launch/index.js';
import { launchRoutes } from './routes/index.js';

// Update function signature:
export function createHttpServer(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginManager?: PluginManager,
  launchRegistry?: LaunchRegistry,  // ← new param
): Express {
  // ...
  const ctx = { db, chats, adapters, attachmentStore, launchRegistry };  // ← include launchRegistry
  // ...
  app.use(launchRoutes(ctx));  // ← add after settingRoutes
```

**Step 5: Update `packages/core/src/server/index.ts`**

Update `createServerManager` to accept and forward `launchRegistry`:

```typescript
import type { LaunchRegistry } from '../launch/index.js';

export function createServerManager(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginManager?: PluginManager,
  launchRegistry?: LaunchRegistry,  // ← new param
): ServerManager {
  const app: Express = createHttpServer(db, chats, adapters, attachmentStore, pluginManager, launchRegistry);
  // ... rest unchanged
}
```

**Step 6: Wire into `packages/core/src/index.ts`**

```typescript
import { LaunchRegistry } from './launch/index.js';

// After `const chats = new ChatManager(...)`:
const launchRegistry = new LaunchRegistry((event) => broadcastEvent(event));

// Update createServerManager call:
const server = createServerManager(db, chats, adapters, attachmentStore, pluginManager, launchRegistry);

// In shutdown():
launchRegistry.stopAll();
```

**Step 7: Typecheck**

```bash
pnpm --filter @mainframe/core build
```

Expected: clean build.

**Step 8: Commit**

```bash
git add packages/core/src/launch/launch-registry.ts \
        packages/core/src/launch/index.ts \
        packages/core/src/server/routes/types.ts \
        packages/core/src/server/routes/index.ts \
        packages/core/src/server/http.ts \
        packages/core/src/server/index.ts \
        packages/core/src/index.ts
git commit -m "feat(core): wire LaunchRegistry into daemon server"
```

---

## Task 6: Desktop — Enable `webviewTag`

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

The `<webview>` tag requires `webviewTag: true` in `BrowserWindow.webPreferences`. Without this, the tag renders as a blank `<div>`.

**Step 1: Edit `createWindow()` in `packages/desktop/src/main/index.ts`**

In the `webPreferences` object:

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  nodeIntegration: false,
  contextIsolation: true,
  webviewTag: true,  // ← add this line
},
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): enable webviewTag in BrowserWindow"
```

---

## Task 7: Desktop — Sandbox Zustand Store

**Files:**
- Create: `packages/desktop/src/renderer/store/sandbox.ts`

This store holds the capture stack and per-project process statuses.

**Step 1: Create `packages/desktop/src/renderer/store/sandbox.ts`**

```typescript
import { create } from 'zustand';
import { nanoid } from 'nanoid';

export interface Capture {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
}

interface ProcessStatus {
  [name: string]: 'stopped' | 'starting' | 'running' | 'failed';
}

interface SandboxState {
  captures: Capture[];
  processStatuses: ProcessStatus;
  logsOutput: { name: string; data: string; stream: 'stdout' | 'stderr' }[];

  addCapture: (capture: Omit<Capture, 'id'>) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setProcessStatus: (name: string, status: ProcessStatus[string]) => void;
  appendLog: (name: string, data: string, stream: 'stdout' | 'stderr') => void;
  clearLogs: () => void;
}

export const useSandboxStore = create<SandboxState>()((set) => ({
  captures: [],
  processStatuses: {},
  logsOutput: [],

  addCapture: (capture) =>
    set((state) => ({ captures: [...state.captures, { id: nanoid(), ...capture }] })),

  removeCapture: (id) =>
    set((state) => ({ captures: state.captures.filter((c) => c.id !== id) })),

  clearCaptures: () => set({ captures: [] }),

  setProcessStatus: (name, status) =>
    set((state) => ({ processStatuses: { ...state.processStatuses, [name]: status } })),

  appendLog: (name, data, stream) =>
    set((state) => ({
      // Keep last 500 entries to avoid unbounded growth
      logsOutput: [...state.logsOutput.slice(-499), { name, data, stream }],
    })),

  clearLogs: () => set({ logsOutput: [] }),
}));
```

**Step 2: Export from the store barrel**

In `packages/desktop/src/renderer/store/index.ts`, add:

```typescript
export { useSandboxStore } from './sandbox.js';
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean build.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/store/sandbox.ts packages/desktop/src/renderer/store/index.ts
git commit -m "feat(desktop): add sandbox Zustand store for capture stack and process status"
```

---

## Task 8: Desktop — Update UI Store

**Files:**
- Modify: `packages/desktop/src/renderer/store/ui.ts`

Add `'preview'` and `'logs'` to `bottomPanelTab`. The existing values (`'terminal' | 'history' | 'logs'`) suggest `'logs'` is already there — verify and add `'preview'`.

**Step 1: Edit `packages/desktop/src/renderer/store/ui.ts`**

Change the type:

```typescript
// Before:
bottomPanelTab: 'terminal' | 'history' | 'logs';

// After:
bottomPanelTab: 'preview' | 'logs';
```

Change the default:

```typescript
// Before:
bottomPanelTab: 'terminal',

// After:
bottomPanelTab: 'preview',
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean build. Fix any type errors from the changed union.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/store/ui.ts
git commit -m "feat(desktop): update bottomPanelTab to preview | logs"
```

---

## Task 9: Desktop — Launch REST API Client

**Files:**
- Create: `packages/desktop/src/renderer/lib/launch.ts`

**Step 1: Create `packages/desktop/src/renderer/lib/launch.ts`**

```typescript
const BASE = 'http://127.0.0.1:31415';

export interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
}

export async function fetchLaunchStatuses(projectId: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/launch/status`);
  if (!res.ok) return {};
  const json = await res.json() as { success: boolean; data: Record<string, string> };
  return json.success ? json.data : {};
}

export async function startLaunchConfig(projectId: string, configuration: LaunchConfiguration): Promise<void> {
  await fetch(`${BASE}/api/projects/${projectId}/launch/${encodeURIComponent(configuration.name)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configuration }),
  });
}

export async function stopLaunchConfig(projectId: string, name: string): Promise<void> {
  await fetch(`${BASE}/api/projects/${projectId}/launch/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
  });
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/launch.ts
git commit -m "feat(desktop): add launch REST API client"
```

---

## Task 10: Desktop — Bottom Panel + Layout

**Files:**
- Create: `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`
- Modify: `packages/desktop/src/renderer/components/Layout.tsx`

**Step 1: Create `packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx`**

```tsx
import React from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';
import { LogsTab } from './LogsTab';

export function BottomPanel(): React.ReactElement | null {
  const { panelCollapsed, bottomPanelTab, setBottomPanelTab } = useUIStore();

  if (panelCollapsed.bottom) return null;

  return (
    <div className="w-full flex flex-col bg-mf-panel-bg border-t border-mf-divider" style={{ height: 320 }}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-1 border-b border-mf-divider shrink-0">
        {(['preview', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setBottomPanelTab(tab)}
            className={[
              'px-3 py-1.5 text-xs rounded-t font-medium transition-colors',
              bottomPanelTab === tab
                ? 'bg-mf-app-bg text-mf-text-primary'
                : 'text-mf-text-secondary hover:text-mf-text-primary',
            ].join(' ')}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {bottomPanelTab === 'preview' && <PreviewTab />}
        {bottomPanelTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}
```

**Step 2: Add `BottomPanel` to `Layout.tsx`**

In `packages/desktop/src/renderer/components/Layout.tsx`:

Add import:
```typescript
import { BottomPanel } from './sandbox/BottomPanel';
```

In the JSX, add `<BottomPanel />` after the `<div className="flex-1 flex overflow-hidden gap-0">` closing tag and before `<StatusBar />`:

```tsx
// Before:
      <StatusBar />

// After:
      <BottomPanel />
      <StatusBar />
```

Also add a toggle button somewhere (e.g. in `StatusBar` or `TitleBar`). Find `StatusBar.tsx` and add a "Preview" toggle button — or add a keyboard shortcut in `App.tsx`. For now, add it to `StatusBar`:

In `packages/desktop/src/renderer/components/StatusBar.tsx`, import and use `useUIStore`:
```tsx
const togglePanel = useUIStore((s) => s.togglePanel);
// Add button:
<button onClick={() => togglePanel('bottom')} className="...">Preview</button>
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean build (stub `PreviewTab` and `LogsTab` with placeholder if needed).

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/BottomPanel.tsx \
        packages/desktop/src/renderer/components/Layout.tsx \
        packages/desktop/src/renderer/components/StatusBar.tsx
git commit -m "feat(desktop): add BottomPanel container with preview/logs tabs"
```

---

## Task 11: Desktop — `PreviewTab` (Webview + Inspector)

**Files:**
- Create: `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`

This is the main component. Key notes:
- `<webview>` is a custom Electron element — TypeScript doesn't know its type by default. Use `ref` typed as `HTMLElement` and cast when calling webview-specific APIs.
- `webviewEl.executeJavaScript(code)` resolves when code evaluates (or when a returned Promise resolves).
- `webviewEl.capturePage([rect])` returns `Promise<NativeImage>`. Call `nativeImage.toDataURL()` to get a data URL.
- Inspection mode uses a Promise-based script: inject a script that resolves when user clicks.

**Step 1: Create `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx`**

```tsx
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';

// CSS selector generator — injected into the webview page
const GET_SELECTOR_FN = `
function getSelector(el) {
  if (el.id) return '#' + el.id;
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body) {
    let sel = cur.tagName.toLowerCase();
    if (cur.className && typeof cur.className === 'string') {
      sel += '.' + cur.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}
`;

const INSPECT_SCRIPT = `
(function() {
  ${GET_SELECTOR_FN}
  // Remove previous overlay if any
  var old = document.getElementById('__mf_overlay');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = '__mf_overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);z-index:999999;transition:all 0.05s;';
  document.body.appendChild(overlay);

  function highlight(el) {
    var r = el.getBoundingClientRect();
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  return new Promise(function(resolve) {
    function onMove(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== overlay) highlight(el);
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      overlay.remove();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { resolve(null); return; }
      var rect = el.getBoundingClientRect();
      resolve({ selector: getSelector(el), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  });
})()
`;

interface ElementPickResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
}

export function PreviewTab(): React.ReactElement {
  const webviewRef = useRef<HTMLElement>(null);
  const [url, setUrl] = useState('about:blank');
  const [inspecting, setInspecting] = useState(false);
  const { addCapture } = useSandboxStore();
  const activeProject = useProjectsStore((s) => s.activeProject);

  // Load preview URL from launch config when project changes
  useEffect(() => {
    if (!activeProject) return;
    // The URL is driven by the launch.json — read it from the project path via IPC
    void window.mainframe
      .readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) return;
        const config = JSON.parse(content) as {
          configurations: Array<{ port: number | null; url: string | null; preview?: boolean }>;
        };
        const preview = config.configurations.find((c) => c.preview);
        if (!preview) return;
        const previewUrl = preview.url ?? (preview.port ? `http://localhost:${preview.port}` : null);
        if (previewUrl) setUrl(previewUrl);
      })
      .catch(() => { /* no launch.json — expected */ });
  }, [activeProject?.id]);

  const handleFullScreenshot = useCallback(async () => {
    const wv = webviewRef.current as any;
    if (!wv) return;
    try {
      const image = await wv.capturePage();
      const dataUrl = image.toDataURL() as string;
      addCapture({ type: 'screenshot', imageDataUrl: dataUrl });
    } catch (err) {
      console.warn('[sandbox] full screenshot failed', err);
    }
  }, [addCapture]);

  const handleInspect = useCallback(async () => {
    if (inspecting) { setInspecting(false); return; }
    const wv = webviewRef.current as any;
    if (!wv) return;
    setInspecting(true);
    try {
      const result = (await wv.executeJavaScript(INSPECT_SCRIPT)) as ElementPickResult | null;
      if (!result) return;
      const image = await wv.capturePage({
        x: Math.round(result.rect.x),
        y: Math.round(result.rect.y),
        width: Math.round(result.rect.width),
        height: Math.round(result.rect.height),
      });
      const dataUrl = image.toDataURL() as string;
      addCapture({ type: 'element', imageDataUrl: dataUrl, selector: result.selector });
    } catch (err) {
      console.warn('[sandbox] inspect failed', err);
    } finally {
      setInspecting(false);
    }
  }, [inspecting, addCapture]);

  const isElectron = typeof window !== 'undefined' && 'mainframe' in window && 'webviewTag' in (document.createElement('div') as any);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-mf-divider bg-mf-app-bg shrink-0">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const wv = webviewRef.current as any; wv?.loadURL(url); }}}
          className="flex-1 text-xs bg-mf-input-bg rounded px-2 py-1 text-mf-text-primary border border-mf-divider"
          placeholder="http://localhost:3000"
        />
        <button
          onClick={() => { const wv = webviewRef.current as any; wv?.reload(); }}
          className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-1 rounded"
          title="Reload"
        >
          ↺
        </button>
        <button
          onClick={() => void handleInspect()}
          className={['text-xs px-2 py-1 rounded', inspecting ? 'bg-blue-500 text-white' : 'text-mf-text-secondary hover:text-mf-text-primary'].join(' ')}
          title="Pick element"
        >
          ⊕
        </button>
        <button
          onClick={() => void handleFullScreenshot()}
          className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-1 rounded"
          title="Full screenshot"
        >
          📷
        </button>
      </div>

      {/* Webview or fallback */}
      <div className="flex-1 overflow-hidden">
        {isElectron ? (
          // @ts-expect-error — webview is Electron-specific
          <webview ref={webviewRef} src={url} className="w-full h-full" />
        ) : (
          <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
            Preview panel requires Electron. Use <code className="mx-1">pnpm dev:desktop</code> instead of{' '}
            <code className="mx-1">dev:web</code>.
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean (the `@ts-expect-error` handles the `<webview>` typing).

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx
git commit -m "feat(desktop): add PreviewTab with webview element inspector and screenshot capture"
```

---

## Task 12: Desktop — `LogsTab` (Process List + Output)

**Files:**
- Create: `packages/desktop/src/renderer/components/sandbox/LogsTab.tsx`

**Step 1: Create `packages/desktop/src/renderer/components/sandbox/LogsTab.tsx`**

The `LogsTab` shows:
- List of processes from `launch.json` with per-process Start/Stop
- Output scrolled to bottom

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';
import { fetchLaunchStatuses, startLaunchConfig, stopLaunchConfig, type LaunchConfiguration } from '../../lib/launch';

export function LogsTab(): React.ReactElement {
  const { processStatuses, logsOutput } = useSandboxStore();
  const activeProject = useProjectsStore((s) => s.activeProject);
  const [configs, setConfigs] = useState<LaunchConfiguration[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Load launch.json configurations
  useEffect(() => {
    if (!activeProject) return;
    void window.mainframe
      .readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) return;
        const config = JSON.parse(content) as { configurations: LaunchConfiguration[] };
        setConfigs(config.configurations);
        if (config.configurations[0]) setSelectedProcess(config.configurations[0].name);
      })
      .catch(() => {});
  }, [activeProject?.id]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logsOutput]);

  const filteredLogs = selectedProcess
    ? logsOutput.filter((l) => l.name === selectedProcess)
    : logsOutput;

  const handleStart = async (config: LaunchConfiguration) => {
    if (!activeProject) return;
    await startLaunchConfig(activeProject.id, config);
  };

  const handleStop = async (name: string) => {
    if (!activeProject) return;
    await stopLaunchConfig(activeProject.id, name);
  };

  const handleStartAll = () => {
    configs.forEach((c) => void handleStart(c));
  };

  const handleStopAll = () => {
    configs.forEach((c) => void handleStop(c.name));
  };

  const statusColor = (s?: string) => {
    if (s === 'running') return 'text-green-400';
    if (s === 'starting') return 'text-yellow-400';
    if (s === 'failed') return 'text-red-400';
    return 'text-mf-text-secondary';
  };

  if (!activeProject) {
    return <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">No project selected.</div>;
  }

  if (configs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
        No <code className="mx-1">.mainframe/launch.json</code> found in this project.
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Process list */}
      <div className="w-48 border-r border-mf-divider flex flex-col shrink-0">
        <div className="flex gap-1 p-2 border-b border-mf-divider">
          <button onClick={handleStartAll} className="flex-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded py-1">All ▶</button>
          <button onClick={handleStopAll} className="flex-1 text-xs bg-red-800 hover:bg-red-700 text-white rounded py-1">All ■</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {configs.map((c) => {
            const status = processStatuses[c.name] ?? 'stopped';
            return (
              <div
                key={c.name}
                onClick={() => setSelectedProcess(c.name)}
                className={['flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-mf-hover', selectedProcess === c.name ? 'bg-mf-selected' : ''].join(' ')}
              >
                <span className={['w-1.5 h-1.5 rounded-full', status === 'running' ? 'bg-green-400' : status === 'starting' ? 'bg-yellow-400' : status === 'failed' ? 'bg-red-400' : 'bg-mf-text-secondary'].join(' ')} />
                <span className="flex-1 text-xs truncate text-mf-text-primary">{c.name}</span>
                {status === 'running' || status === 'starting' ? (
                  <button onClick={(e) => { e.stopPropagation(); void handleStop(c.name); }} className="text-mf-text-secondary hover:text-red-400 text-xs">■</button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); void handleStart(c); }} className="text-mf-text-secondary hover:text-green-400 text-xs">▶</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Log output */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs text-mf-text-secondary bg-mf-app-bg">
        {filteredLogs.length === 0 ? (
          <span className="text-mf-text-secondary">No output yet.</span>
        ) : (
          filteredLogs.map((l, i) => (
            <div key={i} className={l.stream === 'stderr' ? 'text-red-400' : ''}>
              {l.data}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/sandbox/LogsTab.tsx
git commit -m "feat(desktop): add LogsTab with process controls and output streaming"
```

---

## Task 13: Desktop — Route `launch.*` WS Events into Sandbox Store

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useDaemon.ts` (or wherever DaemonEvents are handled)

Find where `DaemonEvent` is processed in the frontend. In `useDaemon.ts` or `store/chats.ts`, `launch.output` and `launch.status` events need to be forwarded to `useSandboxStore`.

**Step 1: Find the event handler in `packages/desktop/src/renderer/hooks/useDaemon.ts`**

Read the file first, then find the `switch (event.type)` or `if (event.type === ...)` block.

**Step 2: Add handlers for `launch.*`**

```typescript
import { useSandboxStore } from '../store/sandbox';

// In the event handler:
case 'launch.output': {
  useSandboxStore.getState().appendLog(event.name, event.data, event.stream);
  break;
}
case 'launch.status': {
  useSandboxStore.getState().setProcessStatus(event.name, event.status);
  break;
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useDaemon.ts
git commit -m "feat(desktop): route launch.output and launch.status WS events to sandbox store"
```

---

## Task 14: Desktop — Capture Stack → Chat Composer Integration

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/` (find the composer component)

Find the chat message composer. It currently handles text input and attachment upload. We need to:
1. Show pending captures as removable chips above the input
2. On send, upload images as attachments and prepend a text preamble

**Step 1: Read the composer component**

```bash
ls packages/desktop/src/renderer/components/chat/
```

Find the file that handles message sending (likely `MessageComposer.tsx` or `ChatInput.tsx`).

**Step 2: Add capture chip display**

Import `useSandboxStore` and render chips:

```tsx
import { useSandboxStore, type Capture } from '../../store/sandbox';

// Inside the composer:
const { captures, removeCapture, clearCaptures } = useSandboxStore();

// Above the text input:
{captures.length > 0 && (
  <div className="flex flex-wrap gap-1 px-3 pt-2">
    {captures.map((c) => (
      <div key={c.id} className="flex items-center gap-1 bg-mf-hover rounded px-2 py-0.5 text-xs text-mf-text-primary">
        {c.type === 'screenshot' ? '📷 screenshot' : `⊕ ${c.selector ?? 'element'}`}
        <button onClick={() => removeCapture(c.id)} className="ml-1 text-mf-text-secondary hover:text-red-400">×</button>
      </div>
    ))}
  </div>
)}
```

**Step 3: Upload captures on send**

In the send handler, before calling `client.sendMessage(...)`:

```typescript
// Upload captures as attachments
let captureAttachmentIds: string[] = [];
let capturePreamble = '';
if (captures.length > 0) {
  const uploadItems = captures.map((c) => {
    // data URL → base64
    const base64 = c.imageDataUrl.split(',')[1] ?? '';
    return {
      name: c.type === 'element' ? `element-${c.selector ?? 'capture'}.png` : 'screenshot.png',
      mediaType: 'image/png',
      data: base64,
      kind: 'image',
    };
  });
  try {
    const res = await fetch('http://127.0.0.1:31415/api/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: uploadItems }),
    });
    const json = await res.json() as { success: boolean; data: { id: string }[] };
    if (json.success) captureAttachmentIds = json.data.map((a) => a.id);
  } catch (err) {
    console.warn('[sandbox] capture upload failed', err);
  }

  const labels = captures.map((c) =>
    c.type === 'element' ? `element \`${c.selector ?? ''}\`` : 'screenshot'
  );
  capturePreamble = `[Preview captures: ${labels.join(', ')}]\n\n`;
  clearCaptures();
}

const finalContent = capturePreamble + content;
const allAttachmentIds = [...(existingAttachmentIds ?? []), ...captureAttachmentIds];
client.sendMessage(chatId, finalContent, allAttachmentIds.length > 0 ? allAttachmentIds : undefined);
```

**Step 4: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: clean build.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/
git commit -m "feat(desktop): integrate capture stack into chat composer"
```

---

## Final Verification

**Step 1: Run all core tests**

```bash
pnpm --filter @mainframe/core test
```

Expected: all pass.

**Step 2: Full build**

```bash
pnpm build
```

Expected: clean build, no TypeScript errors.

**Step 3: Manual smoke test**

1. Create `.mainframe/launch.json` in a test project with a simple dev server config
2. Start Mainframe in Electron dev mode: `pnpm dev:desktop`
3. Open the test project
4. Toggle the bottom panel — Preview and Logs tabs visible
5. In Logs tab — Start button starts the server, output streams
6. In Preview tab — webview loads at `http://localhost:{port}`
7. Click eyedropper, hover/click element — capture chip appears
8. Click camera — full screenshot chip appears
9. Type a message and send — captures are attached, agent sees image + selector preamble

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: app preview panel (sandbox) complete implementation"
```
