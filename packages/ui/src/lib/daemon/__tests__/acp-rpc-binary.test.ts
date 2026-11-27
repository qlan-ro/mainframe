/**
 * Binary history responses on `RpcConnection`: frames tied to a response by
 * request id, in any order and interleaved with other traffic, a corrupt or
 * inconsistent frame, and the old text form untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcConnection, type AcpSocketLike } from '../acp-rpc-connection';
import {
  binaryFrame,
  binaryFramesFor,
  binaryResponseFrame,
  deflateBatch,
  syntheticUpdates,
} from './support/synthetic-history';

class FakeSocket implements AcpSocketLike {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {
    this.onclose?.();
  }
  receive(data: string | ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

async function open() {
  const socket = new FakeSocket();
  const conn = new RpcConnection('ws://test', () => socket);
  const opening = conn.open();
  socket.onopen?.();
  await opening;
  const notes: string[] = [];
  conn.onNotification((note) => notes.push(note.method));
  return { conn, socket, notes };
}

/** Many small updates, so a response spans several 256-update frames. */
const many = (bytes: number, seed = 1) => syntheticUpdates(bytes, seed, [200, 600]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const note = (method: string) => JSON.stringify({ jsonrpc: '2.0', method, params: {} });

afterEach(() => vi.useRealTimers());

describe('binary history responses', () => {
  it('asks the socket for ArrayBuffers', async () => {
    expect((await open()).socket.binaryType).toBe('arraybuffer');
  });

  it('delivers the inflated batches once the frames that follow the response are in', async () => {
    const { conn, socket } = await open();
    const updates = many(700_000);
    const frames = binaryFramesFor('1', updates);
    expect(frames.length).toBeGreaterThan(1);
    const accepted = vi.fn();
    const request = conn.sendRequest('m', {}, accepted);
    socket.receive(binaryResponseFrame(1, frames.length));
    await settle();
    expect(accepted).not.toHaveBeenCalled(); // still waiting for frames
    frames.forEach((frame) => socket.receive(frame));
    const result = (await request) as {
      batchFrames?: number;
      inflatedBatches: { count: number; updates: unknown[] }[];
    };
    expect(result.batchFrames).toBeUndefined();
    expect(result.inflatedBatches.flatMap((batch) => batch.updates)).toEqual(updates);
    expect(accepted).toHaveBeenCalledOnce();
  });

  it('accepts frames that arrive before the response, in any order', async () => {
    const { conn, socket } = await open();
    const updates = many(700_000);
    const frames = binaryFramesFor('1', updates);
    const request = conn.sendRequest('m', {});
    [...frames].reverse().forEach((frame) => socket.receive(frame));
    socket.receive(binaryResponseFrame(1, frames.length));
    const result = (await request) as { inflatedBatches: { updates: unknown[] }[] };
    expect(result.inflatedBatches.flatMap((batch) => batch.updates)).toEqual(updates);
  });

  it('keeps frames of two requests apart and keeps other messages in order around an inflating response', async () => {
    const { conn, socket, notes } = await open();
    const first = many(300_000, 1);
    const second = many(300_000, 2);
    const order: string[] = [];
    const one = conn.sendRequest('m', {}, () => order.push('first applied'));
    const two = conn.sendRequest('m', {}, () => order.push('second applied'));
    const framesOne = binaryFramesFor('1', first);
    const framesTwo = binaryFramesFor('2', second);
    socket.receive(note('before'));
    socket.receive(framesTwo[0]!);
    socket.receive(binaryResponseFrame(1, framesOne.length));
    socket.receive(note('mid')); // arrives while response 1 waits for its frames: not held back
    framesOne.forEach((frame) => socket.receive(frame));
    socket.receive(note('after-first')); // arrives while response 1 inflates: must wait for it
    socket.receive(binaryResponseFrame(2, framesTwo.length));
    framesTwo.slice(1).forEach((frame) => socket.receive(frame));
    const [a, b] = (await Promise.all([one, two])) as { inflatedBatches: { updates: unknown[] }[] }[];
    expect(a!.inflatedBatches.flatMap((batch) => batch.updates)).toEqual(first);
    expect(b!.inflatedBatches.flatMap((batch) => batch.updates)).toEqual(second);
    await settle();
    expect(notes).toEqual(['before', 'mid', 'after-first']);
    expect(order).toEqual(['first applied', 'second applied']);
  });

  it('applies a page before a notification that followed it on the wire', async () => {
    const { conn, socket } = await open();
    const events: string[] = [];
    conn.onNotification((n) => events.push(n.method));
    const frames = binaryFramesFor('1', many(500_000));
    const request = conn.sendRequest('m', {}, () => events.push('page applied'));
    frames.forEach((frame) => socket.receive(frame));
    socket.receive(binaryResponseFrame(1, frames.length));
    socket.receive(note('live/update'));
    await request;
    await settle();
    expect(events).toEqual(['page applied', 'live/update']);
  });

  it('delivers held messages in order even when an earlier listener throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { conn, socket } = await open();
    const seen: string[] = [];
    conn.onNotification((n) => {
      if (n.method === 'a') throw new Error('listener failed');
      seen.push(n.method);
    });
    const frames = binaryFramesFor('1', many(300_000));
    const request = conn.sendRequest('m', {});
    frames.forEach((frame) => socket.receive(frame));
    socket.receive(binaryResponseFrame(1, frames.length));
    socket.receive(note('a'));
    socket.receive(note('b'));
    await request;
    await settle();
    expect(seen).toEqual(['b']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers a page with no updates (batchFrames 0) without waiting', async () => {
    const { conn, socket } = await open();
    const request = conn.sendRequest('m', {});
    socket.receive(binaryResponseFrame(1, 0));
    await expect(request).resolves.toMatchObject({ inflatedBatches: [], hasMore: true });
  });

  it('fails the request whole on a corrupt frame, and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { conn, socket, notes } = await open();
    const good = binaryFramesFor('1', many(300_000));
    const accepted = vi.fn();
    const request = conn.sendRequest('m', {}, accepted);
    const corrupt = deflateBatch([{ a: 1 }]);
    corrupt[4] = corrupt[4]! ^ 0xff;
    socket.receive(binaryFrame('1', 0, 2, 1, corrupt));
    socket.receive(good[0]!);
    socket.receive(binaryResponseFrame(1, 2));
    await expect(request).rejects.toMatchObject({
      code: -32000,
      message: expect.stringContaining('binary history frame'),
    });
    expect(accepted).not.toHaveBeenCalled();
    socket.receive(note('still-alive'));
    expect(notes).toEqual(['still-alive']);
    warn.mockRestore();
  });

  it('rejects a response whose frames disagree about the total or repeat an index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { conn, socket } = await open();
    const frames = binaryFramesFor('1', syntheticUpdates(100_000));
    expect(frames).toHaveLength(1);
    const wrongTotal = conn.sendRequest('m', {});
    socket.receive(frames[0]!);
    socket.receive(binaryResponseFrame(1, 2));
    await expect(wrongTotal).rejects.toMatchObject({ code: -32000 });

    const duplicate = conn.sendRequest('m', {});
    const again = binaryFramesFor('2', syntheticUpdates(100_000));
    socket.receive(again[0]!);
    socket.receive(again[0]!);
    await expect(duplicate).rejects.toMatchObject({ code: -32000 });
    warn.mockRestore();
  });

  it('drops an unreadable frame and a frame for a request nobody is waiting for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { conn, socket } = await open();
    socket.receive(new ArrayBuffer(3));
    socket.receive(binaryFramesFor('99', syntheticUpdates(10_000))[0]!);
    const request = conn.sendRequest('m', {});
    socket.receive(binaryResponseFrame(1, 0));
    await expect(request).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('times out a response whose frames never arrive, and rejects it on close', async () => {
    vi.useFakeTimers();
    const { conn, socket } = await open();
    const lost = conn.sendRequest('m', {});
    const lostResult = lost.catch((reason: unknown) => reason);
    socket.receive(binaryResponseFrame(1, 3));
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(lostResult).resolves.toMatchObject({ message: 'request timed out' });

    const closed = conn.sendRequest('m', {});
    const closedResult = closed.catch((reason: unknown) => reason);
    socket.receive(binaryResponseFrame(2, 1));
    conn.close();
    await expect(closedResult).resolves.toMatchObject({ code: -32000 });
  });

  it('leaves the text form untouched', async () => {
    const { conn, socket } = await open();
    const request = conn.sendRequest('m', {});
    socket.receive(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { batches: [], updates: undefined, hasMore: false } }),
    );
    await expect(request).resolves.toEqual({ batches: [], hasMore: false });
  });
});
