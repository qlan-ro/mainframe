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

function createMockDbWithTracking() {
  const modifiedFiles: string[] = [];
  return {
    db: {
      chats: {
        get: vi.fn().mockReturnValue({
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
        }),
        create: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        update: vi.fn(),
        addPlanFile: vi.fn().mockReturnValue(false),
        addSkillFile: vi.fn().mockReturnValue(false),
        addMention: vi.fn().mockReturnValue(false),
        getMentions: vi.fn().mockReturnValue([]),
        getModifiedFilesList: vi.fn(() => [...modifiedFiles]),
        getPlanFiles: vi.fn().mockReturnValue([]),
        getSkillFiles: vi.fn().mockReturnValue([]),
        addModifiedFile: vi.fn((chatId: string, filePath: string) => {
          if (!modifiedFiles.includes(filePath)) {
            modifiedFiles.push(filePath);
            return true;
          }
          return false;
        }),
      },
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: '/tmp/test' }),
        list: vi.fn().mockReturnValue([{ id: 'proj-1', name: 'Test', path: '/tmp/test' }]),
        getByPath: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        remove: vi.fn(),
        updateLastOpened: vi.fn(),
      },
      settings: {
        get: vi.fn().mockReturnValue(null),
        getByCategory: vi.fn().mockReturnValue({}),
      },
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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    const wsRef: { current: WebSocketManager | null } = { current: null };
    const chats = new ChatManager(db as any, registry, undefined, (event) => wsRef.current?.broadcastEvent(event));
    const app = createHttpServer(db as any, chats, registry);
    server = createServer(app);
    wsRef.current = new WebSocketManager(server, chats);
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
    adapter.currentSession!.simulateMessage([
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
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/proj-1/diff?source=session&chatId=test-chat`);
    const json = await res.json();
    expect(json.source).toBe('session');
    expect(json.files).toContain('src/main.ts');
  }, 10_000);
});
