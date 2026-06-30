/**
 * A4 — LSP WS URL is built from the active daemon target.
 *
 * Asserts that `LspClientManager.ensureClient` opens a WebSocket against
 * the active target's host (not a hardcoded 127.0.0.1) and appends
 * `?token=<encoded>` only when the target carries a non-null token.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActiveDaemon } from '../../daemon/active-daemon';
import { LspClientManager } from '../lsp-client';

// ---------------------------------------------------------------------------
// Minimal URL-capturing WebSocket stub.
// Records every URL passed to the constructor; fires onopen synchronously so
// ensureClient's open-wait resolves immediately.  auto-responds to the LSP
// initialize request so ensureClient completes fully.
// ---------------------------------------------------------------------------

const capturedUrls: string[] = [];

type FakeMessageEvent = { data: string };

class FakeWS {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWS.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: FakeMessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    capturedUrls.push(url);
    // Fire onopen asynchronously so the ensureClient await has a chance to
    // set up its handlers before we call them.
    Promise.resolve()
      .then(() => {
        this.readyState = FakeWS.OPEN;
        this.onopen?.();
      })
      .catch(() => {
        /* never */
      });
  }

  send(data: string): void {
    // Auto-respond to the LSP initialize request so ensureClient resolves.
    try {
      const msg = JSON.parse(data) as { id?: number; method?: string };
      if (msg.method === 'initialize' && msg.id != null) {
        const id = msg.id;
        Promise.resolve()
          .then(() => {
            this.onmessage?.({
              data: JSON.stringify({ jsonrpc: '2.0', id, result: { capabilities: {} } }),
            });
          })
          .catch(() => {
            /* never */
          });
      }
    } catch {
      /* not JSON */
    }
  }

  close(): void {
    this.readyState = FakeWS.CLOSED;
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../api/files', () => ({
  resolvePath: vi.fn().mockResolvedValue({
    relative: '.',
    absolute: '/home/user/project',
    baseKind: 'project',
    basePath: '/home/user/project',
    contained: true,
  }),
}));

beforeEach(() => {
  capturedUrls.length = 0;
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
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
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A4 — LSP seam reads the active daemon target
// ---------------------------------------------------------------------------

describe('LspClientManager — A4: URL built from the active daemon target', () => {
  it('uses wss:// and appends ?token= when the active target is remote with a token', async () => {
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'Studio',
      baseUrl: 'https://studio.example.com',
      token: 'jwt',
    });

    const manager = new LspClientManager(0);
    await manager.ensureClient('p1', 'typescript', '/home/user/project');

    expect(capturedUrls[capturedUrls.length - 1]).toBe('wss://studio.example.com/lsp/p1/typescript?token=jwt');
  });

  it('uses ws:// and omits ?token= for a local target (token null)', async () => {
    setActiveDaemon({
      id: 'local',
      kind: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:31415',
      token: null,
    });

    const manager = new LspClientManager(31415);
    await manager.ensureClient('p1', 'typescript', '/home/user/project');

    // Local path still threads chatId QS only when provided; no token appended.
    expect(capturedUrls[capturedUrls.length - 1]).toBe('ws://127.0.0.1:31415/lsp/p1/typescript');
  });

  it('percent-encodes special characters in the token', async () => {
    setActiveDaemon({
      id: 'remote',
      kind: 'remote',
      label: 'Remote',
      baseUrl: 'https://remote.example.com',
      token: 'tok/en=val&other',
    });

    const manager = new LspClientManager(0);
    await manager.ensureClient('p1', 'typescript', '/home/user/project');

    // Hardcoded expected value — tok%2Fen%3Dval%26other
    expect(capturedUrls[capturedUrls.length - 1]).toBe(
      'wss://remote.example.com/lsp/p1/typescript?token=tok%2Fen%3Dval%26other',
    );
  });

  it('appends chatId before token when both are present', async () => {
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'Studio',
      baseUrl: 'https://studio.example.com',
      token: 'jwt',
    });

    const manager = new LspClientManager(0);
    await manager.ensureClient('p1', 'typescript', '/home/user/project', 'chat-99');

    expect(capturedUrls[capturedUrls.length - 1]).toBe(
      'wss://studio.example.com/lsp/p1/typescript?chatId=chat-99&token=jwt',
    );
  });
});
