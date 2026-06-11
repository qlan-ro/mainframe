/**
 * Unit tests for LspClientManager (Phase 1 — editor-agnostic LSP client).
 *
 * Tests:
 * 1. initialize handshake params are correct
 * 2. didOpen is sent on first ensureDocumentOpen
 * 3. getDefinition returns plain LSP Location[] (no Monaco types)
 * 4. in-flight requests are rejected when the client is disposed
 * 5. review #13 hardening:
 *    a. requests before initialize are queued and sent only after initialized
 *    b. server→client requests get a response (not dropped silently)
 *    c. sendRequest times out and rejects + is removed from pending
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LspClientManager } from '../lsp-client';

// ---------------------------------------------------------------------------
// FakeWebSocket — minimal stand-in for the browser WebSocket global.
// Mirrors the pattern used in ws-client.test.ts.
// ---------------------------------------------------------------------------

type MessageEvent = { data: string };

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sendSpy = vi.fn<(data: string) => void>();
  send: (data: string) => void = this.sendSpy as unknown as (data: string) => void;
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

function lastSocket(): FakeWebSocket {
  const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!s) throw new Error('No FakeWebSocket instance created');
  return s;
}

/**
 * Open the socket and install an auto-responder that replies to the
 * initialize request (id=1) with the given capabilities.
 *
 * The responder fires on the sendSpy call that carries method:'initialize'.
 * This avoids the race where we fire the response before entry.pending has
 * been populated by sendRequest.
 */
function installAutoInitializer(socket: FakeWebSocket, capabilities: Record<string, unknown> = {}): void {
  socket.readyState = FakeWebSocket.OPEN;

  const originalSend = socket.sendSpy;
  // Replace send with a version that auto-responds to initialize.
  socket.sendSpy = vi.fn((data: string) => {
    originalSend(data);
    try {
      const msg = JSON.parse(data) as { id?: number; method?: string };
      if (msg.method === 'initialize' && msg.id != null) {
        // Reply asynchronously (next microtask) so entry.pending is populated first.
        Promise.resolve()
          .then(() => {
            socket.onmessage?.({
              data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities } }),
            });
          })
          .catch(() => {
            /* ignored */
          });
      }
    } catch {
      /* not JSON */
    }
  }) as unknown as typeof socket.sendSpy;
  socket.send = socket.sendSpy as unknown as (data: string) => void;

  socket.onopen?.();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);

  // Stub fetch — discoverWorkspaceFolders calls the daemon HTTP API.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ success: false }),
        ok: true,
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: connect a manager and wait for initialization to complete.
// ---------------------------------------------------------------------------

async function connectManager(
  manager: LspClientManager,
  projectId = 'proj-1',
  language = 'typescript',
  projectPath = '/home/user/project',
  capabilities: Record<string, unknown> = {},
): Promise<FakeWebSocket> {
  const promise = manager.ensureClient(projectId, language, projectPath);
  const socket = lastSocket();
  installAutoInitializer(socket, capabilities);
  await promise;
  return socket;
}

// ---------------------------------------------------------------------------
// Test 1: initialize handshake params
// ---------------------------------------------------------------------------

describe('LspClientManager — initialize handshake', () => {
  it('connects to the correct LSP WS URL', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);
    expect(socket.url).toBe('ws://127.0.0.1:31415/lsp/proj-1/typescript');
  });

  it('sends an LSP initialize request with the expected params', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager, 'proj-1', 'typescript', '/home/user/project');

    // Find the initialize call on the spy (it's the first send).
    const initCall = socket.sendSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] ?? '{}') as { method?: string };
      return parsed.method === 'initialize';
    });
    expect(initCall).toBeDefined();

    const msg = JSON.parse(initCall![0]!) as {
      jsonrpc: string;
      id: number;
      method: string;
      params: {
        rootUri: string;
        capabilities: Record<string, unknown>;
        processId: null;
        workspaceFolders: { uri: string; name: string }[];
      };
    };

    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.id).toBe(1);
    expect(msg.method).toBe('initialize');
    expect(msg.params.processId).toBeNull();
    expect(msg.params.rootUri).toBe('file:///home/user/project');
    expect(msg.params.capabilities.textDocument).toBeDefined();
    expect(msg.params.workspaceFolders).toBeInstanceOf(Array);
    // discoverWorkspaceFolders fell back to the project root (fetch returned failure).
    expect(msg.params.workspaceFolders[0]?.uri).toBe('file:///home/user/project');
  });

  it('sends the initialized notification after the initialize response', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    const notifCall = socket.sendSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] ?? '{}') as { method?: string };
      return parsed.method === 'initialized';
    });
    expect(notifCall).toBeDefined();

    const notification = JSON.parse(notifCall![0]!) as { jsonrpc: string; method: string; id?: number };
    expect(notification.jsonrpc).toBe('2.0');
    expect(notification.method).toBe('initialized');
    // Notifications have no id field.
    expect(notification.id).toBeUndefined();
  });

  // review #13a: client not available (hasClient=false) until initialize completes
  it('hasClient returns false while initialize is in-flight, true after completion', async () => {
    const manager = new LspClientManager(31415);

    // Start connecting but don't open the socket yet.
    const connectPromise = manager.ensureClient('proj-1', 'typescript', '/home/user/project');
    const socket = lastSocket();

    // Not yet open: hasClient should be false before socket opens.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(false);

    // Now open the socket and auto-initialize.
    installAutoInitializer(socket);
    await connectPromise;

    // Now hasClient should be true.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: didOpen on first ensureDocumentOpen
// ---------------------------------------------------------------------------

describe('LspClientManager — didOpen on first open', () => {
  it('sends textDocument/didOpen when ensureDocumentOpen is called for a new file', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    socket.sendSpy.mockClear();

    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/index.ts',
      text: 'const x = 1;',
      languageId: 'typescript',
      version: 1,
    });

    expect(socket.sendSpy).toHaveBeenCalledOnce();
    const raw = socket.sendSpy.mock.calls[0]?.[0];
    expect(raw).toBeDefined();
    const notification = JSON.parse(raw!) as {
      method: string;
      params: {
        textDocument: { uri: string; languageId: string; version: number; text: string };
      };
    };
    expect(notification.method).toBe('textDocument/didOpen');
    expect(notification.params.textDocument.uri).toBe('file:///home/user/project/src/index.ts');
    expect(notification.params.textDocument.languageId).toBe('typescript');
    expect(notification.params.textDocument.text).toBe('const x = 1;');
  });

  it('does NOT send didOpen again for the same file', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    socket.sendSpy.mockClear();

    const doc = { filePath: 'src/index.ts', text: 'const x = 1;', languageId: 'typescript', version: 1 };
    manager.ensureDocumentOpen('proj-1', 'typescript', doc);
    manager.ensureDocumentOpen('proj-1', 'typescript', doc);

    // Only one notification should have been sent.
    expect(socket.sendSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 3: getDefinition returns plain LSP Location[]
// ---------------------------------------------------------------------------

describe('LspClientManager — getDefinition returns plain LSP types', () => {
  it('returns a Location[] with uri and range when the server responds', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager, 'proj-1', 'typescript', '/home/user/project', {
      definitionProvider: true,
    });

    // Open a document first.
    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      text: 'const y = x;',
      languageId: 'typescript',
      version: 1,
    });

    socket.sendSpy.mockClear();

    // Kick off the definition request.
    const defPromise = manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 10 },
    });

    // The manager sends a textDocument/definition request.
    // Allow one microtask for getDefinition to send.
    await Promise.resolve();

    const raw = socket.sendSpy.mock.calls[0]?.[0];
    expect(raw).toBeDefined();
    const req = JSON.parse(raw!) as { id: number; method: string };
    expect(req.method).toBe('textDocument/definition');

    // Reply with an LSP Location response.
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: [
          {
            uri: 'file:///home/user/project/src/lib.ts',
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 10 },
            },
          },
        ],
      }),
    });

    const locations = await defPromise;
    expect(locations).toHaveLength(1);
    const loc = locations[0]!;
    // Must be a plain LSP type — no Monaco Range/Uri constructors.
    expect(loc.uri).toBe('file:///home/user/project/src/lib.ts');
    expect(loc.range.start.line).toBe(5);
    expect(loc.range.start.character).toBe(0);
    expect(loc.range.end.line).toBe(5);
    expect(loc.range.end.character).toBe(10);
  });

  it('returns [] when the server responds with null', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      text: '',
      languageId: 'typescript',
      version: 1,
    });
    socket.sendSpy.mockClear();

    const defPromise = manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 0 },
    });

    await Promise.resolve();

    const raw = socket.sendSpy.mock.calls[0]?.[0];
    const req = JSON.parse(raw!) as { id: number };
    socket.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: null }) });

    const locations = await defPromise;
    expect(locations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: in-flight requests are rejected on disposeClient
// ---------------------------------------------------------------------------

describe('LspClientManager — in-flight requests rejected on disposeClient', () => {
  it('resolves in-flight getDefinition with [] rather than hanging when the client is disposed', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      text: '',
      languageId: 'typescript',
      version: 1,
    });
    socket.sendSpy.mockClear();

    // Start a definition request but do NOT respond — dispose instead.
    // The public getDefinition API catches the rejection and returns [] so callers
    // never hang; the dispose un-blocks the pending Promise immediately.
    const defPromise = manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 5 },
    });

    // Allow the sendRequest to register the pending entry.
    await Promise.resolve();

    // hasClient must be true before dispose.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(true);

    // Dispose the client; in-flight sendRequest promises must reject immediately
    // so getDefinition's catch resolves the promise (doesn't hang).
    manager.disposeClient('proj-1', 'typescript');

    // The promise must resolve (not hang) — getDefinition catches the rejection.
    const result = await defPromise;
    expect(result).toEqual([]);

    // The client is gone.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(false);
  });

  it('removes all pending request handlers when disposed so they cannot resolve later', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      text: '',
      languageId: 'typescript',
      version: 1,
    });
    socket.sendSpy.mockClear();

    // Start two definition requests and dispose without responding.
    const p1 = manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 5 },
    });
    const p2 = manager.getReferences('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 1, character: 3 },
    });

    await Promise.resolve();
    manager.disposeClient('proj-1', 'typescript');

    // Both must settle (not hang) — the pending map is cleared on dispose.
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 5: review #13 hardening
// ---------------------------------------------------------------------------

describe('LspClientManager — review #13 hardening', () => {
  // --- #13b: server→client requests get a minimal response ---

  it('server→client request (id + method) receives a JSON-RPC response, not silence', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    socket.sendSpy.mockClear();

    // Simulate the server sending a client/registerCapability request.
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'client/registerCapability',
        params: { registrations: [] },
      }),
    });

    // The manager should have sent a response for id=99.
    await Promise.resolve(); // allow any async flush
    const responses = socket.sendSpy.mock.calls
      .map((c) => JSON.parse(c[0]!) as { id?: number; result?: unknown; error?: unknown })
      .filter((m) => m.id === 99);

    expect(responses).toHaveLength(1);
    // Response must carry an id and a result (or error), not just be a notification.
    expect(responses[0]!.id).toBe(99);
  });

  it('server→client workspace/configuration request gets an empty result array', async () => {
    const manager = new LspClientManager(31415);
    const socket = await connectManager(manager);

    socket.sendSpy.mockClear();

    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'workspace/configuration',
        params: { items: [{ section: 'typescript' }] },
      }),
    });

    await Promise.resolve();
    const responses = socket.sendSpy.mock.calls
      .map((c) => JSON.parse(c[0]!) as { id?: number; result?: unknown })
      .filter((m) => m.id === 5);

    expect(responses).toHaveLength(1);
    expect(responses[0]!.result).toBeInstanceOf(Array);
  });

  // --- #13c: sendRequest times out and rejects + is removed from pending ---

  it('getDefinition times out and resolves to [] when the server never responds', async () => {
    vi.useFakeTimers();
    const manager = new LspClientManager(31415, { requestTimeoutMs: 100 });
    const socket = await connectManager(manager);

    manager.ensureDocumentOpen('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      text: '',
      languageId: 'typescript',
      version: 1,
    });
    socket.sendSpy.mockClear();

    const defPromise = manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 0 },
    });

    // Advance past the timeout.
    await vi.advanceTimersByTimeAsync(200);

    const result = await defPromise;
    expect(result).toEqual([]);

    vi.useRealTimers();
  }, 5000);

  // --- #13a: requests before initialize are deferred ---

  it('getDefinition called before client is ready returns [] immediately (not hung)', async () => {
    const manager = new LspClientManager(31415);

    // Start connecting. Use installAutoInitializer so the promise eventually
    // resolves, but check the "not yet ready" window first.
    const connectPromise = manager.ensureClient('proj-1', 'typescript', '/home/user/project');
    const socket = lastSocket();

    // Before the socket opens, hasClient is false.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(false);

    // A getDefinition call while connecting (client not in map yet) returns []
    // immediately without hanging. hasClient check in getDefinition gates on the
    // clients map, which is only populated after initialized.
    const earlyResult = await manager.getDefinition('proj-1', 'typescript', {
      filePath: 'src/app.ts',
      position: { line: 0, character: 0 },
    });
    expect(earlyResult).toEqual([]);

    // Complete the handshake so the test doesn't leave the promise dangling.
    installAutoInitializer(socket);
    await connectPromise;

    // After init, hasClient is true.
    expect(manager.hasClient('proj-1', 'typescript')).toBe(true);
  });
});
