import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { MockBaseAdapter } from './helpers/mock-adapter.js';
import { MockBaseSession } from './helpers/mock-session.js';
import type { AdapterSession, SessionOptions, DaemonEvent } from '@mainframe/types';

class MockSession extends MockBaseSession {
  constructor(private adapter: MockAdapter) {
    super('proc-1', adapter.id, '/tmp');
  }
}

class MockAdapter extends MockBaseAdapter {
  override id = 'claude';
  override name = 'Mock';
  currentSession: MockSession | null = null;

  override createSession(_options: SessionOptions): AdapterSession {
    this.currentSession = new MockSession(this);
    return this.currentSession;
  }
}

const TEST_CHAT = {
  id: 'test-chat',
  adapterId: 'claude',
  projectId: 'proj-1',
  status: 'active',
  claudeSessionId: 'session-1',
  processState: 'working',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
};
const TEST_PROJECT = { id: 'proj-1', name: 'Test', path: '/tmp/test' };

function createMockDb() {
  return {
    chats: {
      get: vi.fn().mockReturnValue(TEST_CHAT),
      create: vi.fn().mockReturnValue(TEST_CHAT),
      list: vi.fn().mockReturnValue([TEST_CHAT]),
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
      get: vi.fn().mockReturnValue(TEST_PROJECT),
      list: vi.fn().mockReturnValue([TEST_PROJECT]),
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
    adapter.currentSession!.simulateMessage([{ type: 'text', text: 'Hello from assistant!' }]);
    adapter.currentSession!.simulateResult({
      subtype: 'success',
      total_cost_usd: 0.001,
      result: 'session-1',
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
