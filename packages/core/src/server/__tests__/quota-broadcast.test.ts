import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../websocket.js';
import type { ChatManager } from '../../chat/index.js';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { QuotaManager } from '../../quota/manager.js';

/**
 * Seam-3 transport: a harvested quota must reach every connected client account-wide,
 * even one that has subscribed to no chat (the gauge is not a per-chat concern).
 */
describe('provider quota transport', () => {
  let server: Server;
  let manager: WebSocketManager;
  let port: number;

  function makeSettings() {
    const store = new Map<string, string>();
    return {
      get: (c: string, k: string) => store.get(`${c} ${k}`) ?? null,
      getByCategory: () => ({}),
      set: (c: string, k: string, v: string) => void store.set(`${c} ${k}`, v),
    };
  }

  const quotaBlob: ProviderQuota = {
    status: 'ok',
    observedAt: 1_700_000_000_000,
    modelWindows: [],
    session: { kind: 'session', usedPercent: 55, resetsAt: 1_700_010_000_000 },
    accountIdentity: 'uuid-1',
  };

  beforeEach(async () => {
    server = createServer();
    manager = new WebSocketManager(server, {} as ChatManager);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('delivers provider.quota.updated to a client subscribed to no chat', async () => {
    const quota = new QuotaManager({ settings: makeSettings(), emitEvent: (e) => manager.broadcastEvent(e) });
    const ws = await connectWs(port);
    const received = collectMessages(ws);

    quota.ingest('claude', quotaBlob, 'pull');

    const messages = await received;
    const event = messages.find((m) => m.type === 'provider.quota.updated');
    expect(event).toBeDefined();
    expect(event.adapterId).toBe('claude');
    expect(event.quota.session.usedPercent).toBe(55);
    ws.close();
  });

  it('hasClients reflects live connections for the cadence gate', async () => {
    expect(manager.hasClients()).toBe(false);
    const ws = await connectWs(port);
    await waitFor(() => manager.hasClients());
    expect(manager.hasClients()).toBe(true);
    ws.close();
  });
});

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collectMessages(ws: WebSocket, windowMs = 150): Promise<any[]> {
  const out: any[] = [];
  const onMessage = (data: unknown) => out.push(JSON.parse(String(data)));
  ws.on('message', onMessage);
  return new Promise((resolve) => {
    setTimeout(() => {
      ws.off('message', onMessage);
      resolve(out);
    }, windowMs);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
