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
  const chats = new ChatManager(db as any, registry, undefined, (event) => wsRef.current?.broadcastEvent(event));
  const { app } = createHttpServer(db as any, chats, registry);
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
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('queued messages and thinking indicator', () => {
  let server: Server | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    if (server?.listening) await stopServer(server);
  });

  async function setup(adapter: MockAdapter) {
    const stack = createStack(adapter, 'default');
    server = stack.httpServer;
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));
    return Object.assign(events, { chats: stack.chats });
  }

  it('assistant message event followed by result does not impact queued message state', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    // Simulate assistant streaming a message
    adapter.currentSession!.simulateMessage([{ type: 'text', text: 'Processing user request...' }]);
    await sleep(50);

    // Verify message.added event
    const messageEvent = events.find((e) => e.type === 'message.added');
    expect(messageEvent).toBeDefined();

    // Complete the session - this should transition to idle
    adapter.currentSession!.simulateResult({
      subtype: 'completed',
      is_error: false,
    });
    await sleep(50);

    // Verify chat.updated with processState = idle was emitted
    const idleEvent = events.find((e) => e.type === 'chat.updated' && (e as any).chat.processState === 'idle');
    expect(idleEvent).toBeDefined();
    expect((idleEvent as any).reason).toBe('completed');
  }, 10_000);

  it('tool result followed by result transitions to idle correctly', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    // Simulate assistant sending a tool_use
    adapter.currentSession!.simulateMessage([
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
      },
    ]);
    await sleep(50);

    // Simulate tool result
    adapter.currentSession!.simulateToolResult([
      { type: 'tool_result', toolUseId: 'tool-1', content: 'hello', isError: false },
    ]);
    await sleep(50);

    // Verify tool_result message was added
    const toolResultEvent = events.find((e) => e.type === 'message.added' && (e as any).message.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();

    // Complete the session
    adapter.currentSession!.simulateResult({
      subtype: 'completed',
      is_error: false,
    });
    await sleep(50);

    // Verify transition to idle happened correctly
    const idleEvent = events.find((e) => e.type === 'chat.updated' && (e as any).chat.processState === 'idle');
    expect(idleEvent).toBeDefined();
  }, 10_000);

  it('keeps processState=working when result fires while a queued message is still pending', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);
    const chatManager = events.chats;

    // The mock chat row reports processState='working', so this sendMessage
    // takes the queued path: it stores a queuedRef and tags metadata.queued.
    await chatManager.sendMessage('test-chat', 'second message');
    await sleep(50);

    events.length = 0;

    // Result for the first turn. Queue still has the second message pending —
    // onResult must NOT flip processState to idle.
    adapter.currentSession!.simulateResult({ subtype: 'completed', is_error: false });
    await sleep(50);

    const droppedToIdle = events.some(
      (e) => e.type === 'chat.updated' && (e as { chat: { processState?: string } }).chat.processState === 'idle',
    );
    expect(droppedToIdle).toBe(false);
  }, 10_000);

  it('sweeps stranded message.metadata.queued flags when result fires with empty queue', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);
    const chatManager = events.chats;

    // Inject a stranded queued flag — simulates the CLI ack arriving in a
    // shape (event.uuid missing) we didn't dispatch, so the metadata was
    // never cleared by onQueuedProcessed.
    const cache = (
      chatManager as unknown as {
        messages: {
          append(chatId: string, msg: { metadata?: Record<string, unknown> }): void;
          get(id: string): Array<{ metadata?: Record<string, unknown> }> | undefined;
        };
      }
    ).messages;
    cache.append('test-chat', {
      id: 'orphan-msg',
      chatId: 'test-chat',
      type: 'user',
      content: [{ type: 'text', text: 'orphan' }],
      timestamp: new Date().toISOString(),
      metadata: { queued: true, uuid: 'orphan-uuid-1' },
    } as never);
    const msgs = cache.get('test-chat')!;

    events.length = 0;
    adapter.currentSession!.simulateResult({ subtype: 'completed', is_error: false });
    await sleep(50);

    const stranded = msgs.find((m) => m.metadata?.queued === true);
    expect(stranded).toBeUndefined();
  }, 10_000);

  it('result event for parent session transitions to idle (subagent results already filtered)', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    // Simulate assistant message with a tool that might spawn a subagent
    adapter.currentSession!.simulateMessage([
      {
        type: 'tool_use',
        id: 'task-1',
        name: 'Task',
        input: { description: 'Do something' },
      },
    ]);
    await sleep(50);

    // Verify assistant message was added
    const assistantEvent = events.find((e) => e.type === 'message.added' && (e as any).message.type === 'assistant');
    expect(assistantEvent).toBeDefined();

    // The subagent result event should be filtered in events.ts (lines 611-622),
    // so we only see the parent session's result event
    adapter.currentSession!.simulateResult({
      subtype: 'completed',
      is_error: false,
    });
    await sleep(50);

    // Parent session should transition to idle
    const idleEvent = events.find((e) => e.type === 'chat.updated' && (e as any).chat.processState === 'idle');
    expect(idleEvent).toBeDefined();
    expect((idleEvent as any).reason).toBe('completed');
  }, 10_000);
});
