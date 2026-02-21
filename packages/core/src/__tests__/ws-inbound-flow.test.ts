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
  id = 'claude';
  name = 'Mock';
  respondToPermissionSpy = vi.fn();
  sendMessageSpy = vi.fn();
  killSpy = vi.fn();
  interruptSpy = vi.fn();

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0';
  }
  async spawn(_opts: SpawnOptions): Promise<AdapterProcess> {
    return {
      id: 'proc-1',
      adapterId: 'claude',
      chatId: '',
      pid: 0,
      status: 'ready',
      projectPath: '/tmp',
      model: 'test',
    };
  }
  async kill(_p: AdapterProcess) {
    this.killSpy();
  }
  async interrupt(_p: AdapterProcess) {
    this.interruptSpy();
  }
  async sendMessage(_p: AdapterProcess, msg: string) {
    this.sendMessageSpy(msg);
  }
  async respondToPermission(_p: AdapterProcess, r: PermissionResponse) {
    this.respondToPermissionSpy(r);
  }
  override async loadHistory() {
    return [];
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
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on('open', () => resolve(socket));
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

    const chatUpdated = events.find((e) => e.type === 'chat.updated' && (e as any).chat?.permissionMode === 'plan');
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
