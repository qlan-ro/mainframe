import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { MockBaseAdapter } from './helpers/mock-adapter.js';
import { MockBaseSession } from './helpers/mock-session.js';
import type { ControlResponse, AdapterSession, SessionOptions, DaemonEvent } from '@mainframe/types';

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
      getModifiedFilesList: vi.fn().mockReturnValue([]),
      getPlanFiles: vi.fn().mockReturnValue([]),
      getSkillFiles: vi.fn().mockReturnValue([]),
      addModifiedFile: vi.fn().mockReturnValue(false),
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
  const app = createHttpServer(db as any, chats, registry);
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

    adapter.currentSession!.simulateInit('session-xyz');
    await sleep(50);

    const e = events.find((e) => e.type === 'process.ready');
    expect(e).toBeDefined();
    expect((e as any).processId).toBe('proc-1');
    expect((e as any).claudeSessionId).toBe('session-xyz');
  }, 10_000);

  it('tool_result event emits message.added with tool_result message', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.currentSession!.simulateToolResult([
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

    adapter.currentSession!.simulateCompact();
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
    (db.chats.addPlanFile as any).mockReturnValue(true);
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));

    adapter.currentSession!.simulatePlanFile('/tmp/test/plan.md');
    await sleep(50);

    expect(db.chats.addPlanFile).toHaveBeenCalledWith('test-chat', '/tmp/test/plan.md');
    expect(events.some((e) => e.type === 'context.updated')).toBe(true);
  }, 10_000);

  it('plan_file event does NOT emit context.updated when file already tracked', async () => {
    const adapter = new MockAdapter();
    const { httpServer, db } = createStack(adapter, 'default');
    server = httpServer;
    (db.chats.addPlanFile as any).mockReturnValue(false);
    const port = await startServer(server);
    ws = await connectWs(port);
    ws.send(JSON.stringify({ type: 'chat.resume', chatId: 'test-chat' }));
    await sleep(100);
    const events: DaemonEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as DaemonEvent));

    adapter.currentSession!.simulatePlanFile('/tmp/test/plan.md');
    await sleep(50);

    expect(events.some((e) => e.type === 'context.updated')).toBe(false);
  }, 10_000);

  it('error event emits error event to WS client', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.currentSession!.simulateError(new Error('something broke'));
    await sleep(50);

    const e = events.find((e) => e.type === 'error');
    expect(e).toBeDefined();
    expect((e as any).error).toBe('something broke');
  }, 10_000);

  it('result error_during_execution adds error message when not interrupted', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    adapter.currentSession!.simulateResult({
      subtype: 'error_during_execution',
      is_error: true,
    });
    await sleep(50);

    const errorMessages = events.filter((e) => e.type === 'message.added' && (e as any).message.type === 'error');
    expect(errorMessages).toHaveLength(1);
  }, 10_000);

  it('result error_during_execution suppresses error message when chat was interrupted', async () => {
    const adapter = new MockAdapter();
    const events = await setup(adapter);

    ws!.send(JSON.stringify({ type: 'chat.interrupt', chatId: 'test-chat' }));
    await sleep(50);

    adapter.currentSession!.simulateResult({
      subtype: 'error_during_execution',
      is_error: true,
    });
    await sleep(50);

    const errorMessages = events.filter((e) => e.type === 'message.added' && (e as any).message.type === 'error');
    expect(errorMessages).toHaveLength(0);
  }, 10_000);
});
