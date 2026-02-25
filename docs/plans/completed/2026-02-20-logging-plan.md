# Logging System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file-based log persistence across daemon, Electron main process, and renderer, with consistent INFO/DEBUG coverage for user actions and internals.

**Architecture:** Daemon uses pino-roll (worker-thread transport) for daily-rotating NDJSON files; Electron main uses pino with pino.multistream (no worker threads) for reliable packaged-app compatibility; renderer forwards logs to main via IPC, which writes to a separate daily file.

**Tech Stack:** pino ^10 (already in core), pino-roll (new in core), pino (new in desktop), pino.multistream, Electron ipcMain/ipcRenderer

**Design doc:** `docs/plans/2026-02-20-logging-design.md`

---

## Task 1: Install dependencies

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/desktop/package.json`

**Step 1: Add pino-roll to core**

```bash
cd packages/core && pnpm add pino-roll
```

Expected: `pino-roll` appears in `packages/core/package.json` under `dependencies`.

**Step 2: Add pino to desktop**

```bash
cd packages/desktop && pnpm add pino
```

Expected: `pino` appears in `packages/desktop/package.json` under `dependencies`.

**Step 3: Verify install**

```bash
cd /path/to/repo && pnpm install
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/core/package.json packages/desktop/package.json pnpm-lock.yaml
git commit -m "chore(deps): add pino-roll to core, pino to desktop"
```

---

## Task 2: Update daemon logger with file transport

**Files:**
- Modify: `packages/core/src/logger.ts`

Current file is 11 lines. Replace it entirely with the version below. The key changes:
- In test mode (`NODE_ENV=test`): suppress all output, no file transport.
- In dev mode: pino-pretty to stdout + pino-roll to file.
- In production: NDJSON to stdout (fd 1) + pino-roll to file.
- pino-roll config: daily rotation, keep last 7 files, creates dir if missing.

**Step 1: Replace `packages/core/src/logger.ts`**

```ts
import pino from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getDataDir } from './config.js';

function buildTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  const isTest = process.env.NODE_ENV === 'test';
  const isProd = process.env.NODE_ENV === 'production';

  if (isTest) {
    return undefined; // level is 'silent'; no transport needed
  }

  const logDir = join(getDataDir(), 'logs');
  mkdirSync(logDir, { recursive: true });

  const fileTarget: pino.TransportTargetOptions = {
    target: 'pino-roll',
    options: {
      file: join(logDir, 'daemon.log'),
      frequency: 'daily',
      limit: { count: 7 },
      mkdir: true,
    },
  };

  if (!isProd) {
    return {
      targets: [
        { target: 'pino-pretty', options: { colorize: true } },
        fileTarget,
      ],
    };
  }

  return {
    targets: [
      { target: 'pino/file', options: { destination: 1 } }, // fd 1 = stdout
      fileTarget,
    ],
  };
}

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  transport: buildTransport(),
});

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
```

**Step 2: Run core tests to confirm no regressions**

```bash
pnpm --filter @mainframe/core test
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add packages/core/src/logger.ts
git commit -m "feat(core): add pino-roll file transport to daemon logger"
```

---

## Task 3: Update core dev script

**Files:**
- Modify: `packages/core/package.json`

Change the `"dev"` script to run at debug level automatically.

**Step 1: Edit the dev script**

In `packages/core/package.json`, change:
```json
"dev": "tsx watch src/index.ts",
```
to:
```json
"dev": "LOG_LEVEL=debug tsx watch src/index.ts",
```

**Step 2: Commit**

```bash
git add packages/core/package.json
git commit -m "chore(core): run daemon at debug log level in dev mode"
```

---

## Task 4: Create Electron main process logger

**Files:**
- Create: `packages/desktop/src/main/logger.ts`

This logger uses `pino.multistream` (synchronous, no worker threads — required for reliable packaged Electron apps). It writes to a daily-named file in `~/.mainframe/logs/`. In dev mode, it also writes to stdout so logs appear in the terminal. It cleans up files older than 7 days on startup.

**Step 1: Create `packages/desktop/src/main/logger.ts`**

```ts
import pino from 'pino';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';

const LOG_DIR = join(homedir(), '.mainframe', 'logs');
const RETENTION_DAYS = 7;
const isDev = process.env.NODE_ENV !== 'production';

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
}

function purgeOldLogs(prefix: string): void {
  const cutoffMs = Date.now() - RETENTION_DAYS * 86_400_000;
  try {
    for (const file of readdirSync(LOG_DIR)) {
      if (!file.startsWith(`${prefix}.`)) continue;
      const full = join(LOG_DIR, file);
      try {
        if (statSync(full).mtimeMs < cutoffMs) unlinkSync(full);
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore if dir doesn't exist yet */ }
}

function dailyStream(prefix: string): NodeJS.WritableStream {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return createWriteStream(join(LOG_DIR, `${prefix}.${date}.log`), { flags: 'a' });
}

ensureLogDir();
purgeOldLogs('main');
purgeOldLogs('renderer');

const mainStreams: pino.StreamEntry[] = [{ stream: dailyStream('main') }];
if (isDev) mainStreams.push({ stream: process.stdout });

const rendererStreams: pino.StreamEntry[] = [{ stream: dailyStream('renderer') }];
if (isDev) rendererStreams.push({ stream: process.stdout });

const baseLogger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream(mainStreams),
);

const baseRendererLogger = pino(
  { level: 'debug' },
  pino.multistream(rendererStreams),
);

export function createMainLogger(module: string) {
  return baseLogger.child({ module });
}

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export function logFromRenderer(level: string, module: string, message: string, data?: unknown): void {
  const child = baseRendererLogger.child({ module });
  const lvl = VALID_LEVELS.has(level) ? (level as pino.Level) : 'info';
  if (data !== null && data !== undefined && typeof data === 'object') {
    child[lvl](data as Record<string, unknown>, message);
  } else {
    child[lvl](message);
  }
}
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop exec tsc --noEmit
```

Fix any type errors before proceeding.

**Step 3: Commit**

```bash
git add packages/desktop/src/main/logger.ts
git commit -m "feat(desktop): add Electron main process logger with daily file rotation"
```

---

## Task 5: Wire main logger into Electron main index

**Files:**
- Modify: `packages/desktop/src/main/index.ts`

Replace all `console.*` calls with the structured logger. Add the `ipcMain.on('log')` handler for renderer log forwarding.

**Step 1: Add imports at top of `packages/desktop/src/main/index.ts`**

Replace the existing import block's top (after the existing imports) to add:
```ts
import { createMainLogger, logFromRenderer } from './logger.js';

const log = createMainLogger('main');
```

**Step 2: Replace `console.log` in `startDaemon()`**

Change:
```ts
console.log('Development mode: assuming daemon is running');
```
to:
```ts
log.info('development mode: daemon assumed external');
```

Change:
```ts
console.log('[daemon] starting from:', daemonPath);
```
to:
```ts
log.info({ path: daemonPath }, 'daemon starting');
```

Change:
```ts
console.error('[daemon] exited with code:', code);
```
to:
```ts
log.error({ code }, 'daemon exited');
```

**Step 3: Replace `console.error/warn` in `setupIPC()`**

Change:
```ts
console.error('[ipc] Blocked file read outside allowed dirs:', normalizedPath);
```
to:
```ts
log.warn({ path: normalizedPath }, 'ipc blocked file read outside allowed paths');
```

Change:
```ts
console.warn('[ipc] readFile failed:', error);
```
to:
```ts
log.warn({ err: error }, 'ipc readFile failed');
```

**Step 4: Add renderer log IPC handler inside `setupIPC()`**

After the existing `ipcMain.handle` calls, add:
```ts
ipcMain.on('log', (_event, level: string, module: string, message: string, data?: unknown) => {
  logFromRenderer(level, module, message, data);
});
```

**Step 5: Add app lifecycle logs**

At the start of the `app.whenReady().then(...)` callback, add:
```ts
log.info({ version: app.getVersion() }, 'app ready');
```

At the end of `createWindow()`, after `mainWindow.loadFile(...)` / `mainWindow.loadURL(...)`, add:
```ts
log.info('window created');
```

**Step 6: Typecheck**

```bash
pnpm --filter @mainframe/desktop exec tsc --noEmit
```

Fix any errors.

**Step 7: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "feat(desktop): replace console.* with structured logger in Electron main"
```

---

## Task 6: Expose renderer log IPC in preload and types

**Files:**
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/types/global.d.ts`

**Step 1: Add `log` to `MainframeAPI` interface in `global.d.ts`**

Add the following to the `MainframeAPI` interface:
```ts
log: (level: string, module: string, message: string, data?: unknown) => void;
```

Full file after change:
```ts
export interface MainframeAPI {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  getAppInfo: () => Promise<{ version: string; author: string }>;
  openDirectoryDialog: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<string | null>;
  log: (level: string, module: string, message: string, data?: unknown) => void;
}

declare global {
  interface Window {
    mainframe: MainframeAPI;
  }
}
```

**Step 2: Add `log` to preload API object in `preload/index.ts`**

Add to the `api` object:
```ts
log: (level: string, module: string, message: string, data?: unknown) =>
  ipcRenderer.send('log', level, module, message, data),
```

Full updated `api` object:
```ts
const api: MainframeAPI = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  log: (level, module, message, data) => ipcRenderer.send('log', level, module, message, data),
};
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/desktop/src/preload/index.ts packages/desktop/src/renderer/types/global.d.ts
git commit -m "feat(desktop): expose log IPC bridge in preload"
```

---

## Task 7: Create renderer logger and test it

**Files:**
- Create: `packages/desktop/src/renderer/lib/logger.ts`
- Create: `packages/desktop/src/renderer/lib/logger.test.ts`

**Step 1: Write the failing test first**

Create `packages/desktop/src/renderer/lib/logger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  const mockLog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    (window as { mainframe?: unknown }).mainframe = { log: mockLog };
  });

  it('info forwards to console.log and IPC', () => {
    const log = createLogger('test-module');
    log.info('hello', { key: 'value' });
    expect(console.log).toHaveBeenCalledWith('[test-module]', 'hello', { key: 'value' });
    expect(mockLog).toHaveBeenCalledWith('info', 'test-module', 'hello', { key: 'value' });
  });

  it('warn forwards to console.warn and IPC', () => {
    const log = createLogger('test-module');
    log.warn('oops');
    expect(console.warn).toHaveBeenCalledWith('[test-module]', 'oops', '');
    expect(mockLog).toHaveBeenCalledWith('warn', 'test-module', 'oops', undefined);
  });

  it('error forwards to console.error and IPC', () => {
    const log = createLogger('test-module');
    log.error('failure', { err: 'details' });
    expect(console.error).toHaveBeenCalledWith('[test-module]', 'failure', { err: 'details' });
    expect(mockLog).toHaveBeenCalledWith('error', 'test-module', 'failure', { err: 'details' });
  });

  it('debug forwards to console.debug and IPC', () => {
    const log = createLogger('test-module');
    log.debug('verbose');
    expect(console.debug).toHaveBeenCalledWith('[test-module]', 'verbose', '');
    expect(mockLog).toHaveBeenCalledWith('debug', 'test-module', 'verbose', undefined);
  });

  it('does not throw when window.mainframe is absent', () => {
    (window as { mainframe?: unknown }).mainframe = undefined;
    const log = createLogger('test-module');
    expect(() => log.info('safe')).not.toThrow();
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose renderer/lib/logger
```

Expected: FAIL — `cannot find module './logger'`

**Step 3: Create `packages/desktop/src/renderer/lib/logger.ts`**

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ModuleLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function ipcLog(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  try {
    // window.mainframe may be absent in test/storybook environments
    (window as { mainframe?: { log?: (...args: unknown[]) => void } }).mainframe?.log?.(
      level,
      module,
      message,
      data,
    );
  } catch {
    /* IPC unavailable */
  }
}

export function createLogger(module: string): ModuleLogger {
  return {
    debug(message, data) {
      console.debug(`[${module}]`, message, data ?? '');
      ipcLog('debug', module, message, data);
    },
    info(message, data) {
      console.log(`[${module}]`, message, data ?? '');
      ipcLog('info', module, message, data);
    },
    warn(message, data) {
      console.warn(`[${module}]`, message, data ?? '');
      ipcLog('warn', module, message, data);
    },
    error(message, data) {
      console.error(`[${module}]`, message, data ?? '');
      ipcLog('error', module, message, data);
    },
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose renderer/lib/logger
```

Expected: all 5 tests pass.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/logger.ts packages/desktop/src/renderer/lib/logger.test.ts
git commit -m "feat(desktop): add renderer logger with IPC bridge to file"
```

---

## Task 8: Add INFO logs for daemon user actions

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts`
- Modify: `packages/core/src/chat/chat-manager.ts`
- Modify: `packages/core/src/server/routes/projects.ts`

Add INFO-level log lines at the start of each listed method. These record user-initiated events: creating/starting/archiving chats, sending messages, removing projects, and project CRUD.

**Step 1: `packages/core/src/chat/lifecycle-manager.ts`**

The file already has `const log = createChildLogger('chat-lifecycle')`.

In `createChat()`, after `const chat = this.deps.db.chats.create(...)`, add:
```ts
log.info({ chatId: chat.id, projectId, adapterId }, 'chat created');
```

In `doStartChat()`, after `const process = await adapter.spawn(...)`, add:
```ts
log.info({ chatId }, 'chat process started');
```

In `archiveChat()`, at the start of the method body (after the existing `const active = ...`), add:
```ts
log.info({ chatId }, 'chat archived');
```

**Step 2: `packages/core/src/chat/chat-manager.ts`**

The file already has `const logger = createChildLogger('chat-manager')`.

In `sendMessage()`, after the guard `if (!active?.process) throw new Error(...)`, add:
```ts
logger.info({ chatId }, 'user message sent');
```

In `removeProject()`, at the start of the method body, add:
```ts
logger.info({ projectId }, 'project removed');
```

**Step 3: `packages/core/src/server/routes/projects.ts`**

The file already has `const logger = createChildLogger('projects-route')`.

In the `POST /api/projects` handler, after `const project = ctx.db.projects.create(path, name)`, add:
```ts
logger.info({ projectId: project.id, path }, 'project added');
```

(Note: if the existing project path is taken, `ctx.db.projects.updateLastOpened` is called instead — no log needed there, not a new project.)

In the `DELETE /api/projects/:id` handler, after `await ctx.chats.removeProject(...)`, add:
```ts
logger.info({ projectId: param(req, 'id') }, 'project deleted');
```

**Step 4: Run core tests**

```bash
pnpm --filter @mainframe/core test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add packages/core/src/chat/lifecycle-manager.ts packages/core/src/chat/chat-manager.ts packages/core/src/server/routes/projects.ts
git commit -m "feat(core): add INFO logs for user actions in daemon"
```

---

## Task 9: Add DEBUG logs for daemon internals

**Files:**
- Modify: `packages/core/src/adapters/claude.ts`
- Modify: `packages/core/src/chat/event-handler.ts`
- Modify: `packages/core/src/server/websocket.ts`

These log internal mechanics at DEBUG level — only visible when `LOG_LEVEL=debug` (automatic in dev via the dev script change from Task 3).

**Step 1: `packages/core/src/adapters/claude.ts`**

The file already has `const log = createChildLogger('claude-adapter')`.

In `spawn()`, after `this.processes.set(processId, adapterProcess)`, add:
```ts
log.debug(
  {
    processId,
    projectPath: options.projectPath,
    resume: !!options.chatId,
    model: options.model ?? 'default',
    permissionMode: options.permissionMode ?? 'default',
  },
  'claude process spawned',
);
```

In `kill()`, inside the `if (cp)` block before `cp.child.kill(...)`, add:
```ts
log.debug({ processId: process.id }, 'claude process killed');
```

**Step 2: `packages/core/src/chat/event-handler.ts`**

The file already has `const log = createChildLogger('event-handler')`.

In the `claude.on('message', ...)` handler, after `const chatId = this.lookup.getChatIdForProcess(processId)` and the `if (!chatId) return` guard, add:
```ts
log.debug({ chatId, blockCount: content.length }, 'assistant message received');
```

In the `claude.on('exit', ...)` handler, after `const chatId = ...` and the guard, add:
```ts
log.debug({ processId, chatId }, 'process exited');
```

**Step 3: `packages/core/src/server/websocket.ts`**

The file already has `const log = createChildLogger('ws')`.

In `broadcastEvent()`, at the top of the method before the `for` loop, add:
```ts
log.debug({ type: event.type, chatId: 'chatId' in event ? event.chatId : undefined }, 'broadcasting event');
```

**Step 4: Run core tests**

```bash
pnpm --filter @mainframe/core test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude.ts packages/core/src/chat/event-handler.ts packages/core/src/server/websocket.ts
git commit -m "feat(core): add DEBUG logs for adapter process and WS internals"
```

---

## Task 10: Replace console.* with renderer logger in useDaemon.ts

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useDaemon.ts`

**Step 1: Import the renderer logger at the top**

Add after the existing imports:
```ts
import { createLogger } from '../lib/logger';

const log = createLogger('daemon');
```

**Step 2: Replace `console.log` calls in `handleEvent`**

Change:
```ts
console.log('[permission] received permission.requested', {
  chatId: event.chatId,
  requestId: event.request.requestId,
  toolName: event.request.toolName,
});
```
to:
```ts
log.info('permission.requested received', {
  chatId: event.chatId,
  requestId: event.request.requestId,
  toolName: event.request.toolName,
});
```

Change:
```ts
console.error('[daemon] received error event:', event.error);
```
to:
```ts
log.error('daemon error event', { error: event.error });
```

**Step 3: Replace `console.warn` in `loadData`**

Change:
```ts
console.warn('[useDaemon] adapter fetch failed:', err);
```
to:
```ts
log.warn('adapter fetch failed', { err: String(err) });
```

**Step 4: Replace `console.*` in `useChat`**

Change:
```ts
.catch((err) => console.warn('[useChat] message fetch failed:', err));
```
to:
```ts
.catch((err) => log.warn('message fetch failed', { err: String(err) }));
```

Change:
```ts
.catch((err) => console.warn('[useChat] permission fetch failed:', err));
```
to:
```ts
.catch((err) => log.warn('permission fetch failed', { err: String(err) }));
```

Change:
```ts
.catch((err) => console.warn('[useChat] reconnect message fetch failed:', err));
```
to:
```ts
.catch((err) => log.warn('reconnect message fetch failed', { err: String(err) }));
```

Change:
```ts
.catch((err) => console.warn('[useChat] reconnect permission fetch failed:', err));
```
to:
```ts
.catch((err) => log.warn('reconnect permission fetch failed', { err: String(err) }));
```

Change (in `respondToPermission`):
```ts
console.log('[permission] sending permission.respond', { ... });
```
to:
```ts
log.info('sending permission.respond', {
  chatId,
  requestId: pendingPermission.requestId,
  toolName: pendingPermission.toolName,
  behavior,
});
```

Change:
```ts
console.warn('[permission] respond appears lost (daemon still pending) — restoring popup for retry');
```
to:
```ts
log.warn('permission respond appears lost — restoring popup for retry');
```

Change:
```ts
.catch((err) => console.warn('[permission] verify check failed:', err));
```
to:
```ts
.catch((err) => log.warn('permission verify check failed', { err: String(err) }));
```

**Step 5: Run desktop tests**

```bash
pnpm --filter @mainframe/desktop test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useDaemon.ts
git commit -m "feat(desktop): replace console.* with structured renderer logger in useDaemon"
```

---

## Task 11: Final typecheck and verification

**Step 1: Typecheck all packages**

```bash
pnpm --filter @mainframe/core exec tsc --noEmit
pnpm --filter @mainframe/desktop exec tsc --noEmit
```

Expected: zero errors.

**Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

**Step 3: Smoke-test log files**

Start the daemon in dev mode:
```bash
pnpm --filter @mainframe/core dev
```

Check that a log file was created:
```bash
ls -la ~/.mainframe/logs/
```

Expected: `daemon.YYYY-MM-DD.log` exists and contains NDJSON lines.

**Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(logging): address typecheck errors from logging implementation"
```
