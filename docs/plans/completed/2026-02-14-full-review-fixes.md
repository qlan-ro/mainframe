# Full Code Review Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 95+ findings from the comprehensive code review (`.full-review/05-final-report.md`) across code quality, security, performance, testing, documentation, and DevOps.

**Architecture:** Organized into 8 phases by dependency order. Phase 1 fixes critical bugs, Phase 2 hardens error handling/security, Phase 3 improves code quality, Phase 4 adds security layers, Phase 5 targets performance, Phase 6 sets up CI/CD, Phase 7 adds test coverage, Phase 8 updates documentation. Each phase is independently committable.

**Tech Stack:** TypeScript, Node.js 20+, Express 4, Vitest, pnpm workspaces, Electron, React 18, Zustand 4

---

## Phase 1: Critical Bug Fixes (P0)

### Task 1: Fix `isChatRunning` logic bug (CQ-H1, BP-H2, TEST-C1)

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts:528-531`
- Create: `packages/core/src/__tests__/chat-manager-is-running.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/chat-manager-is-running.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManager } from '../chat/index.js';

describe('ChatManager.isChatRunning', () => {
  let manager: ChatManager;

  beforeEach(() => {
    const mockDb = {
      chats: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    } as any;
    const mockAdapters = { get: vi.fn() } as any;
    manager = new ChatManager(mockDb, mockAdapters);
  });

  it('returns false for non-existent chat', () => {
    expect(manager.isChatRunning('nonexistent')).toBe(false);
  });

  it('returns false for chat with null process', () => {
    // Create a chat via internal map (acceptable in test)
    (manager as any).activeChats.set('test-1', { chat: {} as any, process: null });
    expect(manager.isChatRunning('test-1')).toBe(false);
  });

  it('returns true for chat with active process', () => {
    (manager as any).activeChats.set('test-2', {
      chat: {} as any,
      process: { id: 'proc-1', adapterId: 'claude' },
    });
    expect(manager.isChatRunning('test-2')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/chat-manager-is-running.test.ts`
Expected: FAIL — first test returns `true` instead of `false`

**Step 3: Fix the bug**

In `packages/core/src/chat/chat-manager.ts`, change line 530 from:
```typescript
return active?.process !== null;
```
to:
```typescript
return active?.process != null;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/chat-manager-is-running.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add packages/core/src/chat/chat-manager.ts packages/core/src/__tests__/chat-manager-is-running.test.ts
git commit -m "fix: isChatRunning returns false for non-existent chats

undefined?.process !== null evaluated to true, making non-existent chats
appear as running. Changed to != null (loose equality) which correctly
returns false for both undefined and null.

Fixes: CQ-H1, BP-H2, TEST-C1"
```

---

### Task 2: Fix token accumulation bug (CQ-H2, BP-H3, TEST-C2)

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts:93-106`
- Create: `packages/core/src/__tests__/event-handler.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/event-handler.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler, type ChatLookup } from '../chat/event-handler.js';
import { MessageCache } from '../chat/message-cache.js';
import { PermissionManager } from '../chat/permission-manager.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { AdapterRegistry } from '../adapters/index.js';

function createMockLookup(): ChatLookup & { activeChats: Map<string, any> } {
  const activeChats = new Map<string, any>();
  const processToChat = new Map<string, string>();
  return {
    activeChats,
    getActiveChat: (chatId) => activeChats.get(chatId),
    getChatIdForProcess: (processId) => processToChat.get(processId),
    deleteProcessMapping: (processId) => processToChat.delete(processId),
  };
}

describe('EventHandler token accumulation', () => {
  let lookup: ReturnType<typeof createMockLookup>;
  let db: any;
  let adapters: AdapterRegistry;
  let messages: MessageCache;
  let permissions: PermissionManager;
  let emitEvent: ReturnType<typeof vi.fn>;
  let claude: ClaudeAdapter;

  beforeEach(() => {
    lookup = createMockLookup();
    db = {
      chats: { update: vi.fn(), get: vi.fn() },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    claude = new ClaudeAdapter(db);
    adapters = new AdapterRegistry();
    (adapters as any).adapters = new Map([['claude', claude]]);
    messages = new MessageCache();
    permissions = new PermissionManager(db, adapters);
    emitEvent = vi.fn();

    new EventHandler(lookup, db, adapters, messages, permissions, emitEvent).setup();
  });

  it('accumulates tokens across multiple result events', () => {
    // Set up active chat
    const processId = 'proc-1';
    const chatId = 'chat-1';
    (lookup as any).activeChats.set(chatId, {
      chat: {
        id: chatId,
        totalCost: 0,
        totalTokensInput: 100,
        totalTokensOutput: 50,
        processState: 'working',
      },
      process: { id: processId },
    });
    // Wire process -> chat mapping
    const processToChat = new Map([['proc-1', 'chat-1']]);
    (lookup as any).getChatIdForProcess = (pid: string) => processToChat.get(pid);

    // Emit first result
    claude.emit('result', processId, {
      cost: 0.01,
      tokensInput: 200,
      tokensOutput: 80,
      durationMs: 1000,
    });

    const chat = lookup.activeChats.get(chatId)!.chat;
    expect(chat.totalTokensInput).toBe(300);  // 100 + 200
    expect(chat.totalTokensOutput).toBe(130); // 50 + 80
    expect(chat.totalCost).toBeCloseTo(0.01);

    // Emit second result
    claude.emit('result', processId, {
      cost: 0.02,
      tokensInput: 150,
      tokensOutput: 60,
      durationMs: 800,
    });

    expect(chat.totalTokensInput).toBe(450);  // 300 + 150
    expect(chat.totalTokensOutput).toBe(190); // 130 + 60
    expect(chat.totalCost).toBeCloseTo(0.03);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/event-handler.test.ts`
Expected: FAIL — `totalTokensInput` is 200 (overwritten) not 300 (accumulated)

**Step 3: Fix the bug**

In `packages/core/src/chat/event-handler.ts`, change lines 94-95 from:
```typescript
      const newInput = data.tokensInput;
      const newOutput = data.tokensOutput;
```
to:
```typescript
      const newInput = active.chat.totalTokensInput + data.tokensInput;
      const newOutput = active.chat.totalTokensOutput + data.tokensOutput;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/event-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/chat/event-handler.ts packages/core/src/__tests__/event-handler.test.ts
git commit -m "fix: accumulate token counts instead of overwriting

totalTokensInput/Output were being set to the current turn's values
rather than accumulated. totalCost was correctly accumulated but tokens
were not. Now all three metrics accumulate properly.

Fixes: CQ-H2, BP-H3, TEST-C2"
```

---

### Task 3: Fix CORS vulnerability (SEC-C4, OPS-C5, TEST-C4)

**Files:**
- Modify: `packages/core/src/server/http.ts:27-36`
- Create: `packages/core/src/__tests__/cors.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/cors.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createHttpServer } from '../server/http.js';

function createMockContext() {
  return {
    db: { projects: { get: vi.fn() }, chats: { get: vi.fn() }, settings: { get: vi.fn() } } as any,
    chats: { on: vi.fn() } as any,
    adapters: { get: vi.fn() } as any,
  };
}

describe('CORS policy', () => {
  it('does not reflect arbitrary origins', async () => {
    const ctx = createMockContext();
    const app = createHttpServer(ctx.db, ctx.chats, ctx.adapters);

    // Simulate a request with a malicious origin
    const mockReq = {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.com' },
    } as any;

    const headers: Record<string, string> = {};
    const mockRes = {
      header: (key: string, value: string) => { headers[key] = value; },
      sendStatus: vi.fn(),
    } as any;
    const next = vi.fn();

    // Get the CORS middleware (first use handler)
    const stack = (app as any)._router?.stack;
    // Find first middleware layer
    const corsLayer = stack?.find((l: any) => l.name === '<anonymous>' || l.handle?.length === 3);
    if (corsLayer) {
      corsLayer.handle(mockReq, mockRes, next);
    }

    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://evil.com');
    expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/cors.test.ts`
Expected: FAIL — currently reflects `https://evil.com`

**Step 3: Fix the CORS middleware**

In `packages/core/src/server/http.ts`, replace the CORS middleware block (lines 27-36):

```typescript
  const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:31415',
    'http://127.0.0.1:31415',
  ]);

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('X-Content-Type-Options', 'nosniff');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/cors.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add packages/core/src/server/http.ts packages/core/src/__tests__/cors.test.ts
git commit -m "fix: restrict CORS to known origins instead of reflecting any

Reflective CORS (origin || '*') enabled DNS rebinding attacks where any
website could make API calls to the daemon through the victim's browser.
Now only known localhost origins are allowed. Also adds X-Content-Type-Options header.

Fixes: SEC-C4, OPS-C5, SEC-L5"
```

---

### Task 4: Fix path traversal in file search/list routes (SEC-C1, CQ-C2, TEST-C3)

**Files:**
- Modify: `packages/core/src/server/routes/files.ts:40-89, 92-119`

**Step 1: Extract IGNORED_DIRS constant (also fixes CQ-M3)**

At the top of `packages/core/src/server/routes/files.ts`, after imports, add:

```typescript
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out',
  '.cache', '__pycache__', '.venv', 'vendor', 'coverage', '.turbo',
]);
```

Remove the duplicate `ignoreDirs` declarations inside both handlers. Replace `ignoreDirs` with `IGNORED_DIRS` in both.

**Step 2: Add realpathSync containment to search route**

In the search handler (line 40 area), after `const basePath = ...`, add:

```typescript
    let realBase: string;
    try {
      realBase = realpathSync(basePath);
    } catch {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
```

Then in the `walk` function, after computing `const rel = ...`, add containment check:

```typescript
        try {
          const fullPath = realpathSync(path.join(dir, entry.name));
          if (!fullPath.startsWith(realBase)) continue;
        } catch {
          continue;
        }
```

**Step 3: Add realpathSync containment to files-list route**

Same pattern for the files-list handler. After `const basePath = ...`, add:

```typescript
    let realBase: string;
    try {
      realBase = realpathSync(basePath);
    } catch {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
```

In the `walk` function, add containment check after constructing the full path.

**Step 4: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/core/src/server/routes/files.ts
git commit -m "fix: add path traversal protection to search/files-list routes

The search and files-list endpoints did not validate that resolved paths
stayed within the project boundary via realpathSync, unlike the tree and
file-content routes which did. Also extracts IGNORED_DIRS to module constant.

Fixes: SEC-C1, CQ-C2, CQ-M3"
```

---

### Task 5: Fix path traversal in git diff route (SEC-H1)

**Files:**
- Modify: `packages/core/src/server/routes/git.ts:42-79`

**Step 1: Add realpathSync containment**

In the diff route handler, add `realpathSync` import (already available via `fs`). Before reading the file at line 58 (`fs.readFileSync(path.resolve(basePath, file), 'utf-8')`), add:

```typescript
        const realBase = realpathSync(basePath);
        const resolvedFile = realpathSync(path.resolve(basePath, file));
        if (!resolvedFile.startsWith(realBase)) {
          res.status(403).json({ error: 'Path outside project' });
          return;
        }
```

Add the same check for the `session` source branch (line 72 area).

Also add `import { realpathSync } from 'node:fs';` to imports.

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/server/routes/git.ts
git commit -m "fix: add path traversal protection to git diff route

The file parameter in diff routes was used in readFileSync without
verifying containment within the project boundary.

Fixes: SEC-H1"
```

---

### Task 6: Fix error leaking and add asyncHandler (CQ-C1, SEC-H3, SEC-H6)

**Files:**
- Create: `packages/core/src/server/routes/async-handler.ts`
- Modify: `packages/core/src/server/routes/skills.ts`
- Modify: `packages/core/src/server/routes/agents.ts`
- Modify: `packages/core/src/server/http.ts`

**Step 1: Create asyncHandler wrapper**

```typescript
// packages/core/src/server/routes/async-handler.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
```

**Step 2: Add error middleware to http.ts**

At the end of `createHttpServer` in `packages/core/src/server/http.ts`, before `return app;`, add:

```typescript
  // Error middleware — must be after all routes
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[http] Unhandled route error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
```

**Step 3: Wrap async routes in skills.ts and agents.ts**

Import `asyncHandler` at the top of both files:
```typescript
import { asyncHandler } from './async-handler.js';
```

Wrap all `async (req, res)` handlers with `asyncHandler(...)`. For example in `skills.ts`:
```typescript
  router.get('/api/adapters/:adapterId/skills', asyncHandler(async (req: Request, res: Response) => {
    // ... existing handler body ...
  }));
```

Also replace `(err as Error).message` in catch blocks with a generic message:
```typescript
    } catch {
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
```

**Step 4: Also wrap async handlers in chats.ts, adapters.ts, context.ts routes**

Apply the same `asyncHandler` wrapping to any other routes that have `async` handlers.

**Step 5: Export asyncHandler from routes barrel**

Add to `packages/core/src/server/routes/index.ts`:
```typescript
export { asyncHandler } from './async-handler.js';
```

**Step 6: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/core/src/server/routes/async-handler.ts packages/core/src/server/routes/index.ts packages/core/src/server/routes/skills.ts packages/core/src/server/routes/agents.ts packages/core/src/server/http.ts
git commit -m "fix: add asyncHandler wrapper and centralized error middleware

Express 4 does not catch rejected promises from async handlers, causing
unhandled rejections that crash the process. Also stops leaking internal
error messages to clients.

Fixes: CQ-C1, SEC-H3, SEC-H6, AR-M2"
```

---

## Phase 2: Safety & Type Hardening

### Task 7: Fix non-null assertions in plan-mode-handler.ts (CQ-H3, TEST-H4)

**Files:**
- Modify: `packages/core/src/chat/plan-mode-handler.ts:39-77`

**Step 1: Add null guard to handleClearContext**

Replace lines 50-61 in `handleClearContext`:

```typescript
    const adapter = this.ctx.adapters.get(active.chat.adapterId);

    if (!active.process) {
      // Process already gone — skip kill, just reset state
      this.ctx.permissions.shift(chatId);
    } else {
      await adapter?.respondToPermission(active.process, {
        ...response,
        behavior: 'deny',
        message: 'User chose to clear context and start a new session.',
      });

      this.ctx.permissions.shift(chatId);

      await adapter?.kill(active.process);
      active.process = null;
    }
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/chat/plan-mode-handler.ts
git commit -m "fix: add null guard for process in plan-mode-handler

Replace unsafe active.process! non-null assertions with explicit null
check. Prevents crash if process exits between caller check and execution.

Fixes: CQ-H3, BP-M4"
```

---

### Task 8: Fix non-null assertions in chat-manager.ts (CQ-H4)

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts:288-314`

**Step 1: Replace unsafe assertions in doStartChat**

Replace lines 297-311:

```typescript
    const active = this.activeChats.get(chatId);
    if (!active) throw new Error(`Chat ${chatId} not found after load`);

    if (active.process) {
      this.emitEvent({ type: 'process.started', chatId, process: active.process });
      return;
    }

    const { chat } = active;
    const adapter = this.adapters.get(chat.adapterId);
    if (!adapter) throw new Error(`Adapter ${chat.adapterId} not found`);

    const project = this.db.projects.get(chat.projectId);
    if (!project) throw new Error(`Project ${chat.projectId} not found`);

    const process = await adapter.spawn({
      projectPath: chat.worktreePath ?? project.path,
      chatId: chat.claudeSessionId,
      model: chat.model,
      permissionMode: chat.permissionMode,
    });

    const postSpawn = this.activeChats.get(chatId);
    if (!postSpawn) throw new Error(`Chat ${chatId} disappeared during spawn`);
    postSpawn.process = process;
    this.processToChat.set(process.id, chatId);
    this.emitEvent({ type: 'process.started', chatId, process });
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/chat/chat-manager.ts
git commit -m "fix: replace non-null assertions with explicit guards in doStartChat

activeChats.get(chatId)! could crash if a concurrent archiveChat removed
the entry between loadChat and the assertion. Now throws descriptive errors.

Fixes: CQ-H4, BP-M4"
```

---

### Task 9: Fix ClaudeEventEmitter typing (CQ-H5, BP-H1)

**Files:**
- Modify: `packages/core/src/adapters/claude-types.ts:10-12`
- Modify: `packages/core/src/adapters/claude-events.ts:3,6,25,32`

**Step 1: Replace loose ClaudeEventEmitter with typed Pick**

In `packages/core/src/adapters/claude-types.ts`, replace the `ClaudeEventEmitter` interface:

```typescript
import type { BaseAdapter, AdapterEvents } from './base.js';

export interface ClaudeProcess extends AdapterProcess {
  child: ChildProcess;
  buffer: string;
  lastAssistantUsage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

export type ClaudeEventEmitter = Pick<BaseAdapter, 'emit'>;
```

**Step 2: Update imports in claude-events.ts**

The import for `ClaudeEventEmitter` from `claude-types.ts` stays the same, but the type now delegates to `BaseAdapter`'s strongly-typed `emit`. If needed, adjust the import of `BaseAdapter` in `claude-types.ts`.

**Step 3: Verify build**

Run: `pnpm --filter @mainframe/core build`
Expected: No type errors

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude-types.ts packages/core/src/adapters/claude-events.ts
git commit -m "fix: replace loosely typed ClaudeEventEmitter with typed Pick

emit(event: string, ...args: unknown[]) bypassed TypeScript entirely.
Now uses Pick<BaseAdapter, 'emit'> which inherits the strongly-typed
AdapterEvents map. Typos in event names are caught at compile time.

Fixes: CQ-H5, BP-H1, AR-L3"
```

---

### Task 10: Extract shared ActiveChat type (CQ-M1)

**Files:**
- Create: `packages/core/src/chat/types.ts`
- Modify: `packages/core/src/chat/chat-manager.ts:16-19`
- Modify: `packages/core/src/chat/plan-mode-handler.ts:8-11`
- Modify: `packages/core/src/chat/index.ts`

**Step 1: Create shared type file**

```typescript
// packages/core/src/chat/types.ts
import type { Chat, AdapterProcess } from '@mainframe/types';

export interface ActiveChat {
  chat: Chat;
  process: AdapterProcess | null;
}
```

**Step 2: Update imports**

In `chat-manager.ts`, remove the local `ActiveChat` interface and import from `./types.js`.
In `plan-mode-handler.ts`, remove the local `ActiveChat` interface and import from `./types.js`.
In `event-handler.ts`, update `ChatLookup` to reference the shared type:
```typescript
import type { ActiveChat } from './types.js';
```

**Step 3: Re-export from barrel**

Add to `packages/core/src/chat/index.ts`:
```typescript
export type { ActiveChat } from './types.js';
```

**Step 4: Build & test**

Run: `pnpm --filter @mainframe/core build && pnpm --filter @mainframe/core test`
Expected: Pass

**Step 5: Commit**

```bash
git add packages/core/src/chat/types.ts packages/core/src/chat/chat-manager.ts packages/core/src/chat/plan-mode-handler.ts packages/core/src/chat/event-handler.ts packages/core/src/chat/index.ts
git commit -m "refactor: extract shared ActiveChat type to chat/types.ts

Same interface was defined in 3 files. Now imported from single source.

Fixes: CQ-M1"
```

---

### Task 11: Fix WebSocket message validation (SEC-H4)

**Files:**
- Modify: `packages/core/src/server/websocket.ts:25-31`

**Step 1: Add runtime validation**

Replace the message handler in `websocket.ts`:

```typescript
      ws.on('message', async (data) => {
        try {
          const raw = JSON.parse(data.toString());
          if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
            this.sendError(ws, 'Invalid message format');
            return;
          }
          const event = raw as ClientEvent;
          await this.handleClientEvent(client, event);
        } catch (err) {
          const message = err instanceof SyntaxError
            ? 'Invalid JSON'
            : 'Internal error';
          this.sendError(ws, message);
        }
      });
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/server/websocket.ts
git commit -m "fix: validate WebSocket messages before casting to ClientEvent

Messages were cast to ClientEvent without any field validation. Malformed
messages could cause unexpected behavior. Now validates type field exists
and is a string, and separates parse errors from handler errors.

Fixes: SEC-H4, BP-M8"
```

---

### Task 12: Fix IPC path validation (SEC-C2, BP-C2)

**Files:**
- Modify: `packages/desktop/src/main/index.ts:46-52`

**Step 1: Add path validation to fs:readFile handler**

Replace the `fs:readFile` IPC handler:

```typescript
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    // Only allow reading from known safe directories
    const normalizedPath = require('path').resolve(filePath);
    const home = require('os').homedir();
    const allowedPrefixes = [
      require('path').join(home, '.claude'),
      require('path').join(home, '.mainframe'),
    ];

    const isAllowed = allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
    if (!isAllowed) {
      console.error('[ipc] Blocked file read outside allowed dirs:', normalizedPath);
      return null;
    }

    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });
```

**Step 2: Verify desktop builds**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/desktop/src/main/index.ts
git commit -m "fix: validate IPC file read paths against allowlist

The fs:readFile IPC handler read any path the OS allowed. A compromised
renderer could read arbitrary files. Now restricted to .claude and
.mainframe directories.

Fixes: SEC-C2, BP-C2"
```

---

### Task 13: Fix handleStderr false positives (CQ-M4)

**Files:**
- Modify: `packages/core/src/adapters/claude-events.ts:25-30`

**Step 1: Filter known informational patterns**

Replace the `handleStderr` function:

```typescript
const INFORMATIONAL_PATTERNS = [
  /^Debugger/i,
  /^Warning:/i,
  /^DeprecationWarning/i,
  /^ExperimentalWarning/i,
  /^\(node:\d+\)/,
  /^Cloning into/,
];

export function handleStderr(processId: string, chunk: Buffer, emitter: ClaudeEventEmitter): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  emitter.emit('error', processId, new Error(message));
}
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/core/src/adapters/claude-events.ts
git commit -m "fix: filter informational stderr patterns before emitting errors

CLI tools commonly use stderr for warnings and debug messages. These were
being wrapped in Error and emitted as error events, generating false alerts.

Fixes: CQ-M4"
```

---

### Task 14: Remove dead wsPort config (BP-M3, DOC-C2)

**Files:**
- Modify: `packages/core/src/config.ts:6-9`

**Step 1: Remove wsPort**

In `config.ts`, remove `wsPort` from the interface and default config:

```typescript
export interface MainframeConfig {
  port: number;
  dataDir: string;
}

const DEFAULT_CONFIG: MainframeConfig = {
  port: 31415,
  dataDir: join(homedir(), '.mainframe'),
};
```

**Step 2: Verify build**

Run: `pnpm --filter @mainframe/core build`
Expected: No errors (wsPort is not referenced anywhere else)

**Step 3: Commit**

```bash
git add packages/core/src/config.ts
git commit -m "refactor: remove dead wsPort config field

WebSocket actually shares the HTTP port via WebSocketServer({ server }).
The wsPort config was unused dead code.

Fixes: BP-M3, DOC-C2 (partial)"
```

---

## Phase 3: Performance Fixes

### Task 15: Add file size limit to content endpoint (PERF-H2)

**Files:**
- Modify: `packages/core/src/server/routes/files.ts:122-140`

**Step 1: Add size check before reading**

In the file content handler, after the `realpathSync` containment check, add:

```typescript
      const stats = fs.statSync(fullPath);
      if (stats.size > 2 * 1024 * 1024) {
        res.status(413).json({ error: 'File too large (max 2MB)' });
        return;
      }
```

**Step 2: Run tests, commit**

```bash
git add packages/core/src/server/routes/files.ts
git commit -m "fix: add 2MB size limit to file content endpoint

readFileSync with no size check could load 50MB+ files into memory.
Returns 413 for files exceeding 2MB.

Fixes: PERF-H2"
```

---

### Task 16: Add MessageCache bounds (CQ-M5, PERF-C2, BP-M10)

**Files:**
- Modify: `packages/core/src/chat/message-cache.ts`

**Step 1: Add LRU-style eviction**

```typescript
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@mainframe/types';

const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_CHATS = 50;

export class MessageCache {
  private cache = new Map<string, ChatMessage[]>();

  get(chatId: string): ChatMessage[] | undefined {
    return this.cache.get(chatId);
  }

  set(chatId: string, messages: ChatMessage[]): void {
    this.cache.set(chatId, messages.slice(-MAX_MESSAGES_PER_CHAT));
    this.evictIfNeeded();
  }

  delete(chatId: string): void {
    this.cache.delete(chatId);
  }

  append(chatId: string, message: ChatMessage): void {
    const messages = this.cache.get(chatId) || [];
    messages.push(message);
    if (messages.length > MAX_MESSAGES_PER_CHAT) {
      messages.splice(0, messages.length - MAX_MESSAGES_PER_CHAT);
    }
    this.cache.set(chatId, messages);
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.cache.size > MAX_CHATS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  createTransientMessage(
    chatId: string,
    type: ChatMessage['type'],
    content: MessageContent[],
    metadata?: Record<string, unknown>,
  ): ChatMessage {
    return {
      id: nanoid(),
      chatId,
      type,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    };
  }
}
```

**Step 2: Run tests, commit**

```bash
git add packages/core/src/chat/message-cache.ts
git commit -m "fix: add bounds to MessageCache to prevent unbounded memory growth

Added MAX_MESSAGES_PER_CHAT (2000) and MAX_CHATS (50) limits with
eviction. Prevents memory pressure from long-running sessions.

Fixes: CQ-M5, PERF-C2, BP-M10"
```

---

### Task 17: Extract getSessionJsonlPath helper (CQ-M2)

**Files:**
- Modify: `packages/core/src/adapters/claude-history.ts`

**Step 1: Extract helper and replace 3 usages**

Add at the top of the file (after imports):

```typescript
function getSessionJsonlPath(sessionId: string, projectPath: string): string {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(homedir(), '.claude', 'projects', encodedPath);
  return path.join(projectDir, sessionId + '.jsonl');
}
```

Replace the triplicated logic in `loadHistory`, `extractPlanFilePaths`, and `extractSkillFilePaths` to use `getSessionJsonlPath(sessionId, projectPath)` and derive `projectDir` from `path.dirname(result)`.

**Step 2: Run tests, commit**

```bash
git add packages/core/src/adapters/claude-history.ts
git commit -m "refactor: extract getSessionJsonlPath helper to deduplicate

Same path encoding + directory resolution logic appeared in 3 functions.

Fixes: CQ-M2"
```

---

## Phase 4: Graceful Shutdown & Health Check

### Task 18: Add WebSocketManager.close() and fix shutdown (OPS-C3)

**Files:**
- Modify: `packages/core/src/server/websocket.ts`
- Modify: `packages/core/src/server/index.ts:37-45`

**Step 1: Add close method to WebSocketManager**

Add method to `WebSocketManager`:

```typescript
  close(): void {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, 'Server shutting down');
      }
    }
    this.clients.clear();
    this.wss.close();
  }
```

**Step 2: Update ServerManager.stop()**

In `packages/core/src/server/index.ts`, update the `stop` method:

```typescript
    async stop(): Promise<void> {
      _wsManager?.close();
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
```

**Step 3: Run tests, commit**

```bash
git add packages/core/src/server/websocket.ts packages/core/src/server/index.ts
git commit -m "fix: close WebSocket connections during graceful shutdown

server.stop() closed HTTP but left WebSocket connections hanging.
Added WebSocketManager.close() that terminates clients with code 1001.

Fixes: OPS-C3"
```

---

### Task 19: Add health check endpoint (OPS-H6)

**Files:**
- Modify: `packages/core/src/server/http.ts`

**Step 1: Add /health route**

In `createHttpServer`, before route registration, add:

```typescript
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
```

**Step 2: Run tests, commit**

```bash
git add packages/core/src/server/http.ts
git commit -m "feat: add /health endpoint

Simple health check that returns 200 with timestamp.

Fixes: OPS-H6"
```

---

## Phase 5: CI/CD & DevOps

### Task 20: Create GitHub Actions CI (OPS-C1)

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm build

      - name: Test
        run: pnpm test

      - name: Security audit
        run: pnpm audit --audit-level=high
        continue-on-error: true
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI pipeline

Build + test + type-check + security audit on push and PR.

Fixes: OPS-C1"
```

---

### Task 21: Add Dependabot (OPS-C2)

**Files:**
- Create: `.github/dependabot.yml`

**Step 1: Create Dependabot config**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      dependencies:
        patterns:
          - "*"
    open-pull-requests-limit: 10

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: add Dependabot for dependency scanning

Weekly checks for npm dependencies and GitHub Actions versions.

Fixes: OPS-C2"
```

---

### Task 22: Create .env.example (OPS-C4)

**Files:**
- Create: `.env.example`

**Step 1: Create env template**

```bash
# .env.example — copy to .env and fill in values
# None required for local development — all have defaults

# PORT=31415
# LOG_LEVEL=info
# NODE_ENV=development
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example template

Fixes: OPS-C4"
```

---

## Phase 6: Testing Coverage

### Task 23: Write PermissionManager unit tests (TEST-H3)

**Files:**
- Create: `packages/core/src/__tests__/permission-manager.test.ts`

**Step 1: Write tests**

```typescript
// packages/core/src/__tests__/permission-manager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionManager } from '../chat/permission-manager.js';
import type { PermissionRequest } from '@mainframe/types';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    input: {},
    suggestions: [],
    ...overrides,
  };
}

describe('PermissionManager', () => {
  let pm: PermissionManager;
  let db: any;

  beforeEach(() => {
    db = {
      chats: { get: vi.fn() },
      settings: { get: vi.fn() },
    };
    const adapters = { get: vi.fn() } as any;
    pm = new PermissionManager(db, adapters);
  });

  describe('enqueue/shift FIFO', () => {
    it('returns true for first enqueue (is frontmost)', () => {
      expect(pm.enqueue('c1', makeRequest({ requestId: 'r1' }))).toBe(true);
    });

    it('returns false for subsequent enqueues', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      expect(pm.enqueue('c1', makeRequest({ requestId: 'r2' }))).toBe(false);
    });

    it('shift returns next request in FIFO order', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r2' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r3' }));

      const next1 = pm.shift('c1');
      expect(next1?.requestId).toBe('r2');

      const next2 = pm.shift('c1');
      expect(next2?.requestId).toBe('r3');

      const next3 = pm.shift('c1');
      expect(next3).toBeUndefined();
    });
  });

  describe('getPending', () => {
    it('returns null when no pending requests', () => {
      expect(pm.getPending('c1')).toBeNull();
    });

    it('returns first queued request', () => {
      pm.enqueue('c1', makeRequest({ requestId: 'r1' }));
      pm.enqueue('c1', makeRequest({ requestId: 'r2' }));
      expect(pm.getPending('c1')?.requestId).toBe('r1');
    });

    it('returns null in yolo mode', () => {
      db.chats.get.mockReturnValue({ permissionMode: 'yolo' });
      pm.enqueue('c1', makeRequest());
      expect(pm.getPending('c1')).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all pending for a chat', () => {
      pm.enqueue('c1', makeRequest());
      pm.enqueue('c1', makeRequest());
      pm.clear('c1');
      expect(pm.hasPending('c1')).toBe(false);
    });
  });

  describe('interrupted state', () => {
    it('markInterrupted and clearInterrupted work correctly', () => {
      pm.markInterrupted('c1');
      expect(pm.clearInterrupted('c1')).toBe(true);
      expect(pm.clearInterrupted('c1')).toBe(false);
    });
  });
});
```

**Step 2: Run tests**

Run: `pnpm --filter @mainframe/core test -- --run src/__tests__/permission-manager.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/permission-manager.test.ts
git commit -m "test: add PermissionManager unit tests

Tests FIFO ordering, yolo mode bypass, clear, interrupted state.

Fixes: TEST-H3"
```

---

### Task 24: Write MessageCache unit tests (TEST-M1)

**Files:**
- Create: `packages/core/src/__tests__/message-cache.test.ts`

**Step 1: Write tests**

```typescript
// packages/core/src/__tests__/message-cache.test.ts
import { describe, it, expect } from 'vitest';
import { MessageCache } from '../chat/message-cache.js';

describe('MessageCache', () => {
  it('append creates array if not exists', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'user', [{ type: 'text', text: 'hi' }]);
    cache.append('c1', msg);
    expect(cache.get('c1')).toHaveLength(1);
  });

  it('set and get work', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'user', [{ type: 'text', text: 'test' }]);
    cache.set('c1', [msg]);
    expect(cache.get('c1')?.[0].content[0]).toEqual({ type: 'text', text: 'test' });
  });

  it('delete removes chat messages', () => {
    const cache = new MessageCache();
    cache.set('c1', [cache.createTransientMessage('c1', 'user', [])]);
    cache.delete('c1');
    expect(cache.get('c1')).toBeUndefined();
  });

  it('enforces per-chat message limit', () => {
    const cache = new MessageCache();
    for (let i = 0; i < 2100; i++) {
      cache.append('c1', cache.createTransientMessage('c1', 'user', [{ type: 'text', text: `msg-${i}` }]));
    }
    const messages = cache.get('c1');
    expect(messages!.length).toBeLessThanOrEqual(2000);
  });

  it('createTransientMessage produces valid structure', () => {
    const cache = new MessageCache();
    const msg = cache.createTransientMessage('c1', 'assistant', [{ type: 'text', text: 'hello' }], { model: 'test' });
    expect(msg.chatId).toBe('c1');
    expect(msg.type).toBe('assistant');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeDefined();
    expect(msg.metadata).toEqual({ model: 'test' });
  });
});
```

**Step 2: Run tests, commit**

```bash
git add packages/core/src/__tests__/message-cache.test.ts
git commit -m "test: add MessageCache unit tests

Covers append, set, get, delete, per-chat limit, and transient message creation.

Fixes: TEST-M1"
```

---

### Task 25: Write claude-events parser tests (TEST-H2)

**Files:**
- Create: `packages/core/src/__tests__/claude-events.test.ts`

**Step 1: Write tests**

```typescript
// packages/core/src/__tests__/claude-events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleStdout, handleStderr } from '../adapters/claude-events.js';
import type { ClaudeProcess } from '../adapters/claude-types.js';

function createMockEmitter() {
  return { emit: vi.fn().mockReturnValue(true) };
}

function createProcess(overrides: Partial<ClaudeProcess> = {}): ClaudeProcess {
  return {
    id: 'p1',
    adapterId: 'claude',
    chatId: undefined,
    pid: 1234,
    status: 'ready',
    projectPath: '/tmp',
    model: 'test',
    child: {} as any,
    buffer: '',
    ...overrides,
  };
}

describe('handleStdout', () => {
  it('parses complete JSON lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    handleStdout('p1', Buffer.from(event + '\n'), processes, emitter as any);

    expect(emitter.emit).toHaveBeenCalledWith('init', 'p1', 's1', 'claude', []);
  });

  it('handles partial chunks by buffering', () => {
    const emitter = createMockEmitter();
    const cp = createProcess();
    const processes = new Map([['p1', cp]]);

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    const half1 = event.slice(0, 20);
    const half2 = event.slice(20) + '\n';

    handleStdout('p1', Buffer.from(half1), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();

    handleStdout('p1', Buffer.from(half2), processes, emitter as any);
    expect(emitter.emit).toHaveBeenCalledWith('init', 'p1', 's1', 'claude', []);
  });

  it('skips non-JSON lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    handleStdout('p1', Buffer.from('not json at all\n'), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('skips empty lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    handleStdout('p1', Buffer.from('\n\n\n'), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('handleStderr', () => {
  it('emits error for non-informational messages', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('Something went wrong\n'), emitter as any);
    expect(emitter.emit).toHaveBeenCalledWith('error', 'p1', expect.any(Error));
  });

  it('filters informational patterns', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('Warning: some deprecation\n'), emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('ignores empty stderr', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('   \n'), emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests, commit**

```bash
git add packages/core/src/__tests__/claude-events.test.ts
git commit -m "test: add claude-events parser tests

Tests handleStdout with complete lines, partial chunks, non-JSON, and
empty lines. Tests handleStderr filtering of informational patterns.

Fixes: TEST-H2"
```

---

## Phase 7: Documentation Fixes

### Task 26: Fix CLAUDE.md (DOC-C3, DOC-H1, DOC-L1)

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Fix broken link, port defaults, typo**

1. Change `docs/MAINFRAME-DESIGN.md` to `docs/ARCHITECTURE.md`
2. Change `PORT` default from `3100` to `31415`
3. Remove `WS_PORT` line (dead config, see Task 14)
4. Fix "Cloude Code Protocol references" → "Claude Code Protocol references"

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fix CLAUDE.md broken link, port defaults, and typo

- Link to docs/ARCHITECTURE.md (not nonexistent MAINFRAME-DESIGN.md)
- Port default is 31415 (not 3100)
- Removed WS_PORT (WebSocket shares HTTP port)
- Fixed 'Cloude' typo

Fixes: DOC-C3, DOC-H1, DOC-L1"
```

---

### Task 27: Update ARCHITECTURE.md (DOC-C1, DOC-H8)

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Replace directory tree with post-refactoring structure**

Replace the stale directory tree section with the actual post-refactoring structure:

```
packages/core/src/
├── adapters/
│   ├── base.ts              # BaseAdapter abstract class
│   ├── claude.ts             # ClaudeAdapter implementation
│   ├── claude-events.ts      # CLI stdout/stderr parser
│   ├── claude-history.ts     # JSONL history loader
│   ├── claude-skills.ts      # Skills/agents CRUD
│   ├── claude-types.ts       # ClaudeProcess, ClaudeEventEmitter
│   ├── registry.ts           # AdapterRegistry
│   └── index.ts              # Barrel export
├── attachment/
│   ├── attachment-processor.ts
│   ├── attachment-store.ts
│   └── index.ts
├── chat/
│   ├── chat-manager.ts       # Central orchestrator
│   ├── context-tracker.ts    # Mention/file tracking
│   ├── event-handler.ts      # Adapter event wiring
│   ├── message-cache.ts      # In-memory message store
│   ├── permission-manager.ts # Permission queue
│   ├── plan-mode-handler.ts  # ExitPlanMode state machine
│   ├── title-generator.ts    # AI title generation
│   ├── types.ts              # Shared types (ActiveChat)
│   └── index.ts
├── db/
│   ├── chats.ts
│   ├── database.ts
│   ├── projects.ts
│   ├── settings.ts
│   └── index.ts
├── server/
│   ├── http.ts               # Express app + CORS + error middleware
│   ├── websocket.ts          # WebSocketManager
│   ├── routes/
│   │   ├── adapters.ts
│   │   ├── agents.ts
│   │   ├── async-handler.ts
│   │   ├── attachments.ts
│   │   ├── chats.ts
│   │   ├── context.ts
│   │   ├── files.ts
│   │   ├── git.ts
│   │   ├── projects.ts
│   │   ├── settings.ts
│   │   ├── skills.ts
│   │   ├── types.ts
│   │   └── index.ts
│   └── index.ts
├── workspace/
│   ├── worktree.ts
│   └── index.ts
├── config.ts
└── index.ts
```

Also update the WebSocket port documentation to note it shares the HTTP port.

Update Mermaid diagrams to show `ChatManager` → `EventHandler`, `PermissionManager`, `PlanModeHandler` delegation.

**Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md to post-refactoring structure

Replace stale pre-refactoring directory tree. Update diagrams to show
ChatManager internal decomposition. Fix WebSocket port documentation.

Fixes: DOC-C1, DOC-H8, DOC-C2"
```

---

### Task 28: Update DEVELOPER-GUIDE.md (DOC-H2, DOC-H3)

**Files:**
- Modify: `docs/DEVELOPER-GUIDE.md`

**Step 1: Update file references and workflow guides**

1. Replace all `src/chat-manager.ts` references with `src/chat/chat-manager.ts`
2. Replace `http.ts` description with "10 route modules under `server/routes/`"
3. Update "Adding a New REST Endpoint" to reference `server/routes/<resource>.ts` pattern
4. Update "Adding a New WebSocket Event" to reference correct paths
5. Update port references from 3100/3101 to 31415

**Step 2: Commit**

```bash
git add docs/DEVELOPER-GUIDE.md
git commit -m "docs: update DEVELOPER-GUIDE.md file paths and workflows

All file references now match post-refactoring structure. Workflow guides
updated to reflect route module pattern.

Fixes: DOC-H2, DOC-H3"
```

---

### Task 29: Update CODE-AUDIT-REPORT.md and TECH-DEBT-REPORT.md (DOC-H4, DOC-H5)

**Files:**
- Modify: `docs/CODE-AUDIT-REPORT.md`
- Modify: `docs/TECH-DEBT-REPORT.md`

**Step 1: Add remediation status**

In `CODE-AUDIT-REPORT.md`, add a "Remediation Status" column to the findings table. Mark #6 (god class ChatManager), #7 (large claude.ts), #8 (large http.ts) as "Remediated in dchiulan/cleanup".

In `TECH-DEBT-REPORT.md`, mark god class findings as remediated with updated line counts.

**Step 2: Commit**

```bash
git add docs/CODE-AUDIT-REPORT.md docs/TECH-DEBT-REPORT.md
git commit -m "docs: mark resolved audit findings as remediated

God class findings for ChatManager, claude.ts, and http.ts are resolved
by the cleanup branch decomposition. Updated line counts and status.

Fixes: DOC-H4, DOC-H5"
```

---

### Task 30: Fix API-REFERENCE.md (DOC-C2 remaining)

**Files:**
- Modify: `docs/API-REFERENCE.md`

**Step 1: Fix WebSocket port documentation**

Replace any references to separate WebSocket port (31416) with documentation that WebSocket upgrades happen on the same HTTP port (31415). Add documentation for `planExecutionMode` in WebSocket events.

**Step 2: Commit**

```bash
git add docs/API-REFERENCE.md
git commit -m "docs: fix API-REFERENCE.md WebSocket port and add missing events

WebSocket shares HTTP port, not separate. Added planExecutionMode docs.

Fixes: DOC-C2 (remaining), DOC-M8"
```

---

## Phase 8: Remaining Medium/Low Items (Batched)

### Task 31: Remove debug console.error statements (CQ-M6, BP-M12)

**Files:**
- Modify: `packages/core/src/adapters/claude-events.ts:39`
- Modify: `packages/core/src/chat/event-handler.ts:68,81`
- Modify: `packages/core/src/chat/chat-manager.ts:390,407,437,441`
- Modify: `packages/core/src/chat/plan-mode-handler.ts:84`

**Step 1: Remove or downgrade debug logging**

Remove `console.error` calls that are purely debug logging (event tracing, permission debug). Keep only actual error logging. The verbose event logging on line 39 of `claude-events.ts` should be removed entirely.

For remaining `console.error` calls that are actual errors (e.g., title generation failure), leave them in place — they'll be migrated to structured logging in a future task.

**Step 2: Run tests, commit**

```bash
git add packages/core/src/adapters/claude-events.ts packages/core/src/chat/event-handler.ts packages/core/src/chat/chat-manager.ts packages/core/src/chat/plan-mode-handler.ts
git commit -m "refactor: remove debug console.error statements from production paths

Removed event tracing, permission debugging, and adapter event logging
that was left from development. Keeps only actual error logging.

Fixes: CQ-M6, BP-M12, SEC-M6"
```

---

### Task 32: Fix empty catch blocks (BP-M13)

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts` (lines with `catch { }` or `catch { /* */ }`)

**Step 1: Add meaningful handling or explicit comments**

For each empty catch block:
- If the catch is intentional (best-effort), add `catch { /* best-effort: failure is non-critical */ }`
- If the catch swallows real errors, add logging

Most empty catches in `chat-manager.ts` are intentional (best-effort history loading), so add the explicit comment to document intent.

**Step 2: Run tests, commit**

```bash
git add packages/core/src/chat/chat-manager.ts
git commit -m "refactor: document intentional empty catch blocks

Adds explicit comments to empty catch blocks that are intentionally
swallowing non-critical errors (best-effort history loading).

Fixes: BP-M13"
```

---

### Task 33: Fix remaining low-priority items (batch)

**Files:** Various

This task batches remaining low-priority fixes that are safe, quick one-liners:

1. **CQ-L5**: Add `alt` attributes to `ImageThumbs.tsx` images
2. **BP-L2**: Change `@ts-ignore` to `@ts-expect-error` in `CenterPanel.tsx`
3. **DOC-M1**: Add CONTRIBUTING.md link to CLAUDE.md
4. **DOC-L2**: Verify `pnpm dev` is defined in root `package.json` (it is)
5. **SEC-H5**: Add comment about debug port in `desktop/src/main/index.ts`

**Step 1: Apply all fixes**

Each is a 1-line change. Apply all.

**Step 2: Run tests, commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/messages/ImageThumbs.tsx packages/desktop/src/renderer/components/center/CenterPanel.tsx CLAUDE.md packages/desktop/src/main/index.ts
git commit -m "fix: batch low-priority fixes (accessibility, ts-expect-error, docs)

- Add alt text to ImageThumbs images (CQ-L5)
- Replace @ts-ignore with @ts-expect-error (BP-L2)
- Link CONTRIBUTING.md from CLAUDE.md (DOC-M1)
- Document debug port limitation (SEC-H5)

Fixes: CQ-L5, BP-L2, DOC-M1, SEC-H5"
```

---

## Deferred Items (tracked, not in this plan)

The following items are intentionally deferred to future plans due to scope/risk:

| ID | Finding | Reason |
|----|---------|--------|
| SEC-C3 | HTTP/WS authentication | Requires architectural design (token generation, IPC sharing, middleware chain). Separate plan. |
| PERF-C1, BP-C1 | Migrate sync FS to async | ~50 call sites. High risk of regression. Needs separate phase with per-route migration. |
| PERF-C3 | Process ready gate | Requires integration testing with real CLI. Separate plan. |
| PERF-H1 | AttachmentStore metadata/data separation | Schema change. Separate plan. |
| PERF-H3 | Cache JSONL session mappings | Optimization. Track in backlog. |
| PERF-H5, PERF-H6 | Zustand/groupMessages optimization | Desktop-specific. Separate plan with UI testing. |
| BP-H4, BP-H5 | Zustand re-render fixes | Desktop-specific. Combine with above. |
| TEST-H5 | Desktop test infrastructure | Large effort (vitest + testing-library + jsdom setup). Separate plan. |
| OPS-C6, OPS-C7 | Husky + ESLint + Prettier | Touches every file. Do after merge. |
| OPS-H1-H3 | Electron packaging/signing/updates | Production deployment concern. Future milestone. |
| OPS-H5 | Structured logging (pino) | Pervasive change. After merge. |
| OPS-H7 | Daemon ASAR path fix | Only matters in packaged app. Future. |
| BP-M1 | Dependency upgrades | Separate PR per major version bump. |
| DOC-H6 | ADR/Changelog | Write after merge. |
| DOC-H7 | Root README.md | Write after merge. |
| AR-M1 | Decouple EventHandler from ClaudeAdapter | Architectural change. Needs adapter interface redesign. |
| AR-M3 | Move token logic to ChatManager | Already partially fixed by Task 2. Full move deferred. |

---

## Verification

After all phases complete:

1. `pnpm build` — all packages compile
2. `pnpm test` — all tests pass
3. `pnpm --filter @mainframe/core test` — core tests pass
4. Verify no `console.error` debug logging in hot paths
5. Verify CORS rejects arbitrary origins
6. Verify path traversal is blocked in all file routes
7. Review git log for clean, atomic commits

---

## Summary

| Phase | Tasks | Findings Fixed | Effort |
|-------|-------|---------------|--------|
| 1: Critical Bugs | 1-6 | CQ-H1, CQ-H2, SEC-C1, SEC-C4, SEC-H1, CQ-C1, SEC-H3, SEC-H6, CQ-M3 | Small |
| 2: Safety & Types | 7-14 | CQ-H3, CQ-H4, CQ-H5, CQ-M1, SEC-H4, SEC-C2, CQ-M4, BP-M3 | Small-Medium |
| 3: Performance | 15-17 | PERF-H2, CQ-M5, PERF-C2, CQ-M2 | Small |
| 4: Shutdown & Health | 18-19 | OPS-C3, OPS-H6 | Small |
| 5: CI/CD | 20-22 | OPS-C1, OPS-C2, OPS-C4 | Small |
| 6: Testing | 23-25 | TEST-H3, TEST-M1, TEST-H2, TEST-C1-C4 | Medium |
| 7: Documentation | 26-30 | DOC-C1-C3, DOC-H1-H5, DOC-H8 | Medium |
| 8: Cleanup | 31-33 | CQ-M6, BP-M12, BP-M13, CQ-L5, BP-L2 + more | Small |
| **Total** | **33 tasks** | **~60 findings** | **~4-6 hours** |

Remaining ~35 findings are tracked in the Deferred Items table for future plans.
