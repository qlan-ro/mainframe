import { BackgroundTaskTracker } from '../background-tasks/tracker.js';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { MockBaseAdapter } from './helpers/mock-adapter.js';
import { MockBaseSession } from './helpers/mock-session.js';
import type { ControlResponse, AdapterSession, SessionOptions, DaemonEvent } from '@qlan-ro/mainframe-types';

class MockSession extends MockBaseSession {
  constructor(private adapter: MockAdapter) {
    super('proc-1', adapter.id, '/tmp');
  }

  override async sendMessage(msg: string): Promise<void> {
    this.adapter.sendMessageSpy(msg);
  }
  override async respondToPermission(r: ControlResponse): Promise<void> {
    this.adapter.respondToPermissionSpy(r);
  }
  override async interrupt(): Promise<void> {
    this.adapter.interruptSpy();
  }
  override async kill(): Promise<void> {
    await super.kill();
    this.adapter.killSpy();
  }
}

class MockAdapter extends MockBaseAdapter {
  override id = 'claude';
  override name = 'Mock';
  respondToPermissionSpy = vi.fn();
  sendMessageSpy = vi.fn();
  killSpy = vi.fn();
  interruptSpy = vi.fn();
  currentSession: MockSession | null = null;

  override createSession(_options: SessionOptions): AdapterSession {
    this.currentSession = new MockSession(this);
    return this.currentSession;
  }
}

function makeChat(permissionMode: string) {
  return {
    id: 'test-chat',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    claudeSessionId: 'session-1',
    processState: 'working',
    permissionMode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
  };
}

function createMockDb(permissionMode = 'default') {
  const chat = makeChat(permissionMode);
  return {
    chats: {
      get: vi.fn().mockReturnValue(chat),
      create: vi.fn().mockReturnValue(chat),
      list: vi.fn().mockReturnValue([chat]),
      update: vi.fn(),
      addPlanFile: vi.fn().mockReturnValue(false),
      addSkillFile: vi.fn().mockReturnValue(false),
      addMention: vi.fn().mockReturnValue(false),
      getMentions: vi.fn().mockReturnValue([]),
      getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]),
    },
    projects: {
      get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: '/tmp/test' }),
      list: vi.fn().mockReturnValue([]),
      getByPath: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      remove: vi.fn(),
      updateLastOpened: vi.fn(),
    },
    settings: {
      get: vi.fn().mockReturnValue(null),
      getByCategory: vi.fn().mockReturnValue({}),
    },
  };
}

function createStack(adapter: MockAdapter, permissionMode = 'default') {
  const db = createMockDb(permissionMode);
  const registry = new AdapterRegistry();
  (registry as any).adapters = new Map();
  registry.register(adapter);
  const wsRef: { current: WebSocketManager | null } = { current: null };
  const chats = new ChatManager(db as any, registry, new BackgroundTaskTracker(), undefined, (event) =>
    wsRef.current?.broadcastEvent(event),
  );
  const { app } = createHttpServer({ db: db as any, chats, adapters: registry });
  const httpServer = createServer(app);
  wsRef.current = new WebSocketManager(httpServer, chats);
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
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

/** Connect and start collecting messages immediately so events fired between
 *  upgrade and the test's first await aren't lost. */
function connectWsCollecting(port: number): Promise<{ socket: WebSocket; events: DaemonEvent[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const events: DaemonEvent[] = [];
    socket.on('message', (d) => events.push(JSON.parse(d.toString()) as DaemonEvent));
    socket.on('open', () => resolve({ socket, events }));
    socket.on('error', reject);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('WS inbound flows', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  async function setup(adapter: MockAdapter) {
    const { httpServer, chats } = createStack(adapter, 'default');
    server = httpServer;
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'subscribe', chatId: 'test-chat' }));
    await chats.resumeChat('test-chat');
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));
    return Object.assign(events, { chats });
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

  it('POST /api/chats/:id/interrupt causes adapter.interrupt to be called', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    await events.chats.interruptChat('test-chat');
    await sleep(50);

    expect(adapter.interruptSpy).toHaveBeenCalledOnce();
  }, 10_000);

  it('unsubscribe stops forwarding chatId-scoped events for that chat', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    ws!.send(JSON.stringify({ type: 'unsubscribe', chatId: 'test-chat' }));
    await sleep(50);

    // After unsubscribe, chatId-scoped events (message.added etc.) should NOT
    // reach the client. Emit a message — it will be scoped to the chatId.
    const countBefore = events.length;
    adapter.currentSession!.simulateMessage([{ type: 'text', text: 'ignored' }]);
    await sleep(50);

    // No new message.added events should arrive (subscription cleared)
    const newMessageAdded = events.slice(countBefore).filter((e) => e.type === 'message.added');
    expect(newMessageAdded).toHaveLength(0);
  }, 10_000);

  it('EnterPlanMode in message flips planMode=true and emits chat.updated', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.currentSession!.simulateMessage([
      { type: 'tool_use', id: 'tu-plan', name: 'EnterPlanMode', input: { plan: 'Step 1...' } },
    ]);
    await sleep(50);

    const chatUpdated = events.find((e) => e.type === 'chat.updated' && (e as any).chat?.planMode === true);
    expect(chatUpdated).toBeDefined();
  }, 10_000);

  it('chat.created is broadcast to all connected WS clients when chat is created via REST', async () => {
    const adapter = new MockAdapter();
    const { httpServer, chats } = createStack(adapter);
    server = httpServer;
    const port = await startServer(server);

    const { socket: a, events: eventsA } = await connectWsCollecting(port);
    const { socket: b, events: eventsB } = await connectWsCollecting(port);
    await sleep(50);

    // Create chat via ChatManager directly (as the REST endpoint would)
    await chats.createChatWithDefaults('proj-1', 'claude');
    await sleep(100);

    const createdOnA = eventsA.find((e) => e.type === 'chat.created');
    const createdOnB = eventsB.find((e) => e.type === 'chat.created');
    expect(createdOnA).toBeDefined();
    expect(createdOnB).toBeDefined();
    // originClientId is no longer stamped (origin attribution removed)
    expect((createdOnA as any).originClientId).toBeUndefined();

    a.close();
    b.close();
  }, 10_000);

  it('subscribe emits message.queued.snapshot so composer rehydrates on chat re-entry', async () => {
    const adapter = new MockAdapter();
    const { httpServer, chats } = createStack(adapter);
    server = httpServer;
    const port = await startServer(server);

    // Pre-seed a queued ref as if a prior session had sent one. This mirrors
    // the real bug: user sends a queued message in chat A, switches away
    // (so the renderer's composer keeps the entry in its local map), then
    // returns. Without the fix, subscribe re-subscribes but never sends
    // a snapshot, so the composer keeps whatever stale state it had — even
    // after the CLI processed the message and the daemon pruned the ref.
    const ref = {
      uuid: 'preseeded-uuid',
      chatId: 'test-chat',
      messageId: 'm1',
      content: 'hi',
      timestamp: new Date().toISOString(),
    };
    (chats as unknown as { queuedRefs: Map<string, typeof ref> }).queuedRefs.set(ref.uuid, ref);

    const { socket, events } = await connectWsCollecting(port);
    ws = socket;
    socket.send(JSON.stringify({ type: 'subscribe', chatId: 'test-chat' }));
    await sleep(150);

    const snapshot = events.find((e) => e.type === 'message.queued.snapshot');
    expect(snapshot).toBeDefined();
    expect((snapshot as { chatId: string }).chatId).toBe('test-chat');
    expect((snapshot as { refs: Array<{ uuid: string }> }).refs.map((r) => r.uuid)).toEqual(['preseeded-uuid']);
  }, 10_000);

  it('subscribe snapshot is empty when daemon has no queued refs (clears stranded composer entries)', async () => {
    const adapter = new MockAdapter();
    const { httpServer } = createStack(adapter);
    server = httpServer;
    const port = await startServer(server);

    // No refs pre-seeded — this is the scenario the user hit: the daemon
    // already pruned the ref while the client was unsubscribed, so on
    // re-entry the snapshot must be empty to converge the renderer's
    // stale composer state down to nothing.
    const { socket, events } = await connectWsCollecting(port);
    ws = socket;
    socket.send(JSON.stringify({ type: 'subscribe', chatId: 'test-chat' }));
    await sleep(150);

    const snapshot = events.find((e) => e.type === 'message.queued.snapshot');
    expect(snapshot).toBeDefined();
    expect((snapshot as { refs: unknown[] }).refs).toEqual([]);
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
