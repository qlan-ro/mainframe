import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../server/websocket.js';
import { createHttpServer } from '../server/http.js';
import { ChatManager } from '../chat/index.js';
import { AdapterRegistry } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base.js';
import { BaseSession } from '../adapters/base-session.js';
import type {
  AdapterProcess,
  ControlResponse,
  AdapterSession,
  SessionOptions,
  SessionSpawnOptions,
  DaemonEvent,
  ControlRequest,
} from '@mainframe/types';

class MockSession extends BaseSession {
  readonly id = 'proc-1';
  readonly adapterId: string;
  readonly projectPath: string;
  private _isSpawned = false;

  constructor(private adapter: MockAdapter) {
    super();
    this.adapterId = adapter.id;
    this.projectPath = '/tmp';
  }

  get isSpawned(): boolean {
    return this._isSpawned;
  }

  async spawn(_options?: SessionSpawnOptions): Promise<AdapterProcess> {
    this._isSpawned = true;
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: '',
      pid: 0,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async kill(): Promise<void> {
    this._isSpawned = false;
  }

  getProcessInfo(): AdapterProcess | null {
    return this._isSpawned
      ? { id: this.id, adapterId: this.adapterId, chatId: '', pid: 0, status: 'ready', projectPath: this.projectPath }
      : null;
  }

  override async respondToPermission(r: ControlResponse): Promise<void> {
    this.adapter.respondToPermissionSpy(r);
  }
}

class MockAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Mock';
  respondToPermissionSpy = vi.fn();
  currentSession: MockSession | null = null;

  async isInstalled() {
    return true;
  }
  async getVersion() {
    return '1.0';
  }

  override createSession(_options: SessionOptions): AdapterSession {
    this.currentSession = new MockSession(this);
    return this.currentSession;
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
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makePermissionRequest(toolName: string, overrides?: Partial<ControlRequest>): ControlRequest {
  return {
    requestId: 'req-1',
    toolName,
    toolUseId: 'tu-1',
    input: { command: 'echo hello' },
    suggestions: [],
    ...overrides,
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

    adapter.currentSession!.emit(
      'permission',
      makePermissionRequest('AskUserQuestion', {
        input: {
          questions: [{ question: 'Which approach?', header: 'Approach', options: [], multiSelect: false }],
        },
      }),
    );
    await sleep(50);

    expect(events).toHaveLength(1);
    expect((events[0] as any).request.toolName).toBe('AskUserQuestion');
  }, 10_000);

  it('auto-approves bash tool in yolo mode (no permission.requested emitted)', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.currentSession!.emit('permission', makePermissionRequest('Bash'));
    await sleep(50);

    expect(events).toHaveLength(0);
    expect(adapter.respondToPermissionSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'allow' }));
  }, 10_000);

  it('does NOT auto-approve AskUserQuestion in yolo mode', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.currentSession!.emit(
      'permission',
      makePermissionRequest('AskUserQuestion', {
        input: { questions: [] },
      }),
    );
    await sleep(50);

    expect(events).toHaveLength(1);
    expect(adapter.respondToPermissionSpy).not.toHaveBeenCalled();
  }, 10_000);

  it('does NOT auto-approve ExitPlanMode in yolo mode', async () => {
    const adapter = new MockAdapter();
    const events = await setupAndResume(adapter, 'yolo');

    adapter.currentSession!.emit(
      'permission',
      makePermissionRequest('ExitPlanMode', {
        input: { plan: 'Step 1: ...' },
      }),
    );
    await sleep(50);

    expect(events).toHaveLength(1);
    expect(adapter.respondToPermissionSpy).not.toHaveBeenCalled();
  }, 10_000);

  it('WS permission.respond forwards response to adapter', async () => {
    const adapter = new MockAdapter();
    await setupAndResume(adapter, 'default');

    // Queue a permission so the adapter has a pending request
    adapter.currentSession!.emit(
      'permission',
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

    // Emit first permission
    adapter.currentSession!.emit(
      'permission',
      makePermissionRequest('Bash', { requestId: 'req-1', toolUseId: 'tu-1', input: { command: 'ls' } }),
    );
    await sleep(50);

    // Emit second permission — should be queued, NOT emitted yet
    adapter.currentSession!.emit(
      'permission',
      makePermissionRequest('Write', {
        requestId: 'req-2',
        toolUseId: 'tu-2',
        input: { file_path: 'a.ts', content: '' },
      }),
    );
    await sleep(50);

    // Only first emitted
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

    // Second now emitted
    expect(permissionEvents).toHaveLength(2);
    expect((permissionEvents[1] as any).request.requestId).toBe('req-2');
  }, 10_000);
});
