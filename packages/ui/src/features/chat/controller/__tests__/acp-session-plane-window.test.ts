import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryAroundResult, SessionUpdate } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import type { ChatStateEvent } from '../chat-thread-state';
import type { HistoryLoadState } from '../acp-history';
import { AcpSessionPlane } from '../acp-session-plane';
import { makeFakeAcpClient, type FakeAcpClient } from './acp-test-kit';

const CHAT = 'chat';

/** One whole turn per index: a user message and the answer to it. */
function turn(n: number): SessionUpdate[] {
  return [
    { sessionUpdate: 'user_message', messageId: `u${n}`, content: [{ type: 'text', text: `ask ${n}` }] },
    { sessionUpdate: 'agent_message', messageId: `a${n}`, content: [{ type: 'text', text: `answer ${n}` }] },
  ].map((update) => ({
    ...update,
    _meta: { '_mainframe.dev': { containerId: update.messageId } },
  })) as SessionUpdate[];
}

function around(
  turns: number[],
  flags: { hasBefore: boolean; hasAfter: boolean },
  target?: string,
): HistoryAroundResult {
  const updates = turns.flatMap(turn);
  const last = updates[updates.length - 1] as { messageId: string };
  const first = updates[0] as { messageId: string };
  return {
    updates,
    ...flags,
    firstItemId: first.messageId,
    lastItemId: last.messageId,
    targetItemId: target,
  };
}

interface Harness {
  plane: AcpSessionPlane;
  client: FakeAcpClient;
  events: ChatStateEvent[];
  messageIds(): string[];
  history(): HistoryLoadState;
  historyAround: ReturnType<typeof vi.fn>;
  historyPage: ReturnType<typeof vi.fn>;
}

/** `grown`: the window holds six turns, as after paging back; otherwise it holds the newest page (turns 5 and 6). */
async function harness(options: { capable?: boolean; grown?: boolean } = {}): Promise<Harness> {
  const events: ChatStateEvent[] = [];
  const client = makeFakeAcpClient({
    capabilities: { windowedHistory: true, ...(options.capable === false ? {} : { historyAround: true }) },
  });
  const historyAround = vi.fn();
  const historyPage = vi.fn();
  client.historyAround = historyAround as unknown as FakeAcpClient['historyAround'];
  client.historyPage = historyPage as unknown as FakeAcpClient['historyPage'];
  const plane = new AcpSessionPlane({
    getChatId: () => CHAT,
    dispatch: (e) => events.push(e),
    isDisposed: () => false,
  });
  await plane.attach(client);
  // Six turns of live items, newest page is two turns.
  for (const n of [1, 2, 3, 4, 5, 6]) for (const update of turn(n)) client.emitUpdate(CHAT, update);
  plane.history.reset({ hasMore: true, floorItemId: 'u1' });
  if (options.grown !== true) plane.history.trim();
  events.length = 0;
  return {
    plane,
    client,
    events,
    historyAround,
    historyPage,
    messageIds: () => {
      const updates = events.filter((e) => e.type === 'transcript.updated');
      const last = updates[updates.length - 1];
      return last?.type === 'transcript.updated' ? last.messages.map((m) => String(m.id)) : [];
    },
    history: () => {
      const states = events.filter((e) => e.type === 'history.window');
      const last = states[states.length - 1];
      if (last?.type !== 'history.window') throw new Error('no history state yet');
      return last.history;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  useUiPrefs.setState({ plainTranscript: true, historyTurns: 2 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useUiPrefs.setState({ plainTranscript: false });
});

describe('trim when the reader returns to the tail', () => {
  it('cuts the window back to the newest page and moves the floor with it', async () => {
    const h = await harness({ grown: true });
    expect(h.plane.history.trim()).toBe(true);
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(h.history()).toMatchObject({ hasMore: true, floorItemId: 'u5', loading: false });
  });

  it('pages above the new floor the usual way', async () => {
    const h = await harness({ grown: true });
    h.plane.history.trim();
    h.historyPage.mockImplementation(async (_params, apply) =>
      apply({ hasMore: true, floorItemId: 'u3', updates: [...turn(3), ...turn(4)] }),
    );
    await h.plane.history.load();
    expect(h.historyPage.mock.calls[0]![0]).toMatchObject({ before: 'u5', turns: 2 });
    expect(h.messageIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
  });

  it('does nothing when the window holds no more than a page', async () => {
    const h = await harness({ grown: true });
    h.plane.history.trim();
    h.events.length = 0;
    expect(h.plane.history.trim()).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('does not count a steered message as a turn', async () => {
    const h = await harness({ grown: true });
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'user_message',
      messageId: 'u7',
      content: [{ type: 'text', text: 'steer' }],
      _meta: { '_mainframe.dev': { containerId: 'u7', messageMeta: { steered: true } } },
    });
    h.plane.history.trim();
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6', 'u7']);
  });

  it('ignores a late update to a trimmed item instead of asking for a resync', async () => {
    const h = await harness({ grown: true });
    h.plane.history.trim();
    h.events.length = 0;
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: ' late' },
    });
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(JSON.stringify(h.events)).not.toContain('late');
    expect(h.client.resumeCalls).toHaveLength(1);
  });

  it('takes a trimmed item back when its page loads again', async () => {
    const h = await harness({ grown: true });
    h.plane.history.trim();
    h.historyPage.mockImplementation(async (_p, apply) =>
      apply({ hasMore: false, floorItemId: 'u1', updates: [...turn(1), ...turn(2), ...turn(3), ...turn(4)] }),
    );
    await h.plane.history.load();
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: '!' },
    });
    const last = h.events.filter((e) => e.type === 'transcript.updated').slice(-1)[0];
    expect(JSON.stringify(last)).toContain('answer 1!');
  });
});

describe('a jump to an unloaded item', () => {
  it('loads a window around it, not everything between, and the item is in the transcript', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    expect(await h.plane.history.load('a2')).toBe(true);
    expect(h.historyAround).toHaveBeenCalledWith({ sessionId: CHAT, itemId: 'a2', before: 50, after: 50 });
    expect(h.historyPage).not.toHaveBeenCalled();
    expect(h.messageIds()).toEqual(['u2', 'a2', 'u3', 'a3']);
    expect(h.history()).toMatchObject({
      hasMore: true,
      detached: { hasBefore: true, hasAfter: true, loadingAfter: false },
      loading: false,
    });
  });

  it('cuts the live window to its newest page while the reader is away', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.plane.history.returnToTail();
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
  });

  it('returns false for an item the daemon does not know', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue({ hasBefore: false, hasAfter: false, stale: true });
    expect(await h.plane.history.load('gone')).toBe(false);
    expect(h.plane.history.isDetached).toBe(false);
  });

  it('does not fetch for an item the live window holds', async () => {
    const h = await harness();
    expect(await h.plane.history.load('a6')).toBe(true);
    expect(h.historyAround).not.toHaveBeenCalled();
  });

  it('opens another window from a window, and returns to the tail for an item the tail holds', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValueOnce(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    expect(await h.plane.history.load('a3')).toBe(true);
    expect(h.historyAround).toHaveBeenCalledTimes(1);
    h.historyAround.mockResolvedValueOnce(around([1], { hasBefore: false, hasAfter: true }, 'a1'));
    await h.plane.history.load('a1');
    expect(h.messageIds()).toEqual(['u1', 'a1']);
    expect(await h.plane.history.load('a6')).toBe(true);
    expect(h.plane.history.isDetached).toBe(false);
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
  });

  it('keeps paging the whole way on the virtualized list', async () => {
    useUiPrefs.setState({ plainTranscript: false });
    const h = await harness();
    h.historyPage.mockImplementation(async (_p, apply) =>
      apply({ hasMore: false, floorItemId: 'u1', updates: [...turn(1)] }),
    );
    await h.plane.history.load('a1');
    expect(h.historyAround).not.toHaveBeenCalled();
    expect(h.historyPage).toHaveBeenCalledTimes(1);
  });

  it('keeps paging on a daemon without history_around', async () => {
    const h = await harness({ capable: false });
    h.historyPage.mockImplementation(async (_p, apply) =>
      apply({ hasMore: false, floorItemId: 'u1', updates: [...turn(1)] }),
    );
    await h.plane.history.load('a1');
    expect(h.historyPage).toHaveBeenCalledTimes(1);
  });
});

describe('scrolling from a window', () => {
  async function away(h: Harness) {
    h.historyAround.mockResolvedValueOnce(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
  }

  it('loads the next items below, repeating the anchor', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(around([3, 4], { hasBefore: true, hasAfter: true }));
    await h.plane.history.loadLater();
    expect(h.historyAround).toHaveBeenLastCalledWith({ sessionId: CHAT, itemId: 'a3', before: 0, after: 100 });
    expect(h.messageIds()).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });

  it('loads the next items above and keeps the window detached', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(around([1, 2], { hasBefore: false, hasAfter: true }));
    await h.plane.history.load();
    expect(h.historyAround).toHaveBeenLastCalledWith({ sessionId: CHAT, itemId: 'u2', before: 100, after: 0 });
    expect(h.messageIds()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(h.history()).toMatchObject({ hasMore: false, detached: { hasBefore: false, hasAfter: true } });
  });

  it('reaches the live tail: the window ends where the chat does, and one more step returns', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(around([3, 4, 5, 6], { hasBefore: true, hasAfter: false }));
    await h.plane.history.loadLater();
    expect(h.history().detached).toMatchObject({ hasAfter: false });
    expect(h.messageIds()).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(await h.plane.history.loadLater()).toBe(true);
    expect(h.plane.history.isDetached).toBe(false);
    expect(h.history().detached).toBeUndefined();
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
  });

  it('returns to the tail in one step on request', async () => {
    const h = await harness();
    await away(h);
    expect(h.plane.history.returnToTail()).toBe(true);
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(h.plane.history.returnToTail()).toBe(false);
  });
});

describe('live updates while away from the tail', () => {
  it('keeps every one: they show once the reader is back, and the window stays as it was', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.events.length = 0;
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a6',
      content: { type: 'text', text: ' more' },
    });
    for (const update of turn(7)) h.client.emitUpdate(CHAT, update);
    expect(h.events.filter((e) => e.type === 'transcript.updated')).toEqual([]);
    h.plane.history.returnToTail();
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6', 'u7', 'a7']);
    const last = h.events.filter((e) => e.type === 'transcript.updated').slice(-1)[0];
    expect(JSON.stringify(last)).toContain('answer 6 more');
  });

  it('still reconciles the run state', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.events.length = 0;
    h.client.emitUpdate(CHAT, { sessionUpdate: 'state_update', state: 'running' } as SessionUpdate);
    expect(h.events.some((e) => e.type === 'run.started')).toBe(true);
  });
});

describe('a window is a snapshot', () => {
  async function away(h: Harness) {
    h.historyAround.mockResolvedValueOnce(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.historyAround.mockClear();
  }
  const changed = around([2, 3], { hasBefore: true, hasAfter: true }, 'a2');
  changed.updates = [
    ...turn(2),
    ...turn(3).slice(0, 1),
    {
      sessionUpdate: 'agent_message',
      messageId: 'a3',
      content: [{ type: 'text', text: 'answer 3, rewritten' }],
      _meta: { '_mainframe.dev': { containerId: 'a3' } },
    },
  ];

  it('is fetched again over the span it showed when the turn ends', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(changed);
    h.plane.history.resnapshot();
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(1));
    expect(h.historyAround).toHaveBeenCalledWith({ sessionId: CHAT, itemId: 'a2', before: 1, after: 2 });
    await vi.waitFor(() =>
      expect(JSON.stringify(h.events.filter((e) => e.type === 'transcript.updated').slice(-1)[0])).toContain(
        'rewritten',
      ),
    );
    expect(h.plane.history.isDetached).toBe(true);
  });

  it('is fetched again after a resync replaces the live window', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(changed);
    h.plane.history.reset({ hasMore: true, floorItemId: 'u5' });
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(1));
  });

  it('takes the reader back to the tail when its target is gone', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce({ hasBefore: false, hasAfter: false, stale: true });
    h.plane.history.resnapshot();
    await vi.waitFor(() => expect(h.plane.history.isDetached).toBe(false));
    expect(h.messageIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
  });

  it('runs one refresh at a time, and once more for what came meanwhile', async () => {
    const h = await harness();
    await away(h);
    let release!: (value: HistoryAroundResult) => void;
    h.historyAround.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    h.historyAround.mockResolvedValueOnce(changed);
    h.plane.history.resnapshot();
    h.plane.history.resnapshot();
    h.plane.history.resnapshot();
    expect(h.historyAround).toHaveBeenCalledTimes(1);
    release(changed);
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(2));
  });

  it('does not touch a window that is not open', async () => {
    const h = await harness();
    h.plane.history.resnapshot();
    expect(h.historyAround).not.toHaveBeenCalled();
  });
});
