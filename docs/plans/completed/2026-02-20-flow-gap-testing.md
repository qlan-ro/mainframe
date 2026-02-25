# Flow Gap Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add integration tests for flows that are missing the outbound direction (WS client → adapter) or are entirely untested (adapter event types, EnterPlanMode auto-switch).

**Architecture:** Same pattern as existing tests in `permission-flow.test.ts` and `send-message-flow.test.ts`. The adapter seam is at `MockAdapter extends BaseAdapter` with `id = 'claude'`. Real HTTP+WS server. Real `ws` client. Emit adapter events with `adapter.emit(eventName, ...)`. Send WS client events with `ws.send(JSON.stringify({...}))`.

**Why this matters:** The current tests only verify that adapter events reach WS clients. They don't verify that WS client messages reach adapters, that queued permissions are emitted in order, or that most adapter event types produce the expected WS events. A refactor of `event-handler.ts`, `permission-handler.ts`, or `websocket.ts` would go undetected.

**Tech Stack:** Vitest, Node.js `http`, `ws` WebSocket client, MockAdapter, in-memory mock DB

---

## Shared Test Infrastructure

All new test files use the same helpers from `permission-flow.test.ts`. Copy the full `createMockDb`, `createStack`, `startServer`, `stopServer`, `connectWs`, `sleep`, and `makePermissionRequest` helpers. The extended `MockAdapter` below adds spies for `kill`, `sendMessage`, and `interrupt`:

```ts
class MockAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Mock';
  respondToPermissionSpy = vi.fn();
  sendMessageSpy = vi.fn();
  killSpy = vi.fn();
  interruptSpy = vi.fn();

  async isInstalled() { return true; }
  async getVersion() { return '1.0'; }
  async spawn(_opts: SpawnOptions): Promise<AdapterProcess> {
    return { id: 'proc-1', adapterId: 'claude', chatId: '', pid: 0, status: 'ready', projectPath: '/tmp', model: 'test' };
  }
  async kill(_p: AdapterProcess) { this.killSpy(); }
  async interrupt(_p: AdapterProcess) { this.interruptSpy(); }
  async sendMessage(_p: AdapterProcess, msg: string) { this.sendMessageSpy(msg); }
  async respondToPermission(_p: AdapterProcess, r: PermissionResponse) { this.respondToPermissionSpy(r); }
  override async loadHistory() { return []; }
}
```

The `setupAndResume` helper sends `chat.resume` and returns a collected events array:

```ts
async function setupAndResume(adapter: MockAdapter, permissionMode: string) {
  const { httpServer } = createStack(adapter, permissionMode);
  server = httpServer;
  const port = await startServer(server);
  ws = await connectWs(port);
  ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
  await sleep(100);
  const events: DaemonEvent[] = [];
  ws.on('message', (data) => {
    events.push(JSON.parse(data.toString()) as DaemonEvent);
  });
  return events;
}
```

---

## Task 1: Extend permission-flow.test.ts — round-trip and queue

**Files:**
- Modify: `packages/core/src/__tests__/permission-flow.test.ts`

**What to add:** Two new `it` blocks inside the existing `describe('permission flow', ...)` block, after the four existing tests. No new files.

**Step 1: Write the tests**

Add after line 231 (end of existing tests, before closing `}`):

```ts
it('WS permission.respond forwards response to adapter', async () => {
  const adapter = new MockAdapter();
  const events = await setupAndResume(adapter, 'default');

  // Queue a permission so the adapter has a pending request
  adapter.emit(
    'permission',
    'proc-1',
    makePermissionRequest('Bash', { requestId: 'req-42', toolUseId: 'tu-42' }),
  );
  await sleep(50);

  // Client responds via WS
  ws!.send(
    JSON.stringify({
      type: 'permission.respond',
      chatId: 'test-chat',
      response: {
        requestId: 'req-42',
        toolUseId: 'tu-42',
        toolName: 'Bash',
        behavior: 'allow',
        updatedInput: { command: 'echo hello' },
      },
    }),
  );
  await sleep(50);

  expect(adapter.respondToPermissionSpy).toHaveBeenCalledOnce();
  expect(adapter.respondToPermissionSpy).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: 'allow', toolUseId: 'tu-42' }),
  );
}, 10_000);

it('second queued permission is emitted after first is answered', async () => {
  const adapter = new MockAdapter();
  const events = await setupAndResume(adapter, 'default');
  const permissionEvents = events.filter((e) => e.type === 'permission.requested');

  // Emit first permission
  adapter.emit(
    'permission',
    'proc-1',
    makePermissionRequest('Bash', { requestId: 'req-1', toolUseId: 'tu-1', input: { command: 'ls' } }),
  );
  await sleep(50);

  // Emit second permission — should be queued, NOT emitted yet
  adapter.emit(
    'permission',
    'proc-1',
    makePermissionRequest('Write', { requestId: 'req-2', toolUseId: 'tu-2', input: { file_path: 'a.ts', content: '' } }),
  );
  await sleep(50);

  expect(permissionEvents).toHaveLength(1);
  expect((permissionEvents[0] as any).request.requestId).toBe('req-1');

  // Respond to first — second should now be emitted
  ws!.send(
    JSON.stringify({
      type: 'permission.respond',
      chatId: 'test-chat',
      response: { requestId: 'req-1', toolUseId: 'tu-1', toolName: 'Bash', behavior: 'allow', updatedInput: {} },
    }),
  );
  await sleep(50);

  expect(permissionEvents).toHaveLength(2);
  expect((permissionEvents[1] as any).request.requestId).toBe('req-2');
}, 10_000);
```

**Important:** `permissionEvents` is a filtered view of `events`. Filter at declaration so new items added to `events` are picked up:
```ts
const permissionEvents = events.filter((e) => e.type === 'permission.requested');
```
This won't work as a reactive filter since `filter` is called once. Instead, collect them via a separate listener or filter inside the assertion.

**Correct pattern:** Collect only `permission.requested` events in a separate array:

```ts
it('second queued permission is emitted after first is answered', async () => {
  const adapter = new MockAdapter();
  const { httpServer } = createStack(adapter, 'default');
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

  adapter.emit(
    'permission',
    'proc-1',
    makePermissionRequest('Bash', { requestId: 'req-1', toolUseId: 'tu-1', input: { command: 'ls' } }),
  );
  await sleep(50);

  adapter.emit(
    'permission',
    'proc-1',
    makePermissionRequest('Write', { requestId: 'req-2', toolUseId: 'tu-2', input: { file_path: 'a.ts', content: '' } }),
  );
  await sleep(50);

  // Only first emitted
  expect(permissionEvents).toHaveLength(1);
  expect((permissionEvents[0] as any).request.requestId).toBe('req-1');

  ws!.send(
    JSON.stringify({
      type: 'permission.respond',
      chatId: 'test-chat',
      response: { requestId: 'req-1', toolUseId: 'tu-1', toolName: 'Bash', behavior: 'allow', updatedInput: {} },
    }),
  );
  await sleep(50);

  // Second now emitted
  expect(permissionEvents).toHaveLength(2);
  expect((permissionEvents[1] as any).request.requestId).toBe('req-2');
}, 10_000);
```

**Step 2: Run the new tests only**

```bash
pnpm --filter @mainframe/core test -- --run --reporter=verbose permission-flow
```

Expected: 6 tests pass (4 existing + 2 new).

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/permission-flow.test.ts
git commit -m "test(core): add permission round-trip and queue depth tests"
```

---

## Task 2: adapter-events-flow.test.ts

**Files:**
- Create: `packages/core/src/__tests__/adapter-events-flow.test.ts`

**What to test:** Each adapter event type emitted by MockAdapter produces the correct WS `DaemonEvent`. Import the extended MockAdapter from the shared structure above (copy it into this file).

**Step 1: Write the test file**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import type { AdapterProcess, PermissionResponse, SpawnOptions, DaemonEvent } from '@mainframe/types';

// [Paste MockAdapter, createMockDb, createStack, startServer, stopServer, connectWs, sleep helpers here]
// Same as permission-flow.test.ts but MockAdapter also needs kill and sendMessage

describe('adapter events flow', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  async function setup(adapter: MockAdapter) {
    const { httpServer } = createStack(adapter, 'default');
    server = httpServer;
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));
    return events;
  }

  it('init event emits process.ready', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('init', 'proc-1', 'session-xyz', 'claude-opus-4-5', ['Bash']);
    await sleep(50);

    const e = events.find((e) => e.type === 'process.ready');
    expect(e).toBeDefined();
    expect((e as any).processId).toBe('proc-1');
    expect((e as any).claudeSessionId).toBe('session-xyz');
  }, 10_000);

  it('tool_result event emits message.added with tool_result message', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('tool_result', 'proc-1', [
      { type: 'tool_result', toolUseId: 'tu-1', content: 'wrote file successfully' },
    ]);
    await sleep(50);

    const e = events.find((e) => e.type === 'message.added');
    expect(e).toBeDefined();
    expect((e as any).message.type).toBe('tool_result');
    expect((e as any).message.content[0].type).toBe('tool_result');
  }, 10_000);

  it('compact event emits message.added with Context compacted text', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('compact', 'proc-1');
    await sleep(50);

    const e = events.find((e) => e.type === 'message.added');
    expect(e).toBeDefined();
    const content = (e as any).message.content;
    expect(content.some((b: any) => b.type === 'text' && b.text === 'Context compacted')).toBe(true);
  }, 10_000);

  it('plan_file event emits context.updated when file is new', async () => {
    const adapter = new MockAdapter();
    const { httpServer, db } = createStack(adapter, 'default');
    server = httpServer;
    (db.chats.addPlanFile as any).mockReturnValue(true); // new file
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));

    adapter.emit('plan_file', 'proc-1', '/tmp/test/plan.md');
    await sleep(50);

    expect(db.chats.addPlanFile).toHaveBeenCalledWith('test-chat', '/tmp/test/plan.md');
    expect(events.some((e) => e.type === 'context.updated')).toBe(true);
  }, 10_000);

  it('plan_file event does NOT emit context.updated when file already tracked', async () => {
    const adapter = new MockAdapter();
    const { httpServer, db } = createStack(adapter, 'default');
    server = httpServer;
    (db.chats.addPlanFile as any).mockReturnValue(false); // already tracked (default)
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));

    adapter.emit('plan_file', 'proc-1', '/tmp/test/plan.md');
    await sleep(50);

    expect(events.some((e) => e.type === 'context.updated')).toBe(false);
  }, 10_000);

  it('error event emits error event to WS client', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('error', 'proc-1', new Error('something broke'));
    await sleep(50);

    const e = events.find((e) => e.type === 'error');
    expect(e).toBeDefined();
    expect((e as any).error).toBe('something broke');
  }, 10_000);

  it('result error_during_execution adds error message when not interrupted', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('result', 'proc-1', {
      cost: 0,
      tokensInput: 10,
      tokensOutput: 5,
      subtype: 'error_during_execution',
      isError: true,
      durationMs: 100,
    });
    await sleep(50);

    const errorMessages = events.filter(
      (e) => e.type === 'message.added' && (e as any).message.type === 'error',
    );
    expect(errorMessages).toHaveLength(1);
  }, 10_000);

  it('result error_during_execution suppresses error message when chat was interrupted', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    // Interrupt the chat first (marks it as interrupted)
    ws!.send(JSON.stringify({ type: 'chat.interrupt', chatId: 'test-chat' }));
    await sleep(50);

    // Then result arrives with error
    adapter.emit('result', 'proc-1', {
      cost: 0,
      tokensInput: 10,
      tokensOutput: 5,
      subtype: 'error_during_execution',
      isError: true,
    });
    await sleep(50);

    const errorMessages = events.filter(
      (e) => e.type === 'message.added' && (e as any).message.type === 'error',
    );
    expect(errorMessages).toHaveLength(0);
  }, 10_000);
});
```

**Step 2: Run the new file**

```bash
pnpm --filter @mainframe/core test -- --run --reporter=verbose adapter-events-flow
```

Expected: 7 tests pass.

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/adapter-events-flow.test.ts
git commit -m "test(core): add adapter event → WS flow tests (init, tool_result, compact, plan_file, error, result variants)"
```

---

## Task 3: ws-inbound-flow.test.ts

**Files:**
- Create: `packages/core/src/__tests__/ws-inbound-flow.test.ts`

**What to test:** WS client messages that trigger adapter method calls or behavioral changes.

**Step 1: Write the test file**

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

// [Paste MockAdapter, createMockDb, createStack, startServer, stopServer, connectWs, sleep helpers here]

describe('WS inbound flows', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  async function setup(adapter: MockAdapter) {
    const { httpServer } = createStack(adapter, 'default');
    server = httpServer;
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));
    return events;
  }

  it('message.send causes adapter.sendMessage to be called', async () => {
    const adapter = new MockAdapter();
    await setup(adapter);

    ws!.send(
      JSON.stringify({
        type: 'message.send',
        chatId: 'test-chat',
        content: 'Hello, world!',
        attachmentIds: [],
      }),
    );
    await sleep(100);

    expect(adapter.sendMessageSpy).toHaveBeenCalledOnce();
    expect(adapter.sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Hello, world!'));
  }, 10_000);

  it('chat.interrupt causes adapter.interrupt to be called', async () => {
    const adapter = new MockAdapter();
    await setup(adapter);

    ws!.send(JSON.stringify({ type: 'chat.interrupt', chatId: 'test-chat' }));
    await sleep(50);

    expect(adapter.interruptSpy).toHaveBeenCalledOnce();
  }, 10_000);

  it('chat.end emits chat.ended and stops forwarding events for that chat', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    ws!.send(JSON.stringify({ type: 'chat.end', chatId: 'test-chat' }));
    await sleep(50);

    const endedEvent = events.find((e) => e.type === 'chat.ended');
    expect(endedEvent).toBeDefined();

    // After end, events for this chat should NOT reach the client (unsubscribed)
    const countBefore = events.length;
    adapter.emit('result', 'proc-1', { cost: 0, tokensInput: 0, tokensOutput: 0 });
    await sleep(50);

    // No new events should arrive for this chat (subscription cleared)
    expect(events.length).toBe(countBefore);
  }, 10_000);

  it('EnterPlanMode in message switches permissionMode to plan and emits chat.updated', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.emit('message', 'proc-1', [
      { type: 'tool_use', id: 'tu-plan', name: 'EnterPlanMode', input: { plan: 'Step 1...' } },
    ]);
    await sleep(50);

    const chatUpdated = events.find(
      (e) => e.type === 'chat.updated' && (e as any).chat?.permissionMode === 'plan',
    );
    expect(chatUpdated).toBeDefined();
  }, 10_000);

  it('invalid WS message sends back error type', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    ws!.send(JSON.stringify({ type: 'not.a.real.type', someField: 'value' }));
    await sleep(50);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).error).toMatch(/Invalid message/i);
  }, 10_000);
});
```

**Note on `message.send` assertion:** `ChatManager.sendMessage` calls `adapter.sendMessage(process, outgoingContent, images)` where `outgoingContent` is a stringified JSON of the message blocks. The spy receives the stringified content. `expect.stringContaining('Hello, world!')` works because the text content is embedded in the outgoing string.

**Step 2: Run the new file**

```bash
pnpm --filter @mainframe/core test -- --run --reporter=verbose ws-inbound-flow
```

Expected: 5 tests pass.

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/ws-inbound-flow.test.ts
git commit -m "test(core): add WS inbound flow tests (message.send, interrupt, end, EnterPlanMode, invalid message)"
```

---

## Task 4: Final verification

**Step 1: Run full test suite**

```bash
CI=1 pnpm --filter @mainframe/core test --run
```

Expected: All tests pass (no failures in new or existing files). The `title-generation.test.ts` tests are skipped because `CI=1`.

**Step 2: Check coverage**

```bash
CI=1 pnpm --filter @mainframe/core test --coverage
```

Expected coverage (current baseline — new tests should improve `server/` coverage):
- lines ≥ 60%
- branches ≥ 50%
- functions ≥ 55%

**Step 3: Commit any threshold bumps if warranted**

If new tests push branches or lines significantly higher, bump the thresholds in `packages/core/vitest.config.ts` to lock in the gains. Use the actual coverage numbers rounded down to nearest 5%.

**Step 4: Run desktop tests to ensure nothing regressed**

```bash
pnpm --filter @mainframe/desktop test --run
```

Expected: 222 tests pass (Playwright CT excluded).

---

## Notes on Potential Pitfalls

### chat.interrupt and process state
`interruptChat` checks `if (!active?.process) return` early. Since the MockAdapter returns `{ id: 'proc-1' }` from `spawn()`, the resume sets up the active process. The interrupt should call `adapter.interrupt?.(active.process)`. The `?.(...)` optional call works because `MockAdapter.interrupt` is defined.

### message.send content format
`ChatManager.sendMessage` processes the raw string through `attachment-processor.ts` and builds `MessageContent[]` before calling `adapter.sendMessage`. The first block is always `{ type: 'text', text: content }`. The adapter receives the full content array as a JSON string in the second argument. Use `expect.stringContaining('Hello, world!')` which matches across the JSON representation.

### EnterPlanMode initial permissionMode check
`event-handler.ts:54` guards: `if (active && active.chat.permissionMode !== 'plan')`. The mock DB returns a chat with `permissionMode: 'default'`, so this condition is true and the switch happens.

### plan_file test needs db reference
The `createStack` function returns `{ httpServer, chats, db }`. Use the `db` directly to set up `addPlanFile.mockReturnValue(true)` before the server starts handling events. Do NOT call `createStack` in `setup()` helper for this test — set up the db first, then connect.

### result event process cleanup
After `result` fires, `event-handler.ts:156-168` on `exit` will clean up process mapping. But in tests, `exit` is not emitted unless you explicitly do `adapter.emit('exit', 'proc-1', 0)`. Don't emit exit unless testing the exit flow.
