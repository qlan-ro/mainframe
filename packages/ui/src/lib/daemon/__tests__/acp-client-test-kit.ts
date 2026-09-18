import { AcpFacadeClient } from '../acp-client';
import type { AcpSocketLike } from '../acp-rpc-connection';

// ---------------------------------------------------------------------------
// FakeSocket — constructor-injected stand-in for the WS transport. Unlike
// ws-client.test.ts's global `vi.stubGlobal('WebSocket', ...)`, AcpFacadeClient
// takes its socket factory as a constructor dep (advisor guidance: injectable,
// not global monkey-patching) — so tests just pass one in.
// ---------------------------------------------------------------------------

export class FakeSocket implements AcpSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

export function initializeResult(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    info: { name: 'mainframe-daemon', version: '1.0.0' },
    capabilities: { session: {} },
    _meta: { '_mainframe.dev': { heartbeatIntervalMs: 15000 } },
    ...overrides,
  };
}

/**
 * `socket.open()` resolves `RpcConnection.open()`'s promise, but `connect()`'s
 * `await` only resumes on the next microtask — a plain `await Promise.resolve()`
 * flushes it (fake timers only intercept macrotasks, not microtasks) so
 * `socket.sent` is populated before the caller reads it.
 */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/** Connects a client against a fresh FakeSocket, auto-answering `initialize`. */
export async function connectedClient(): Promise<{ client: AcpFacadeClient; socket: FakeSocket }> {
  const socket = new FakeSocket();
  const client = new AcpFacadeClient('mock-cli', { url: () => 'ws://test/acp/mock-cli', createSocket: () => socket });
  const connectPromise = client.connect();
  socket.open();
  await flushMicrotasks();
  const initReq = socket.sent[0] as { id: number };
  socket.receive({ jsonrpc: '2.0', id: initReq.id, result: initializeResult() });
  await connectPromise;
  return { client, socket };
}
