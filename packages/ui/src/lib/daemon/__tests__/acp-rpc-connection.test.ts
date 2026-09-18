/**
 * RpcConnection — deadline + close-rejects-pending behavior tests
 * (todo #350 plan review fixes, T29, R3.8).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RpcConnection, type AcpSocketLike } from '../acp-rpc-connection';

class FakeSocket implements AcpSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.onclose?.();
  }
}

async function openConnection(): Promise<{ conn: RpcConnection; socket: FakeSocket }> {
  const socket = new FakeSocket();
  const conn = new RpcConnection('ws://test', () => socket);
  const openPromise = conn.open();
  socket.onopen?.();
  await openPromise;
  return { conn, socket };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RpcConnection — close rejects pending requests', () => {
  it('a request in flight rejects when close() is called', async () => {
    const { conn } = await openConnection();
    const req = conn.sendRequest('session/prompt', {});

    conn.close();

    await expect(req).rejects.toMatchObject({ code: -32000 });
  });

  it('a request made after close() rejects immediately instead of writing to a dead connection', async () => {
    const { conn } = await openConnection();
    conn.close();

    await expect(conn.sendRequest('session/prompt', {})).rejects.toMatchObject({ code: -32000 });
  });
});

describe('RpcConnection — request deadline', () => {
  it('a request with no reply times out and rejects', async () => {
    vi.useFakeTimers();
    const { conn } = await openConnection();

    const req = conn.sendRequest('session/prompt', {});
    const assertion = expect(req).rejects.toMatchObject({ code: -32000 });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });

  it('a reply before the deadline clears the timer — no late rejection', async () => {
    vi.useFakeTimers();
    const { conn, socket } = await openConnection();

    const req = conn.sendRequest('session/prompt', {});
    const sent = socket.sent[socket.sent.length - 1] as { id: number };
    socket.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { ok: true } }) });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(req).resolves.toEqual({ ok: true });
  });
});
