import { expect, it, vi } from 'vitest';
import {
  requestHistoryAround,
  requestHistoryPage,
  requestHistorySearch,
  requestSubagentExport,
} from '../acp-history-client';
import type { RpcConnection } from '../acp-rpc-connection';

it('requests the child page and passes the decoded response to the caller', async () => {
  const page = { hasMore: true, floorItemId: 'child-floor', updates: [] };
  const sendRequest = vi.fn((_method: string, _params: unknown, accept: (raw: unknown) => void) => {
    accept(page);
    return Promise.resolve(page);
  });
  const params = { sessionId: 'parent', agentId: 'call', before: 'cursor', untilItemId: 'target' };
  const accept = vi.fn();
  await requestHistoryPage({ sendRequest } as unknown as RpcConnection, params, accept);
  expect(sendRequest).toHaveBeenCalledWith('_mainframe.dev/subagent_history_page', params, expect.any(Function));
  expect(accept).toHaveBeenCalledWith(page);
});

it('finds saved child text without searching the parent session', async () => {
  const result = { total: 1, matches: [{ containerId: 'child', itemId: 'child-text', occurrence: 0 }] };
  const sendRequest = vi.fn().mockResolvedValue(result);
  await expect(
    requestHistorySearch({ sendRequest } as unknown as RpcConnection, 'parent', 'needle', 'call'),
  ).resolves.toEqual(result);
  expect(sendRequest).toHaveBeenCalledWith('_mainframe.dev/subagent_history_search', {
    sessionId: 'parent',
    agentId: 'call',
    query: 'needle',
  });
});

it('requests a full child export and preserves the Markdown verbatim', async () => {
  const sendRequest = vi.fn().mockResolvedValue({ markdown: '# Child\n\nSaved prose\n' });
  await expect(
    requestSubagentExport({ sendRequest } as unknown as RpcConnection, { sessionId: 'parent', agentId: 'call' }),
  ).resolves.toBe('# Child\n\nSaved prose\n');
  expect(sendRequest).toHaveBeenCalledWith('_mainframe.dev/subagent_history_export', {
    sessionId: 'parent',
    agentId: 'call',
  });
});

it('asks for one item with no neighbours and returns the window, batches decoded', async () => {
  const window = { hasBefore: true, hasAfter: false, targetItemId: 'item', updates: [] };
  const sendRequest = vi.fn((_method: string, _params: unknown, accept: (raw: unknown) => void) => {
    accept(window);
    return Promise.resolve(window);
  });
  const params = { sessionId: 'parent', itemId: 'call', before: 0, after: 0 };
  await expect(requestHistoryAround({ sendRequest } as unknown as RpcConnection, params)).resolves.toMatchObject({
    targetItemId: 'item',
  });
  expect(sendRequest).toHaveBeenCalledWith('_mainframe.dev/history_around', params, expect.any(Function));
});

it('rejects a window that carries two encodings', async () => {
  const bad = { hasBefore: false, hasAfter: false, updates: [], batches: [] };
  const sendRequest = vi.fn((_m: string, _p: unknown, accept: (raw: unknown) => void) => {
    accept(bad);
    return Promise.resolve(bad);
  });
  await expect(
    requestHistoryAround({ sendRequest } as unknown as RpcConnection, { sessionId: 's', itemId: 'i' }),
  ).rejects.toThrow('two update encodings');
});
