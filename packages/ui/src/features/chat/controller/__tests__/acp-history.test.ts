import { describe, expect, it, vi } from 'vitest';
import { AcpHistory, type HistoryLoadState } from '../acp-history';
import { makeFakeAcpClient } from './acp-test-kit';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';

function fixture() {
  const client = makeFakeAcpClient({ capabilities: { windowedHistory: true, historySearch: true } });
  const held = new Set(['new']);
  let state: HistoryLoadState | undefined;
  let active = true;
  const apply = vi.fn((page: HistoryPageResult) => {
    if (page.updates?.length) held.add('old');
  });
  const history = new AcpHistory({
    chatId: () => 'chat',
    client: () => client,
    active: () => active,
    changed: (value) => {
      state = value;
    },
    prepend: apply,
    hasItem: (id) => held.has(id),
  });
  history.reset({ hasMore: true, floorItemId: 'new' });
  return {
    client,
    history,
    apply,
    held,
    state: () => state,
    detach: () => {
      active = false;
    },
  };
}

describe('windowed history loading', () => {
  it('applies the whole load-through synchronously and retains the lowered floor', async () => {
    const f = fixture();
    f.client.historyPage = vi.fn(async (params, apply) => {
      expect(params).toEqual({ sessionId: 'chat', before: 'new', containers: 40, untilItemId: 'old' });
      apply({
        hasMore: true,
        floorItemId: 'old',
        updates: [{ sessionUpdate: 'agent_message', messageId: 'old', content: [{ type: 'text', text: 'earlier' }] }],
      });
      expect(f.held.has('old')).toBe(true);
    });
    expect(await f.history.load('old')).toBe(true);
    expect(f.history.window({ type: 'revision', epoch: 'e', revision: 2 })).toEqual({ floorItemId: 'old' });
    expect(f.state()?.loading).toBe(false);
    await f.history.load('old');
    expect(f.client.historyPage).toHaveBeenCalledTimes(1);
  });

  it('drops a page after a replay changed the floor or the subscription detached', async () => {
    for (const invalidate of [
      (f: ReturnType<typeof fixture>) => f.history.reset({ hasMore: true, floorItemId: 'reset' }),
      (f: ReturnType<typeof fixture>) => f.detach(),
    ]) {
      const f = fixture();
      let complete!: () => void;
      f.client.historyPage = async (_, apply) =>
        new Promise<void>((resolve) => {
          complete = () => {
            apply({ hasMore: false, floorItemId: 'old', updates: [] });
            resolve();
          };
        });
      const pending = f.history.load();
      invalidate(f);
      complete();
      await pending;
      expect(f.apply).not.toHaveBeenCalled();
    }
  });

  it('retries stale pages only once and surfaces failures for the load action', async () => {
    const f = fixture();
    f.client.historyPage = vi.fn(async (_, apply) => {
      apply({ hasMore: true, stale: true, floorItemId: 'new' });
    });
    expect(await f.history.load()).toBe(false);
    expect(f.client.historyPage).toHaveBeenCalledTimes(2);
    f.client.historyPage = vi.fn().mockRejectedValue(new Error('disconnected'));
    await expect(f.history.load()).rejects.toThrow('disconnected');
    expect(f.state()).toMatchObject({ loading: false, error: 'disconnected' });
  });
});
