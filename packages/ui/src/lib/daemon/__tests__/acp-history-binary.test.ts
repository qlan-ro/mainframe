/** History results carrying `inflatedBatches` (binary frames) fold into `updates` with the same safety as base64 batches. */
import { describe, expect, it, vi } from 'vitest';
import { requestHistoryAround, requestHistoryPage } from '../acp-history-client';
import { initializeRequest } from '../acp-capability-state';
import type { RpcConnection } from '../acp-rpc-connection';

const update = (n: number) => ({ sessionUpdate: 'usage_update', used: n, size: 10 });

function connectionReturning(result: unknown) {
  const sendRequest = vi.fn((_method: string, _params: unknown, accept: (raw: unknown) => void) => {
    try {
      accept(result);
    } catch (error) {
      return Promise.reject(error); // as RpcConnection does for a throwing onSuccess
    }
    return Promise.resolve(result);
  });
  return { sendRequest } as unknown as RpcConnection;
}

describe('inflated batches', () => {
  it('become the page updates, in order, with each update validated', async () => {
    const accepted = vi.fn();
    const result = {
      hasMore: true,
      floorItemId: 'f',
      inflatedBatches: [
        { count: 2, updates: [update(1), update(2)] },
        { count: 1, updates: [update(3)] },
      ],
    };
    await requestHistoryPage(connectionReturning(result), { sessionId: 's', before: 'f' }, accepted);
    expect(accepted.mock.calls[0]![0].updates).toEqual([update(1), update(2), update(3)]);
  });

  it('fail the whole page when one update is malformed or the count is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { sessionUpdate: 'usage_update', used: 'many', size: 10 };
    for (const batch of [
      { count: 2, updates: [update(1), bad] },
      { count: 2, updates: [update(1)] },
      { count: 1, updates: [{ sessionUpdate: 'who_knows' }] },
    ]) {
      const accepted = vi.fn();
      const result = { hasMore: false, inflatedBatches: [batch] };
      await expect(
        requestHistoryPage(connectionReturning(result), { sessionId: 's', before: 'f' }, accepted),
      ).rejects.toThrow(/batch/);
      expect(accepted).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it('are refused next to another encoding', async () => {
    const result = { hasBefore: false, hasAfter: false, updates: [], inflatedBatches: [] };
    await expect(requestHistoryAround(connectionReturning(result), { sessionId: 's', itemId: 'i' })).rejects.toThrow(
      /two update encodings/,
    );
  });

  it('serve history_around too', async () => {
    const result = { hasBefore: false, hasAfter: true, inflatedBatches: [{ count: 1, updates: [update(9)] }] };
    const window = await requestHistoryAround(connectionReturning(result), { sessionId: 's', itemId: 'i' });
    expect(window.updates).toEqual([update(9)]);
  });
});

describe('initializeRequest', () => {
  it('opts into binary history frames where the platform can inflate them', () => {
    const meta = initializeRequest({ name: 'x', version: '1' })._meta!['_mainframe.dev'] as Record<string, unknown>;
    expect(meta.binaryHistoryFrames).toBe(true);
    expect(meta.compressedReplay).toBe(true);
  });

  it('does not opt in without DecompressionStream', () => {
    vi.stubGlobal('DecompressionStream', undefined);
    const meta = initializeRequest({ name: 'x', version: '1' })._meta!['_mainframe.dev'] as Record<string, unknown>;
    vi.unstubAllGlobals();
    expect('binaryHistoryFrames' in meta).toBe(false);
  });
});
