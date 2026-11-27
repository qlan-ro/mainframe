import { describe, expect, it, vi } from 'vitest';
import type { HistoryAroundResult } from '@qlan-ro/mainframe-types';
import { AroundWindow, type AroundHost } from '../acp-history-around';

function result(partial: Partial<HistoryAroundResult>): HistoryAroundResult {
  return { hasBefore: false, hasAfter: false, ...partial };
}

function rig(span: { before: number; after: number }) {
  const historyAround = vi.fn();
  const client = { connectionGeneration: 0, historyAround };
  const host = {
    chatId: () => 'chat',
    client: () => client,
    active: () => true,
    generation: () => 0,
    begin: vi.fn(),
    fail: vi.fn(),
    end: vi.fn(),
    trimLive: vi.fn(async () => true),
    show: vi.fn(),
    extendShown: vi.fn(),
    span: vi.fn(() => span),
    leave: vi.fn(),
    changed: vi.fn(),
  } as unknown as AroundHost & { show: ReturnType<typeof vi.fn> };
  return { window: new AroundWindow(host), historyAround, host };
}

describe('cutting a window again', () => {
  it('covers the span the window showed even when it is more than one request returns', async () => {
    const { window, historyAround, host } = rig({ before: 450, after: 30 });
    historyAround.mockResolvedValueOnce(
      result({ firstItemId: 'f0', lastItemId: 'l0', targetItemId: 'T', hasBefore: true, hasAfter: true }),
    );
    await window.open('T');
    historyAround.mockReset();
    historyAround
      .mockResolvedValueOnce(
        result({ firstItemId: 'f1', lastItemId: 'l1', targetItemId: 'T', hasBefore: true, hasAfter: true }),
      )
      .mockResolvedValueOnce(result({ firstItemId: 'f2', lastItemId: 'f1', hasBefore: true }))
      .mockResolvedValueOnce(result({ firstItemId: 'f3', lastItemId: 'f2', hasBefore: false }));
    host.show.mockClear();
    await window.resnapshot();
    // The target, 200 above and 30 below; then the rest above, from the new first item.
    expect(historyAround.mock.calls.map(([params]) => [params.itemId, params.before, params.after])).toEqual([
      ['T', 200, 30],
      ['f1', 200, 0],
      ['f2', 50, 0],
    ]);
    expect(host.show).toHaveBeenCalledTimes(1);
    expect(host.show.mock.calls[0]![1]).toHaveLength(2);
    expect(window.state).toMatchObject({ firstItemId: 'f3', hasBefore: false, lastItemId: 'l1', hasAfter: true });
  });

  it('does not ask for more above than the window held', async () => {
    const { window, historyAround } = rig({ before: 120, after: 80 });
    historyAround.mockResolvedValueOnce(result({ firstItemId: 'f', lastItemId: 'l', targetItemId: 'T' }));
    await window.open('T');
    historyAround.mockClear();
    historyAround.mockResolvedValueOnce(result({ firstItemId: 'f', lastItemId: 'l', targetItemId: 'T' }));
    await window.resnapshot();
    expect(historyAround).toHaveBeenCalledTimes(1);
    expect(historyAround.mock.calls[0]![0]).toMatchObject({ before: 120, after: 80 });
  });
});
