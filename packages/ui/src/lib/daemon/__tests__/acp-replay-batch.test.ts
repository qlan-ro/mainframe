/**
 * `decodeReplayBatch` (spec Decision 42) and the router's fan-out of one
 * `_mainframe.dev/replay_batch` into ordered `session/update` deliveries.
 */
import { describe, expect, it, vi } from 'vitest';
import { strToU8, zlibSync } from 'fflate';
import { REPLAY_BATCH_ENCODING, type SessionUpdate } from '@qlan-ro/mainframe-types';
import { decodeReplayBatch } from '../acp-replay-batch';
import { AcpNotificationRouter } from '../acp-notification-router';

function chunk(id: string, text: string): SessionUpdate {
  return { sessionUpdate: 'agent_message_chunk', messageId: id, content: { type: 'text', text } };
}

function encode(entries: unknown[]): string {
  const bytes = zlibSync(strToU8(JSON.stringify(entries)));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function batch(entries: unknown[], overrides: Partial<{ encoding: string; count: number }> = {}) {
  return {
    sessionId: 'chat_1',
    encoding: REPLAY_BATCH_ENCODING,
    count: entries.length,
    data: encode(entries),
    ...overrides,
  };
}

describe('decodeReplayBatch', () => {
  it('round-trips the updates in order', () => {
    const updates = [chunk('m1', 'hello'), chunk('m2', 'world'), { sessionUpdate: 'state_update', state: 'idle' }];
    expect(decodeReplayBatch(batch(updates))).toEqual(updates);
  });

  it('drops a batch with an unknown encoding whole', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeReplayBatch(batch([chunk('m1', 'x')], { encoding: 'brotli+base64' }))).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('drops a batch whose data does not inflate to a JSON array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeReplayBatch({ ...batch([]), data: 'not base64 zlib' })).toBeUndefined();
    expect(decodeReplayBatch({ ...batch([]), data: encode([]).slice(0, 4) })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a malformed update inside the batch and keeps the rest, warning about the count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = decodeReplayBatch(batch([chunk('m1', 'a'), { sessionUpdate: 'nope' }, chunk('m2', 'b')]));
    expect(decoded).toEqual([chunk('m1', 'a'), chunk('m2', 'b')]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('AcpNotificationRouter — _mainframe.dev/replay_batch', () => {
  it('fans the batch out to the session/update listeners, in order, under the batch session id', () => {
    const router = new AcpNotificationRouter(vi.fn(), vi.fn());
    const listener = vi.fn();
    router.onSessionUpdate(listener);

    router.handleNotification({
      jsonrpc: '2.0',
      method: '_mainframe.dev/replay_batch',
      params: batch([chunk('m1', 'hello'), chunk('m2', 'world')]),
    });

    expect(listener.mock.calls).toEqual([
      ['chat_1', chunk('m1', 'hello')],
      ['chat_1', chunk('m2', 'world')],
    ]);
  });

  it('delivers nothing for a batch it cannot decode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const router = new AcpNotificationRouter(vi.fn(), vi.fn());
    const listener = vi.fn();
    router.onSessionUpdate(listener);

    router.handleNotification({
      jsonrpc: '2.0',
      method: '_mainframe.dev/replay_batch',
      params: batch([chunk('m1', 'hello')], { encoding: 'gzip' }),
    });
    router.handleNotification({ jsonrpc: '2.0', method: '_mainframe.dev/replay_batch', params: { nope: true } });

    expect(listener).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
