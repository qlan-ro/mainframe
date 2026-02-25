# Comprehensive Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add flow integration tests, unit tests for uncovered modules, RTL component tests, and Playwright CT across both packages — turning the test suite into a regression shield.

**Architecture:** Three tiers: (1) Core integration flows using MockAdapter→EventHandler→WS→client, (2) Unit tests for pure functions and FS modules, (3) Desktop component tests with RTL + Playwright CT.

**Tech Stack:** Vitest, @testing-library/react (already installed), @testing-library/jest-dom (install), @playwright/experimental-ct-react (install), ws, node:http

**Branch:** `feat/comprehensive-testing`

---

## Preamble: Key Patterns

**Flow test pattern** (from `daemon-restart-messages.test.ts`):
```ts
class MockAdapter extends BaseAdapter {
  id = 'claude'; name = 'Mock';
  async isInstalled() { return true; }
  async getVersion() { return '1.0'; }
  async spawn(): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission() {}
  override async loadHistory() { return []; }
}

function createServerStack(adapter: MockAdapter) {
  const db = createMockDb();
  const registry = new AdapterRegistry();
  (registry as any).adapters = new Map();
  registry.register(adapter);
  const chats = new ChatManager(db as any, registry);
  const app = createHttpServer(db as any, chats, registry);
  const httpServer = createServer(app);
  new WebSocketManager(httpServer, chats);
  return { httpServer, chats, db };
}
```

WS client setup, resume, and event collection:
```ts
ws = await connectWs(port);
ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
await sleep(100); // wait for loadChat + startChat

const events: DaemonEvent[] = [];
ws.on('message', (data) => {
  events.push(JSON.parse(data.toString()) as DaemonEvent);
});
```

After `chat.resume` with `processState: 'working'`, `startChat` calls `adapter.spawn()` which returns `{ id: 'proc-1' }`, establishing `processToChat.get('proc-1') === 'test-chat'`. Adapter events emitted with `processId = 'proc-1'` then route to `chatId = 'test-chat'`.

**Route test pattern** (from `routes/skills.test.ts`):
```ts
function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find(
    (l: any) => l.route?.path === routePath && l.route?.methods[method]
  );
  return layer.route.stack[0].handle;
}
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
```

**RTL pattern** (components already have @testing-library/react installed):
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```

---

## Task 0: Remove CLI-dependent integration test

**Files:**
- Delete: `packages/core/src/__tests__/set-model-integration.test.ts`

**Step 1: Delete the file**
```bash
rm packages/core/src/__tests__/set-model-integration.test.ts
```

**Step 2: Verify tests still pass**
```bash
pnpm --filter @mainframe/core test
```
Expected: all remaining tests pass, no references to deleted file.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/set-model-integration.test.ts
git commit -m "test(core): remove CLI-dependent integration test"
```

---

## Task 1: send-message-flow integration test

**Files:**
- Create: `packages/core/src/__tests__/send-message-flow.test.ts`

Tests that the complete path works: adapter emits `message` + `result` → EventHandler processes → WebSocketManager broadcasts → WS client receives `message.added` then `chat.updated` with `processState: 'idle'`.

**Step 1: Write the test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type { AdapterProcess, PermissionResponse, SpawnOptions, DaemonEvent } from '@mainframe/types';

class MockAdapter extends BaseAdapter {
  id = 'claude'; name = 'Mock';
  async isInstalled() { return true; }
  async getVersion() { return '1.0'; }
  async spawn(_opts: SpawnOptions): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission(_p: AdapterProcess, _r: PermissionResponse) {}
  override async loadHistory() { return []; }
}

const TEST_CHAT = {
  id: 'test-chat', adapterId: 'claude', projectId: 'proj-1',
  status: 'active', claudeSessionId: 'session-1', processState: 'working',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0,
};
const TEST_PROJECT = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

function createMockDb() {
  const { vi } = await import('vitest');
  return {
    chats: {
      get: vi.fn().mockReturnValue(TEST_CHAT), create: vi.fn().mockReturnValue(TEST_CHAT),
      list: vi.fn().mockReturnValue([TEST_CHAT]), update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false), addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false), getMentions: vi.fn().mockReturnValue([]),
      getModifiedFilesList: vi.fn().mockReturnValue([]), getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]), addModifiedFile: vi.fn().mockReturnValue(false),
    },
    projects: { get: vi.fn().mockReturnValue(TEST_PROJECT), list: vi.fn().mockReturnValue([TEST_PROJECT]),
      getByPath: vi.fn().mockReturnValue(null), create: vi.fn(), remove: vi.fn(), updateLastOpened: vi.fn() },
    settings: { get: vi.fn().mockReturnValue(null), getByCategory: vi.fn().mockReturnValue({}) },
  };
}

function createStack(adapter: MockAdapter) {
  const db = createMockDb();
  const registry = new AdapterRegistry();
  (registry as any).adapters = new Map();
  registry.register(adapter);
  const chats = new ChatManager(db as any, registry);
  const app = createHttpServer(db as any, chats, registry);
  const httpServer = createServer(app);
  new WebSocketManager(httpServer, chats);
  return { httpServer, chats, db };
}

function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function collectEvents(ws: WebSocket, type: string): DaemonEvent[] {
  const collected: DaemonEvent[] = [];
  ws.on('message', (data) => {
    const e = JSON.parse(data.toString()) as DaemonEvent;
    if (e.type === type) collected.push(e);
  });
  return collected;
}

describe('send-message flow', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  it('emits message.added then chat.updated(idle) when adapter responds', async () => {
    const adapter = new MockAdapter();
    const { httpServer } = createStack(adapter);
    server = httpServer;
    const port = await startServer(server);

    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);

    const messageAdded: DaemonEvent[] = [];
    const chatUpdated: DaemonEvent[] = [];
    ws.on('message', (data) => {
      const e = JSON.parse(data.toString()) as DaemonEvent;
      if (e.type === 'message.added') messageAdded.push(e);
      if (e.type === 'chat.updated') chatUpdated.push(e);
    });

    // Simulate adapter responding with an assistant message
    adapter.emit('message', 'proc-1', [{ type: 'text', text: 'Hello from assistant!' }]);
    adapter.emit('result', 'proc-1', {
      subtype: 'success', cost: 0.001, tokensInput: 100, tokensOutput: 50,
      session_id: 'session-1', durationMs: 1000,
    });
    await sleep(100);

    // message.added was emitted with the assistant content
    const msgEvent = messageAdded.find((e) => {
      const msg = (e as any).message;
      return msg?.type === 'assistant' && msg?.content?.[0]?.text === 'Hello from assistant!';
    });
    expect(msgEvent).toBeDefined();

    // chat.updated with processState: 'idle'
    const idleEvent = chatUpdated.find((e) => (e as any).chat?.processState === 'idle');
    expect(idleEvent).toBeDefined();
  }, 10_000);
});
```

**Step 2: Run the test**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose send-message-flow
```
Expected: 1 test passes.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/send-message-flow.test.ts
git commit -m "test(core): add send-message flow integration test"
```

---

## Task 2: permission-flow integration test

**Files:**
- Create: `packages/core/src/__tests__/permission-flow.test.ts`

Tests: (1) AskUserQuestion → `permission.requested` emitted, (2) bash tool in yolo mode → auto-approved (no `permission.requested`), (3) AskUserQuestion in yolo mode → still emits `permission.requested`.

**Step 1: Write the test**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type { AdapterProcess, PermissionResponse, SpawnOptions, DaemonEvent, PermissionRequest } from '@mainframe/types';

class MockAdapter extends BaseAdapter {
  id = 'claude'; name = 'Mock';
  respondToPermissionSpy = vi.fn();

  async isInstalled() { return true; }
  async getVersion() { return '1.0'; }
  async spawn(_opts: SpawnOptions): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission(_p: AdapterProcess, r: PermissionResponse) {
    this.respondToPermissionSpy(r);
  }
  override async loadHistory() { return []; }
}

function makeChat(permissionMode: string) {
  return {
    id: 'test-chat', adapterId: 'claude', projectId: 'proj-1',
    status: 'active', claudeSessionId: 'session-1', processState: 'working',
    permissionMode,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0,
  };
}

function createMockDb(permissionMode = 'default') {
  const chat = makeChat(permissionMode);
  return {
    chats: {
      get: vi.fn().mockReturnValue(chat), create: vi.fn().mockReturnValue(chat),
      list: vi.fn().mockReturnValue([chat]), update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false), addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false), getMentions: vi.fn().mockReturnValue([]),
      getModifiedFilesList: vi.fn().mockReturnValue([]), getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]), addModifiedFile: vi.fn().mockReturnValue(false),
    },
    projects: {
      get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: '/tmp/test' }),
      list: vi.fn().mockReturnValue([]), getByPath: vi.fn().mockReturnValue(null),
      create: vi.fn(), remove: vi.fn(), updateLastOpened: vi.fn(),
    },
    settings: { get: vi.fn().mockReturnValue(null), getByCategory: vi.fn().mockReturnValue({}) },
  };
}

function createStack(adapter: MockAdapter, permissionMode = 'default') {
  const db = createMockDb(permissionMode);
  const registry = new AdapterRegistry();
  (registry as any).adapters = new Map();
  registry.register(adapter);
  const chats = new ChatManager(db as any, registry);
  const app = createHttpServer(db as any, chats, registry);
  const httpServer = createServer(app);
  new WebSocketManager(httpServer, chats);
  return { httpServer, chats, db };
}

function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}
function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function makePermissionRequest(toolName: string, overrides?: Partial<PermissionRequest>): PermissionRequest {
  return {
    requestId: 'req-1', toolName, toolUseId: 'tu-1',
    input: { command: 'echo hello' }, suggestions: [], ...overrides,
  };
}

describe('permission flow', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  async function setupAndResume(adapter: MockAdapter, permissionMode: string) {
    const { httpServer } = createStack(adapter, permissionMode);
    server = httpServer;
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const permissionEvents: DaemonEvent[] = [];
    ws.on('message', (data) => {
      const e = JSON.parse(data.toString()) as DaemonEvent;
      if (e.type === 'permission.requested') permissionEvents.push(e);
    });
    return permissionEvents;
  }

  it('emits permission.requested for AskUserQuestion in default mode', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'default');

    adapter.emit('permission', 'proc-1', makePermissionRequest('AskUserQuestion', {
      input: { questions: [{ question: 'Which approach?', header: 'Approach', options: [], multiSelect: false }] },
    }));
    await sleep(50);

    expect(events).toHaveLength(1);
    expect((events[0] as any).request.toolName).toBe('AskUserQuestion');
  }, 10_000);

  it('auto-approves bash tool in yolo mode (no permission.requested emitted)', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.emit('permission', 'proc-1', makePermissionRequest('Bash'));
    await sleep(50);

    expect(events).toHaveLength(0);
    expect(adapter.respondToPermissionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow' }),
    );
  }, 10_000);

  it('does NOT auto-approve AskUserQuestion in yolo mode', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.emit('permission', 'proc-1', makePermissionRequest('AskUserQuestion', {
      input: { questions: [] },
    }));
    await sleep(50);

    expect(events).toHaveLength(1);
    expect(adapter.respondToPermissionSpy).not.toHaveBeenCalled();
  }, 10_000);

  it('does NOT auto-approve ExitPlanMode in yolo mode', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.emit('permission', 'proc-1', makePermissionRequest('ExitPlanMode', {
      input: { plan: 'Step 1: ...' },
    }));
    await sleep(50);

    expect(events).toHaveLength(1);
    expect(adapter.respondToPermissionSpy).not.toHaveBeenCalled();
  }, 10_000);
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose permission-flow
```
Expected: 4 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/permission-flow.test.ts
git commit -m "test(core): add permission flow integration tests including yolo bypass regression"
```

---

## Task 3: file-edit-flow integration test

**Files:**
- Create: `packages/core/src/__tests__/file-edit-flow.test.ts`

Tests: tool_use Write event → addModifiedFile called → GET /diff?source=session returns file list.

**Step 1: Write the test**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type { AdapterProcess, PermissionResponse, SpawnOptions, DaemonEvent } from '@mainframe/types';

class MockAdapter extends BaseAdapter {
  id = 'claude'; name = 'Mock';
  async isInstalled() { return true; }
  async getVersion() { return '1.0'; }
  async spawn(): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill() {}
  async sendMessage() {}
  async respondToPermission(_p: AdapterProcess, _r: PermissionResponse) {}
  override async loadHistory() { return []; }
}

function createMockDbWithTracking() {
  const modifiedFiles: string[] = [];
  return {
    db: {
      chats: {
        get: vi.fn().mockReturnValue({
          id: 'test-chat', adapterId: 'claude', projectId: 'proj-1',
          status: 'active', claudeSessionId: 'session-1', processState: 'working',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0,
        }),
        create: vi.fn(), list: vi.fn().mockReturnValue([]), update: vi.fn(),
        addPlanFile: vi.fn().mockReturnValue(false), addSkillFile: vi.fn().mockReturnValue(false),
        addMention: vi.fn().mockReturnValue(false), getMentions: vi.fn().mockReturnValue([]),
        getModifiedFilesList: vi.fn(() => [...modifiedFiles]),
        getPlanFiles: vi.fn().mockReturnValue([]), getSkillFiles: vi.fn().mockReturnValue([]),
        addModifiedFile: vi.fn((chatId: string, filePath: string) => {
          if (!modifiedFiles.includes(filePath)) { modifiedFiles.push(filePath); return true; }
          return false;
        }),
      },
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: '/tmp/test' }),
        list: vi.fn().mockReturnValue([{ id: 'proj-1', name: 'Test', path: '/tmp/test' }]),
        getByPath: vi.fn().mockReturnValue(null), create: vi.fn(), remove: vi.fn(), updateLastOpened: vi.fn(),
      },
      settings: { get: vi.fn().mockReturnValue(null), getByCategory: vi.fn().mockReturnValue({}) },
    },
    modifiedFiles,
  };
}

function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}
function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('file-edit flow', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  it('tracks modified files when adapter emits Write tool_use, diff endpoint returns them', async () => {
    const adapter = new MockAdapter();
    const { db } = createMockDbWithTracking();

    const registry = new AdapterRegistry();
    (registry as any).adapters = new Map();
    registry.register(adapter);
    const chats = new ChatManager(db as any, registry);
    const app = createHttpServer(db as any, chats, registry);
    server = createServer(app);
    new WebSocketManager(server, chats);
    const port = await startServer(server);

    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);

    const contextUpdated: DaemonEvent[] = [];
    ws.on('message', (data) => {
      const e = JSON.parse(data.toString()) as DaemonEvent;
      if (e.type === 'context.updated') contextUpdated.push(e);
    });

    // Emit message with Write tool_use using relative path
    adapter.emit('message', 'proc-1', [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Write',
        input: { file_path: 'src/main.ts', content: 'export const x = 1;' },
      },
    ]);
    await sleep(50);

    // addModifiedFile was called
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('test-chat', 'src/main.ts');

    // context.updated was emitted
    expect(contextUpdated.length).toBeGreaterThanOrEqual(1);

    // GET /diff?source=session returns the modified file
    const res = await fetch(
      `http://127.0.0.1:${port}/api/projects/proj-1/diff?source=session&chatId=test-chat`,
    );
    const json = await res.json();
    expect(json.source).toBe('session');
    expect(json.files).toContain('src/main.ts');
  }, 10_000);
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose file-edit-flow
```
Expected: 1 test passes.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/file-edit-flow.test.ts
git commit -m "test(core): add file-edit flow integration test (diff view population)"
```

---

## Task 4: frontmatter unit tests

**Files:**
- Create: `packages/core/src/__tests__/frontmatter.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, buildFrontmatter } from '../adapters/frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns empty attributes and full content when no frontmatter', () => {
    const { attributes, body } = parseFrontmatter('Just a body.');
    expect(attributes).toEqual({});
    expect(body).toBe('Just a body.');
  });

  it('parses standard key-value frontmatter', () => {
    const input = '---\nname: My Skill\ndescription: Does things\n---\n\nBody here.';
    const { attributes, body } = parseFrontmatter(input);
    expect(attributes['name']).toBe('My Skill');
    expect(attributes['description']).toBe('Does things');
    expect(body).toBe('Body here.');
  });

  it('returns empty attributes if closing --- is missing', () => {
    const { attributes, body } = parseFrontmatter('---\nname: broken\n');
    expect(attributes).toEqual({});
    expect(body).toBe('---\nname: broken\n');
  });

  it('handles values with colons', () => {
    const { attributes } = parseFrontmatter('---\nurl: http://example.com\n---\n');
    expect(attributes['url']).toBe('http://example.com');
  });

  it('skips lines without colons', () => {
    const { attributes } = parseFrontmatter('---\nno-colon-line\nname: valid\n---\n');
    expect(attributes['name']).toBe('valid');
    expect(Object.keys(attributes)).toHaveLength(1);
  });

  it('trims whitespace from keys and values', () => {
    const { attributes } = parseFrontmatter('---\n  name :  My Skill  \n---\n');
    expect(attributes['name']).toBe('My Skill');
  });
});

describe('buildFrontmatter', () => {
  it('produces parseable output (round-trip)', () => {
    const attrs = { name: 'Test Skill', description: 'A description' };
    const body = 'The skill content.';
    const built = buildFrontmatter(attrs, body);
    const { attributes, body: parsedBody } = parseFrontmatter(built);
    expect(attributes).toEqual(attrs);
    expect(parsedBody).toBe(body);
  });

  it('handles empty attributes', () => {
    const built = buildFrontmatter({}, 'Body only.');
    const { attributes, body } = parseFrontmatter(built);
    expect(attributes).toEqual({});
    expect(body).toBe('Body only.');
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose frontmatter
```
Expected: 7 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/frontmatter.test.ts
git commit -m "test(core): add frontmatter parse/build unit tests"
```

---

## Task 5: context-tracker unit tests

**Files:**
- Create: `packages/core/src/__tests__/context-tracker.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  extractMentionsFromText,
  trackFileActivity,
  extractPlanFilePathFromText,
  extractLatestPlanFileFromMessages,
} from '../chat/context-tracker.js';
import type { ChatMessage, MessageContent } from '@mainframe/types';

function makeDb(addMentionReturn = true, addModifiedFileReturn = true) {
  return {
    chats: {
      addMention: vi.fn().mockReturnValue(addMentionReturn),
      addModifiedFile: vi.fn().mockReturnValue(addModifiedFileReturn),
      get: vi.fn().mockReturnValue({ projectId: 'proj-1' }),
    },
    projects: {
      get: vi.fn().mockReturnValue({ id: 'proj-1', path: '/project' }),
    },
  };
}

describe('extractMentionsFromText', () => {
  it('extracts file mentions with path separators', () => {
    const db = makeDb();
    const changed = extractMentionsFromText('chat-1', 'Please update @src/utils.ts', db as any);
    expect(changed).toBe(true);
    expect(db.chats.addMention).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      path: 'src/utils.ts',
      kind: 'file',
    }));
  });

  it('extracts file mentions with dots (file.ext)', () => {
    const db = makeDb();
    extractMentionsFromText('chat-1', 'Look at @README.md', db as any);
    expect(db.chats.addMention).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      path: 'README.md',
    }));
  });

  it('skips bare @words without slash or dot', () => {
    const db = makeDb();
    const changed = extractMentionsFromText('chat-1', 'hello @user goodbye', db as any);
    expect(changed).toBe(false);
    expect(db.chats.addMention).not.toHaveBeenCalled();
  });

  it('strips trailing punctuation from mention', () => {
    const db = makeDb();
    extractMentionsFromText('chat-1', 'See @src/file.ts.', db as any);
    expect(db.chats.addMention).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      path: 'src/file.ts',
    }));
  });

  it('returns false when db.addMention returns false (duplicate)', () => {
    const db = makeDb(false);
    const changed = extractMentionsFromText('chat-1', '@src/file.ts', db as any);
    expect(changed).toBe(false);
  });
});

describe('trackFileActivity', () => {
  it('tracks Write tool_use with relative path', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: 'src/main.ts' } },
    ];
    const changed = trackFileActivity('chat-1', content, db as any, '/project');
    expect(changed).toBe(true);
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'src/main.ts');
  });

  it('tracks Edit tool_use', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: 'lib/utils.ts' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'lib/utils.ts');
  });

  it('converts absolute path to relative', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/project/src/index.ts' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).toHaveBeenCalledWith('chat-1', 'src/index.ts');
  });

  it('skips paths that escape the project (../outside.ts)', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/etc/passwd' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
  });

  it('ignores non-Write/Edit tool blocks', () => {
    const db = makeDb();
    const content: MessageContent[] = [
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
    ];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
  });

  it('ignores non-tool_use blocks', () => {
    const db = makeDb();
    const content: MessageContent[] = [{ type: 'text', text: 'hello' }];
    trackFileActivity('chat-1', content, db as any, '/project');
    expect(db.chats.addModifiedFile).not.toHaveBeenCalled();
  });
});

describe('extractPlanFilePathFromText', () => {
  it('extracts "saved to:" pattern', () => {
    const text = 'Your plan has been saved to: /docs/plans/2026-01-01-feature.md';
    expect(extractPlanFilePathFromText(text)).toBe('/docs/plans/2026-01-01-feature.md');
  });

  it('extracts generic markdown path', () => {
    const text = 'See the plan at `/docs/plans/feature.md` for details.';
    expect(extractPlanFilePathFromText(text)).toBe('/docs/plans/feature.md');
  });

  it('returns null when no plan path present', () => {
    expect(extractPlanFilePathFromText('No plan here.')).toBeNull();
  });
});

describe('extractLatestPlanFileFromMessages', () => {
  function makeMsg(text: string): ChatMessage {
    return {
      id: 'm1', chatId: 'c1', type: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: new Date().toISOString(),
    };
  }

  it('returns path from latest message containing a plan path', () => {
    const messages = [
      makeMsg('No plan here.'),
      makeMsg('Your plan has been saved to: /docs/plans/feature.md'),
    ];
    expect(extractLatestPlanFileFromMessages(messages)).toBe('/docs/plans/feature.md');
  });

  it('returns null when no message has a plan path', () => {
    expect(extractLatestPlanFileFromMessages([makeMsg('hello')])).toBeNull();
  });

  it('prefers the most recent message', () => {
    const messages = [
      makeMsg('Your plan has been saved to: /docs/plans/old.md'),
      makeMsg('Your plan has been saved to: /docs/plans/new.md'),
    ];
    expect(extractLatestPlanFileFromMessages(messages)).toBe('/docs/plans/new.md');
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose context-tracker
```
Expected: 14 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/context-tracker.test.ts
git commit -m "test(core): add context-tracker unit tests (mentions, file tracking, plan path extraction)"
```

---

## Task 6: attachment-store unit tests

**Files:**
- Create: `packages/core/src/__tests__/attachment-store.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore } from '../attachment/attachment-store.js';

let baseDir: string;
let store: AttachmentStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'mf-attach-test-'));
  store = new AttachmentStore(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('AttachmentStore', () => {
  describe('save + get round-trip', () => {
    it('saves an image attachment and retrieves it by id', async () => {
      const [meta] = await store.save('chat-1', [{
        name: 'photo.png',
        mediaType: 'image/png',
        sizeBytes: 100,
        kind: 'image',
        data: Buffer.from('fake-image-data').toString('base64'),
      }]);

      expect(meta).toBeDefined();
      expect(meta!.name).toBe('photo.png');
      expect(meta!.kind).toBe('image');

      const retrieved = await store.get('chat-1', meta!.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('photo.png');
      expect(retrieved!.data).toBe(Buffer.from('fake-image-data').toString('base64'));
    });

    it('returns null for non-existent attachment', async () => {
      const result = await store.get('chat-1', 'nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array for unknown chat', async () => {
      expect(await store.list('unknown-chat')).toEqual([]);
    });

    it('lists all attachments for a chat', async () => {
      await store.save('chat-2', [
        { name: 'a.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image', data: '' },
        { name: 'b.png', mediaType: 'image/png', sizeBytes: 20, kind: 'image', data: '' },
      ]);
      const list = await store.list('chat-2');
      expect(list).toHaveLength(2);
      expect(list.map((a) => a.name)).toEqual(expect.arrayContaining(['a.png', 'b.png']));
    });
  });

  describe('deleteChat', () => {
    it('removes all attachments for the chat', async () => {
      await store.save('chat-3', [
        { name: 'c.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image', data: '' },
      ]);
      await store.deleteChat('chat-3');
      expect(await store.list('chat-3')).toEqual([]);
    });

    it('does not throw when chat directory does not exist', async () => {
      await expect(store.deleteChat('nonexistent-chat')).resolves.not.toThrow();
    });
  });

  describe('sanitizeFileName', () => {
    it('strips path traversal sequences', async () => {
      const [meta] = await store.save('chat-4', [{
        name: '../../etc/passwd',
        mediaType: 'text/plain',
        sizeBytes: 10,
        kind: 'file',
        data: Buffer.from('data').toString('base64'),
      }]);
      // materializedPath should not contain ../../
      expect(meta!.materializedPath).not.toContain('..');
      expect(meta!.materializedPath).toContain(baseDir);
    });

    it('handles empty name by falling back to attachment.bin', async () => {
      // Test via the public API — an empty-after-sanitize filename
      const [meta] = await store.save('chat-5', [{
        name: '???',
        mediaType: 'text/plain',
        sizeBytes: 5,
        kind: 'file',
        data: Buffer.from('hello').toString('base64'),
      }]);
      expect(meta!.materializedPath).toMatch(/attachment\.bin$/);
    });
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose attachment-store
```
Expected: 7 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/attachment-store.test.ts
git commit -m "test(core): add AttachmentStore unit tests including sanitizeFileName"
```

---

## Task 7: claude-skills unit tests

**Files:**
- Create: `packages/core/src/__tests__/claude-skills.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSkills, createSkill, updateSkill, deleteSkill, listAgents, createAgent, deleteAgent } from '../adapters/claude-skills.js';
import { parseFrontmatter } from '../adapters/frontmatter.js';

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'mf-skills-test-'));
  await mkdir(join(projectPath, '.claude', 'skills'), { recursive: true });
  await mkdir(join(projectPath, '.claude', 'agents'), { recursive: true });
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('returns empty array when no skills directory', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mf-empty-'));
    try {
      expect(await listSkills(empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('returns created skill in list', async () => {
    await createSkill(projectPath, {
      name: 'commit', displayName: 'Commit', description: 'Creates commits', scope: 'project', content: 'Make a commit.',
    });
    const skills = await listSkills(projectPath);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('commit');
    expect(skills[0]!.id).toBe('claude:project:commit');
    expect(skills[0]!.scope).toBe('project');
  });
});

describe('createSkill', () => {
  it('creates a SKILL.md with frontmatter', async () => {
    const skill = await createSkill(projectPath, {
      name: 'review', displayName: 'Code Review', description: 'Reviews code', scope: 'project', content: 'Review body.',
    });

    expect(skill.id).toBe('claude:project:review');
    expect(skill.filePath).toContain('SKILL.md');

    const raw = await readFile(skill.filePath, 'utf-8');
    const { attributes, body } = parseFrontmatter(raw);
    expect(attributes['name']).toBe('Code Review');
    expect(attributes['description']).toBe('Reviews code');
    expect(body).toContain('Review body.');
  });
});

describe('updateSkill', () => {
  it('updates SKILL.md content', async () => {
    const created = await createSkill(projectPath, {
      name: 'fix', displayName: 'Fix', description: 'Fixes bugs', scope: 'project', content: 'Old content.',
    });

    const newContent = '---\nname: Fix v2\ndescription: Fixes bugs better\n---\n\nNew content.';
    const updated = await updateSkill(created.id, projectPath, newContent);

    expect(updated.displayName).toBe('Fix v2');
    const raw = await readFile(created.filePath, 'utf-8');
    expect(raw).toBe(newContent);
  });

  it('throws when skill not found', async () => {
    await expect(updateSkill('claude:project:nonexistent', projectPath, 'content')).rejects.toThrow('Skill not found');
  });
});

describe('deleteSkill', () => {
  it('removes the skill directory', async () => {
    await createSkill(projectPath, {
      name: 'cleanup', displayName: 'Cleanup', description: '', scope: 'project', content: '',
    });

    await deleteSkill('claude:project:cleanup', projectPath);

    const skills = await listSkills(projectPath);
    expect(skills.find((s) => s.name === 'cleanup')).toBeUndefined();
  });

  it('throws when skill not found', async () => {
    await expect(deleteSkill('claude:project:ghost', projectPath)).rejects.toThrow('Skill not found');
  });
});

describe('agents', () => {
  it('create + list + delete round-trip', async () => {
    const agent = await createAgent(projectPath, {
      name: 'test-agent', description: 'A test agent', scope: 'project', content: 'Agent instructions.',
    });

    expect(agent.id).toBe('claude:project:agent:test-agent');

    const agents = await listAgents(projectPath);
    expect(agents.find((a) => a.name === 'test-agent')).toBeDefined();

    await deleteAgent(agent.id, projectPath);
    const afterDelete = await listAgents(projectPath);
    expect(afterDelete.find((a) => a.name === 'test-agent')).toBeUndefined();
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose claude-skills
```
Expected: 8 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/claude-skills.test.ts
git commit -m "test(core): add claude-skills FS CRUD unit tests"
```

---

## Task 8: plan-mode-handler unit tests

**Files:**
- Create: `packages/core/src/__tests__/plan-mode-handler.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanModeHandler, type PlanModeContext } from '../chat/plan-mode-handler.js';
import type { Chat, DaemonEvent, PermissionResponse } from '@mainframe/types';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1', adapterId: 'claude', projectId: 'proj-1', status: 'active',
    permissionMode: 'plan', processState: 'working',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0,
    ...overrides,
  };
}

function makeProcess() {
  return { id: 'proc-1', adapterId: 'claude', chatId: 'chat-1', pid: 0, status: 'ready' as const, projectPath: '/tmp', model: 'test' };
}

function makeContext(activeProcess = true): PlanModeContext & {
  emitEvent: ReturnType<typeof vi.fn>;
  startChat: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  adapter: { respondToPermission: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };
} {
  const chat = makeChat();
  const process = activeProcess ? makeProcess() : null;
  const adapter = {
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const activeChat = { chat, process };

  return {
    permissions: {
      getPlanExecutionMode: vi.fn().mockReturnValue(undefined),
      deletePlanExecutionMode: vi.fn(),
      shift: vi.fn(),
      enqueue: vi.fn(),
      hasPending: vi.fn(),
      clear: vi.fn(),
    } as any,
    messages: {
      get: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    } as any,
    db: {
      chats: { update: vi.fn(), addPlanFile: vi.fn().mockReturnValue(false) },
    } as any,
    adapters: {
      get: vi.fn().mockReturnValue(adapter),
    } as any,
    getActiveChat: vi.fn().mockReturnValue(activeChat),
    emitEvent: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    adapter,
  };
}

function makeResponse(overrides?: Partial<PermissionResponse>): PermissionResponse {
  return { requestId: 'req-1', toolUseId: 'tu-1', behavior: 'allow', updatedInput: {}, ...overrides };
}

describe('PlanModeHandler', () => {
  describe('handleNoProcess', () => {
    it('updates permissionMode when response specifies a new mode', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'yolo' }));

      expect(ctx.db.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ permissionMode: 'yolo' }));
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });

    it('does not emit chat.updated when mode is unchanged', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      active.chat.permissionMode = 'plan'; // same as response

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'plan' }));

      expect(ctx.emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });
  });

  describe('handleClearContext', () => {
    it('kills process, resets session, clears messages, starts new chat', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleClearContext('chat-1', active, makeResponse());

      expect(ctx.adapter.kill).toHaveBeenCalled();
      expect(ctx.db.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ claudeSessionId: undefined }));
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'messages.cleared', chatId: 'chat-1' }));
      expect(ctx.startChat).toHaveBeenCalledWith('chat-1');
    });

    it('sends follow-up message when plan is provided', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleClearContext('chat-1', active, makeResponse({
        updatedInput: { plan: 'Step 1: do the thing.' },
      }));

      expect(ctx.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('Step 1: do the thing.'));
    });

    it('works without an active process (process=null)', async () => {
      const ctx = makeContext(false);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await expect(handler.handleClearContext('chat-1', active, makeResponse())).resolves.not.toThrow();
      expect(ctx.startChat).toHaveBeenCalledWith('chat-1');
    });
  });

  describe('handleEscalation', () => {
    it('updates permissionMode and calls setPermissionMode on adapter', async () => {
      const mockProcess = makeProcess();
      const ctx = makeContext();
      const active = ctx.getActiveChat('chat-1')!;
      active.process = mockProcess;
      ctx.adapters.get = vi.fn().mockReturnValue({
        setPermissionMode: vi.fn().mockResolvedValue(undefined),
        ...ctx.adapter,
      });

      const handler = new PlanModeHandler(ctx);
      await handler.handleEscalation('chat-1', active, makeResponse({ executionMode: 'yolo' }));

      expect(ctx.db.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ permissionMode: 'yolo' }));
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose plan-mode-handler
```
Expected: 6 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/plan-mode-handler.test.ts
git commit -m "test(core): add PlanModeHandler unit tests"
```

---

## Task 9: routes/files.ts tests

**Files:**
- Create: `packages/core/src/__tests__/routes/files.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileRoutes } from '../../server/routes/files.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

let projectDir: string;

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  return res;
}

function createCtx(path: string): RouteContext {
  return {
    db: {
      projects: { get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path }) },
      chats: { list: vi.fn().mockReturnValue([]) },
      settings: { get: vi.fn().mockReturnValue(null) },
    } as any,
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find(
    (l: any) => l.route?.path === routePath && l.route?.methods[method],
  );
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mf-files-test-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('GET /api/projects/:id/tree', () => {
  it('returns file and directory entries', async () => {
    await mkdir(join(projectDir, 'src'));
    await writeFile(join(projectDir, 'README.md'), '# Hello');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'src', type: 'directory' }),
        expect.objectContaining({ name: 'README.md', type: 'file' }),
      ]),
    );
  });

  it('rejects path traversal with 403', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '../../etc' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('filters out node_modules from listing', async () => {
    await mkdir(join(projectDir, 'node_modules'));
    await mkdir(join(projectDir, 'src'));

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/tree');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '.' } }, res, vi.fn());
    await flushPromises();

    const entries = res.json.mock.calls[0][0] as Array<{ name: string }>;
    expect(entries.find((e) => e.name === 'node_modules')).toBeUndefined();
    expect(entries.find((e) => e.name === 'src')).toBeDefined();
  });
});

describe('GET /api/projects/:id/search/files', () => {
  it('returns empty array for empty query', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: '' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('finds files by name', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'main.ts'), '');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/search/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { q: 'main' } }, res, vi.fn());
    await flushPromises();

    const results = res.json.mock.calls[0][0] as Array<{ name: string }>;
    expect(results.some((r) => r.name === 'main.ts')).toBe(true);
  });
});

describe('GET /api/projects/:id/files', () => {
  it('returns file content', async () => {
    await writeFile(join(projectDir, 'hello.txt'), 'world');

    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: 'hello.txt' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: 'world' }));
  });

  it('rejects path traversal with 403', async () => {
    const ctx = createCtx(projectDir);
    const router = fileRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/files');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { path: '../../etc/passwd' } }, res, vi.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose "routes/files"
```
Expected: 6 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/routes/files.test.ts
git commit -m "test(core): add files route tests including path traversal security"
```

---

## Task 10: routes/git.ts tests

**Files:**
- Create: `packages/core/src/__tests__/routes/git.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { gitRoutes } from '../../server/routes/git.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

// Uses the actual monorepo as the git project so execGit calls real git
const REAL_GIT_PATH = new URL('../../../../..', import.meta.url).pathname;

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

function createCtx(projectPath: string): RouteContext {
  return {
    db: {
      projects: { get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: projectPath }) },
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null), getModifiedFilesList: vi.fn().mockReturnValue([]) },
      settings: { get: vi.fn().mockReturnValue(null) },
    } as any,
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find(
    (l: any) => l.route?.path === routePath && l.route?.methods[method],
  );
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

describe('GET /api/projects/:id/git/branch', () => {
  it('returns a branch name for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await flushPromises();

    const result = res.json.mock.calls[0][0] as { branch: string | null };
    expect(typeof result.branch).toBe('string');
    expect(result.branch!.length).toBeGreaterThan(0);
  });

  it('returns { branch: null } for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith({ branch: null });
  });
});

describe('GET /api/projects/:id/git/status', () => {
  it('returns files array for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await flushPromises();

    const result = res.json.mock.calls[0][0] as { files: unknown[] };
    expect(Array.isArray(result.files)).toBe(true);
  });

  it('returns { files: [], error } for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ files: [], error: expect.any(String) }));
  });
});

describe('GET /api/projects/:id/diff?source=session (no file)', () => {
  it('returns modified files list from DB', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    (ctx.db.chats as any).getModifiedFilesList = vi.fn().mockReturnValue(['src/main.ts', 'lib/utils.ts']);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/diff');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { source: 'session', chatId: 'chat-1' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith({
      files: ['src/main.ts', 'lib/utils.ts'],
      source: 'session',
    });
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/core test -- --reporter=verbose "routes/git"
```
Expected: 5 tests pass.

**Step 3: Commit**
```bash
git add packages/core/src/__tests__/routes/git.test.ts
git commit -m "test(core): add git routes tests (branch, status, session diff)"
```

---

## Task 11: Raise core coverage thresholds

**Files:**
- Modify: `packages/core/vitest.config.ts`

**Step 1: Update thresholds**

Replace the existing content with:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 60, branches: 50, functions: 55 },
    },
  },
});
```

**Step 2: Run with coverage to verify thresholds pass**
```bash
pnpm --filter @mainframe/core test -- --coverage
```
Expected: all thresholds met. If a threshold fails, check which module is dragging it down and either add a focused test or adjust the threshold by 5%.

**Step 3: Commit**
```bash
git add packages/core/vitest.config.ts
git commit -m "test(core): raise coverage thresholds to 60/50/55"
```

---

## Task 12: Desktop RTL setup

**Files:**
- Install: `@testing-library/jest-dom`
- Modify: `packages/desktop/vitest.config.ts`
- Modify: `packages/desktop/src/__tests__/setup.ts`
- Install: `@playwright/experimental-ct-react` (scoped install for later tasks)

**Step 1: Install jest-dom**
```bash
pnpm --filter @mainframe/desktop add -D @testing-library/jest-dom @types/testing-library__jest-dom
```

**Step 2: Update vitest.config.ts**
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/__tests__/**'],
      thresholds: { lines: 45, branches: 35 },
    },
  },
});
```

**Step 3: Update setup.ts** — add jest-dom import at the bottom of the existing file:
```ts
import '@testing-library/jest-dom';
```

**Step 4: Run existing tests to confirm nothing broke**
```bash
pnpm --filter @mainframe/desktop test
```
Expected: all existing tests pass.

**Step 5: Commit**
```bash
git add packages/desktop/vitest.config.ts packages/desktop/src/__tests__/setup.ts packages/desktop/package.json pnpm-lock.yaml
git commit -m "test(desktop): add RTL jest-dom setup and coverage thresholds"
```

---

## Task 13: PermissionCard RTL test

**Files:**
- Create: `packages/desktop/src/__tests__/components/PermissionCard.test.tsx`

**Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionCard } from '../../renderer/components/chat/PermissionCard.js';
import type { PermissionRequest } from '@mainframe/types';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    input: { command: 'ls -la' },
    suggestions: [],
    ...overrides,
  };
}

describe('PermissionCard', () => {
  it('renders the tool name', () => {
    render(<PermissionCard request={makeRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('renders "Permission Required" header', () => {
    render(<PermissionCard request={makeRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText('Permission Required')).toBeInTheDocument();
  });

  it('calls onRespond with "allow" when Allow Once is clicked', async () => {
    const onRespond = vi.fn();
    render(<PermissionCard request={makeRequest()} onRespond={onRespond} />);

    await userEvent.click(screen.getByRole('button', { name: /allow once/i }));

    expect(onRespond).toHaveBeenCalledWith('allow', undefined, undefined);
  });

  it('calls onRespond with "deny" when Deny is clicked', async () => {
    const onRespond = vi.fn();
    render(<PermissionCard request={makeRequest()} onRespond={onRespond} />);

    await userEvent.click(screen.getByRole('button', { name: /deny/i }));

    expect(onRespond).toHaveBeenCalledWith('deny');
  });

  it('shows Always Allow button when suggestions are present', () => {
    const request = makeRequest({
      suggestions: [{ toolName: 'Bash', behavior: 'allow' as const, type: 'always' as const }],
    });
    render(<PermissionCard request={request} onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: /always allow/i })).toBeInTheDocument();
  });

  it('does not show Always Allow button when no suggestions', () => {
    render(<PermissionCard request={makeRequest({ suggestions: [] })} onRespond={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /always allow/i })).toBeNull();
  });

  it('expands details on click', async () => {
    render(<PermissionCard request={makeRequest({ input: { command: 'ls -la' } })} onRespond={vi.fn()} />);

    await userEvent.click(screen.getByText('Details'));
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose PermissionCard
```
Expected: 7 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/__tests__/components/PermissionCard.test.tsx
git commit -m "test(desktop): add PermissionCard RTL tests"
```

---

## Task 14: AskUserQuestionCard RTL test (rewrite)

Replace the existing `createRoot`-based test with RTL. The existing file location: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts`

**Files:**
- Replace: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts` → rename to `AskUserQuestionCard.test.tsx`

**Step 1: Find the AskUserQuestionCard component import path**
The existing test imports from the same directory. The component is at `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.tsx` (or `.ts`).

**Step 2: Write the replacement test**

New file `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskUserQuestionCard } from './AskUserQuestionCard.js';
import type { PermissionRequest } from '@mainframe/types';

function makeRequest(questions: unknown[]): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu-1',
    input: { questions },
    suggestions: [],
  };
}

function makeSingleQuestion(overrides = {}) {
  return {
    question: 'Which approach do you prefer?',
    header: 'Approach',
    options: [
      { label: 'Option A', description: 'First option' },
      { label: 'Option B', description: 'Second option' },
    ],
    multiSelect: false,
    ...overrides,
  };
}

describe('AskUserQuestionCard', () => {
  it('renders the question text', () => {
    render(
      <AskUserQuestionCard
        request={makeRequest([makeSingleQuestion()])}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('Which approach do you prefer?')).toBeInTheDocument();
  });

  it('renders option labels', () => {
    render(
      <AskUserQuestionCard
        request={makeRequest([makeSingleQuestion()])}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('Submit button is disabled until an option is selected', () => {
    render(
      <AskUserQuestionCard
        request={makeRequest([makeSingleQuestion()])}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('enables Submit after selecting an option', async () => {
    render(
      <AskUserQuestionCard
        request={makeRequest([makeSingleQuestion()])}
        onRespond={vi.fn()}
      />
    );
    await userEvent.click(screen.getByText('Option A'));
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
  });

  it('calls onRespond with selected answer on submit', async () => {
    const onRespond = vi.fn();
    render(
      <AskUserQuestionCard
        request={makeRequest([makeSingleQuestion()])}
        onRespond={onRespond}
      />
    );
    await userEvent.click(screen.getByText('Option B'));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(onRespond).toHaveBeenCalledWith(
      'allow',
      undefined,
      expect.objectContaining({
        answers: expect.objectContaining({ 'Which approach do you prefer?': 'Option B' }),
      }),
    );
  });

  it('navigates between multiple questions', async () => {
    const questions = [
      makeSingleQuestion({ question: 'Q1?', options: [{ label: 'A', description: '' }] }),
      makeSingleQuestion({ question: 'Q2?', options: [{ label: 'B', description: '' }] }),
    ];
    render(
      <AskUserQuestionCard
        request={makeRequest(questions)}
        onRespond={vi.fn()}
      />
    );

    // First question visible
    expect(screen.getByText('Q1?')).toBeInTheDocument();

    // Select option and go to next
    await userEvent.click(screen.getByText('A'));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    // Second question visible
    expect(screen.getByText('Q2?')).toBeInTheDocument();
  });
});
```

**Step 3: Delete the old .ts test file, the new .tsx file replaces it**
```bash
rm packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts
```

**Step 4: Run**
```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose AskUserQuestionCard
```
Expected: 6+ tests pass.

**Step 5: Commit**
```bash
git add packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.tsx
git rm packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts
git commit -m "test(desktop): rewrite AskUserQuestionCard tests with RTL"
```

---

## Task 15: BashCard RTL test

**Files:**
- Create: `packages/desktop/src/__tests__/components/tools/BashCard.test.tsx`

**Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BashCard } from '../../../renderer/components/chat/assistant-ui/parts/tools/BashCard.js';

describe('BashCard', () => {
  it('renders the command in the header', () => {
    render(<BashCard args={{ command: 'git status' }} result={undefined} isError={undefined} />);
    expect(screen.getByText('git status')).toBeInTheDocument();
  });

  it('truncates long commands in the header', () => {
    const longCmd = 'a'.repeat(100);
    render(<BashCard args={{ command: longCmd }} result={undefined} isError={undefined} />);
    // Truncated at 80 chars + '...'
    expect(screen.getByText(longCmd.slice(0, 80) + '...')).toBeInTheDocument();
  });

  it('shows a pulsing dot when result is undefined (running)', () => {
    const { container } = render(
      <BashCard args={{ command: 'sleep 5' }} result={undefined} isError={undefined} />
    );
    // StatusDot renders a pulsing span when result is undefined
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows result output when result is provided', async () => {
    const { getByText } = render(
      <BashCard args={{ command: 'echo hi' }} result="hi\n" isError={false} />
    );
    // Click to expand
    const header = getByText('echo hi').closest('button') ?? getByText('echo hi');
    header.click();
    // result is shown in pre block after expanding
    expect(screen.queryByText(/hi/)).toBeTruthy();
  });

  it('accepts args.input as alternative to args.command', () => {
    render(<BashCard args={{ input: 'npm install' }} result={undefined} isError={undefined} />);
    expect(screen.getByText('npm install')).toBeInTheDocument();
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose BashCard
```
Expected: 5 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/__tests__/components/tools/BashCard.test.tsx
git commit -m "test(desktop): add BashCard RTL render tests"
```

---

## Task 16: EditFileCard RTL test

**Files:**
- Create: `packages/desktop/src/__tests__/components/tools/EditFileCard.test.tsx`

**Step 1: Mock the Zustand store used inside EditFileCard**

EditFileCard calls `useTabsStore.getState().openInlineDiffTab` on button click. Mock the module:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditFileCard } from '../../../renderer/components/chat/assistant-ui/parts/tools/EditFileCard.js';

vi.mock('../../../renderer/store/tabs.js', () => ({
  useTabsStore: {
    getState: vi.fn().mockReturnValue({ openInlineDiffTab: vi.fn() }),
  },
}));

describe('EditFileCard', () => {
  it('renders the filename in the header', () => {
    render(
      <EditFileCard
        args={{ file_path: 'src/components/Button.tsx', old_string: 'old', new_string: 'new' }}
        result={undefined}
        isError={undefined}
      />
    );
    // shortFilename shows last 2 path segments
    expect(screen.getByText('components/Button.tsx')).toBeInTheDocument();
  });

  it('shows pulsing dot when result is undefined (running)', () => {
    const { container } = render(
      <EditFileCard
        args={{ file_path: 'src/main.ts', old_string: '', new_string: 'new code' }}
        result={undefined}
        isError={undefined}
      />
    );
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows green dot when result is provided and not error', () => {
    const { container } = render(
      <EditFileCard
        args={{ file_path: 'src/main.ts', old_string: 'old', new_string: 'new' }}
        result="File updated successfully"
        isError={false}
      />
    );
    // StatusDot renders a green span when result is defined and not error
    // bg-mf-success class
    expect(container.querySelector('[class*="bg-mf-success"]')).toBeTruthy();
  });

  it('renders "Open in diff editor" button', () => {
    render(
      <EditFileCard
        args={{ file_path: 'src/main.ts', old_string: 'old', new_string: 'new' }}
        result="done"
        isError={false}
      />
    );
    expect(screen.getByTitle('Open in diff editor')).toBeInTheDocument();
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose EditFileCard
```
Expected: 4 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/__tests__/components/tools/EditFileCard.test.tsx
git commit -m "test(desktop): add EditFileCard RTL render tests"
```

---

## Task 17: message-parsing tests

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/message-parsing.test.tsx`

**Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { renderHighlights, highlightMentions, PLAN_PREFIX } from './message-parsing.js';
import React from 'react';

describe('renderHighlights', () => {
  it('highlights slash command at start of text', () => {
    const parts = renderHighlights('/commit some changes');
    expect(parts).toHaveLength(2);
    // First part is the command span
    const first = parts[0] as React.ReactElement;
    expect(first.props.children).toBe('/commit');
  });

  it('returns plain string when no command or mention', () => {
    const parts = renderHighlights('just a plain message');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('just a plain message');
  });

  it('highlights @mention in text', () => {
    const parts = renderHighlights('see @src/utils.ts for reference');
    const mentionPart = (parts as React.ReactElement[]).find(
      (p) => typeof p === 'object' && p.props?.children === '@src/utils.ts'
    );
    expect(mentionPart).toBeDefined();
  });
});

describe('PLAN_PREFIX', () => {
  it('is the expected prefix string', () => {
    expect(PLAN_PREFIX).toBe('Implement the following plan:\n\n');
  });
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test -- --reporter=verbose message-parsing
```
Expected: 4 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/message-parsing.test.tsx
git commit -m "test(desktop): add message-parsing unit tests"
```

---

## Task 18: Install and configure Playwright CT

**Files:**
- Install: `@playwright/experimental-ct-react` in desktop package
- Create: `packages/desktop/playwright-ct.config.ts`
- Create: `packages/desktop/src/__tests__/playwright/.gitkeep`
- Modify: `packages/desktop/package.json` (add `test:playwright` script)

**Step 1: Install**
```bash
pnpm --filter @mainframe/desktop add -D @playwright/experimental-ct-react
pnpm --filter @mainframe/desktop exec playwright install chromium
```

**Step 2: Create `packages/desktop/playwright-ct.config.ts`**
```ts
import { defineConfig, devices } from '@playwright/experimental-ct-react';
import react from '@vitejs/plugin-react';

export default defineConfig({
  testDir: './src/__tests__/playwright',
  testMatch: '**/*.ct.test.tsx',
  snapshotDir: './__snapshots__',
  timeout: 10_000,
  fullyParallel: true,
  use: {
    ctPort: 3100,
    ctViteConfig: {
      plugins: [react()],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

**Step 3: Add script to `packages/desktop/package.json`**
Add to `"scripts"`:
```json
"test:playwright": "playwright test -c playwright-ct.config.ts"
```

**Step 4: Create placeholder dir**
```bash
mkdir -p packages/desktop/src/__tests__/playwright
```

**Step 5: Verify config is valid**
```bash
pnpm --filter @mainframe/desktop exec playwright test -c playwright-ct.config.ts --list 2>&1 | head -20
```
Expected: runs without error (no tests found yet is fine).

**Step 6: Commit**
```bash
git add packages/desktop/playwright-ct.config.ts packages/desktop/package.json pnpm-lock.yaml packages/desktop/src/__tests__/playwright/
git commit -m "test(desktop): add Playwright CT configuration"
```

---

## Task 19: Playwright CT — PermissionCard

**Files:**
- Create: `packages/desktop/src/__tests__/playwright/PermissionCard.ct.test.tsx`

**Step 1: Write the test**

```tsx
import { test, expect } from '@playwright/experimental-ct-react';
import { PermissionCard } from '../../renderer/components/chat/PermissionCard.js';
import type { PermissionRequest } from '@mainframe/types';

const request: PermissionRequest = {
  requestId: 'req-1',
  toolName: 'Bash',
  toolUseId: 'tu-1',
  input: { command: 'rm -rf /tmp/test' },
  suggestions: [],
};

test('renders permission card with tool name and action buttons', async ({ mount }) => {
  const component = await mount(
    <PermissionCard request={request} onRespond={() => {}} />
  );

  await expect(component.getByText('Permission Required')).toBeVisible();
  await expect(component.getByText('Bash')).toBeVisible();
  await expect(component.getByRole('button', { name: /allow once/i })).toBeVisible();
  await expect(component.getByRole('button', { name: /deny/i })).toBeVisible();
});

test('calls onRespond(allow) when Allow Once is clicked', async ({ mount }) => {
  let respondArg: string | undefined;
  const component = await mount(
    <PermissionCard
      request={request}
      onRespond={(behavior) => { respondArg = behavior; }}
    />
  );

  await component.getByRole('button', { name: /allow once/i }).click();
  expect(respondArg).toBe('allow');
});

test('calls onRespond(deny) when Deny is clicked', async ({ mount }) => {
  let respondArg: string | undefined;
  const component = await mount(
    <PermissionCard
      request={request}
      onRespond={(behavior) => { respondArg = behavior; }}
    />
  );

  await component.getByRole('button', { name: /deny/i }).click();
  expect(respondArg).toBe('deny');
});

test('expands details section on click', async ({ mount }) => {
  const component = await mount(
    <PermissionCard request={request} onRespond={() => {}} />
  );

  await component.getByText('Details').click();
  await expect(component.getByText(/rm -rf/)).toBeVisible();
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test:playwright -- PermissionCard
```
Expected: 4 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/__tests__/playwright/PermissionCard.ct.test.tsx
git commit -m "test(desktop): add PermissionCard Playwright CT tests"
```

---

## Task 20: Playwright CT — AskUserQuestionCard

**Files:**
- Create: `packages/desktop/src/__tests__/playwright/AskUserQuestionCard.ct.test.tsx`

**Step 1: Write the test**

```tsx
import { test, expect } from '@playwright/experimental-ct-react';
import { AskUserQuestionCard } from '../../renderer/components/chat/AskUserQuestionCard.js';
import type { PermissionRequest } from '@mainframe/types';

function makeRequest(): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu-1',
    input: {
      questions: [{
        question: 'Which framework should we use?',
        header: 'Framework',
        options: [
          { label: 'React', description: 'Component model' },
          { label: 'Vue', description: 'Progressive framework' },
        ],
        multiSelect: false,
      }],
    },
    suggestions: [],
  };
}

test('renders the question text and options', async ({ mount }) => {
  const component = await mount(
    <AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />
  );

  await expect(component.getByText('Which framework should we use?')).toBeVisible();
  await expect(component.getByText('React')).toBeVisible();
  await expect(component.getByText('Vue')).toBeVisible();
});

test('submit is disabled until option selected', async ({ mount }) => {
  const component = await mount(
    <AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />
  );

  await expect(component.getByRole('button', { name: /submit/i })).toBeDisabled();
});

test('submit becomes enabled after selection', async ({ mount }) => {
  const component = await mount(
    <AskUserQuestionCard request={makeRequest()} onRespond={() => {}} />
  );

  await component.getByText('React').click();
  await expect(component.getByRole('button', { name: /submit/i })).not.toBeDisabled();
});

test('calls onRespond with selected answer', async ({ mount }) => {
  let capturedArgs: unknown;
  const component = await mount(
    <AskUserQuestionCard
      request={makeRequest()}
      onRespond={(...args) => { capturedArgs = args; }}
    />
  );

  await component.getByText('Vue').click();
  await component.getByRole('button', { name: /submit/i }).click();

  expect(capturedArgs).toBeDefined();
  const answers = (capturedArgs as any[])[2]?.answers;
  expect(answers?.['Which framework should we use?']).toBe('Vue');
});
```

**Step 2: Run**
```bash
pnpm --filter @mainframe/desktop test:playwright -- AskUserQuestionCard
```
Expected: 4 tests pass.

**Step 3: Commit**
```bash
git add packages/desktop/src/__tests__/playwright/AskUserQuestionCard.ct.test.tsx
git commit -m "test(desktop): add AskUserQuestionCard Playwright CT tests"
```

---

## Task 21: Playwright CT — BashCard + EditFileCard

**Files:**
- Create: `packages/desktop/src/__tests__/playwright/BashCard.ct.test.tsx`
- Create: `packages/desktop/src/__tests__/playwright/EditFileCard.ct.test.tsx`

**Step 1: BashCard CT test**

```tsx
import { test, expect } from '@playwright/experimental-ct-react';
import { BashCard } from '../../renderer/components/chat/assistant-ui/parts/tools/BashCard.js';

test('renders command in header', async ({ mount }) => {
  const component = await mount(
    <BashCard args={{ command: 'npm run build' }} result={undefined} isError={undefined} />
  );
  await expect(component.getByText('npm run build')).toBeVisible();
});

test('shows running indicator when result is undefined', async ({ mount }) => {
  const component = await mount(
    <BashCard args={{ command: 'sleep 10' }} result={undefined} isError={undefined} />
  );
  // Pulsing dot present
  await expect(component.locator('.animate-pulse')).toBeVisible();
});

test('shows output after clicking to expand', async ({ mount }) => {
  const component = await mount(
    <BashCard args={{ command: 'echo hello' }} result="hello\n" isError={false} />
  );
  // Click the collapsible header to expand
  await component.locator('[class*="rounded-mf-card"]').click();
  await expect(component.getByText(/hello/)).toBeVisible();
});
```

**Step 2: EditFileCard CT test**

Note: EditFileCard uses `useTabsStore`. In CT, mock it by creating a ct setup file.

Create `packages/desktop/src/__tests__/playwright/EditFileCard.ct.test.tsx`:

```tsx
import { test, expect } from '@playwright/experimental-ct-react';
import { EditFileCard } from '../../renderer/components/chat/assistant-ui/parts/tools/EditFileCard.js';

test('renders filename in header', async ({ mount }) => {
  const component = await mount(
    <EditFileCard
      args={{ file_path: 'src/components/Button.tsx', old_string: 'old', new_string: 'new' }}
      result={undefined}
      isError={undefined}
    />
  );
  await expect(component.getByText('components/Button.tsx')).toBeVisible();
});

test('shows running indicator while processing', async ({ mount }) => {
  const { container } = await mount(
    <EditFileCard
      args={{ file_path: 'src/index.ts', old_string: '', new_string: 'new code' }}
      result={undefined}
      isError={undefined}
    />
  );
  await expect(component.locator('.animate-pulse')).toBeVisible();
});
```

**Step 3: Run all Playwright tests**
```bash
pnpm --filter @mainframe/desktop test:playwright
```
Expected: all CT tests pass.

**Step 4: Commit**
```bash
git add packages/desktop/src/__tests__/playwright/BashCard.ct.test.tsx
git add packages/desktop/src/__tests__/playwright/EditFileCard.ct.test.tsx
git commit -m "test(desktop): add BashCard and EditFileCard Playwright CT tests"
```

---

## Task 22: Final verification and PR

**Step 1: Run all core tests**
```bash
pnpm --filter @mainframe/core test
```
Expected: all pass.

**Step 2: Run all desktop unit/RTL tests**
```bash
pnpm --filter @mainframe/desktop test
```
Expected: all pass.

**Step 3: Typecheck both packages**
```bash
pnpm --filter @mainframe/core build
pnpm --filter @mainframe/desktop build
```
Expected: no TypeScript errors.

**Step 4: Create PR**
```bash
gh pr create \
  --title "test: comprehensive testing across core and desktop" \
  --body "$(cat <<'EOF'
## Summary

- Adds 3 end-to-end flow integration tests (send-message, permission, file-edit) that exercise the full adapter → EventHandler → WebSocket → client path
- Adds 7 unit test files covering previously untested modules: frontmatter, context-tracker, attachment-store, claude-skills, plan-mode-handler, routes/files, routes/git
- Adds RTL component tests for PermissionCard, AskUserQuestionCard (rewrite), BashCard, EditFileCard, message-parsing
- Adds Playwright CT tests for PermissionCard, AskUserQuestionCard, BashCard, EditFileCard (run manually or in separate pipeline)
- Removes the CLI-dependent integration test that required a live claude binary and network
- Raises core coverage thresholds (lines 60%, branches 50%, functions 55%) and adds desktop thresholds (lines 45%, branches 35%)

## Test plan

- [ ] `pnpm --filter @mainframe/core test` passes
- [ ] `pnpm --filter @mainframe/desktop test` passes
- [ ] `pnpm --filter @mainframe/desktop test:playwright` passes (run manually)
- [ ] TypeScript compiles without errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
