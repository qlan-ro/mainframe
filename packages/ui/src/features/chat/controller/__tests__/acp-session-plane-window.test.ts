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

function divider(): SessionUpdate {
  return {
    sessionUpdate: 'agent_message',
    messageId: 'divider',
    content: [{ type: 'text', text: 'compacted' }],
    _meta: {
      '_mainframe.dev': {
        containerId: 'divider',
        compaction: { origin: 'idle', requestId: 'r', sessionGeneration: 'g' },
      },
    },
  } as SessionUpdate;
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
  /** Ids the live transcript last dispatched. */
  liveIds(): string[];
  /** Ids of the window around a target as last dispatched, or null when there is none. */
  windowIds(): string[] | null;
  history(): HistoryLoadState;
  historyAround: ReturnType<typeof vi.fn>;
  historyPage: ReturnType<typeof vi.fn>;
  historyTrim: ReturnType<typeof vi.fn>;
  /** The daemon's stream floor for this connection: a page is served only `before` it. */
  daemon: { floor: string };
}

interface Options {
  /** Daemon without `history_trim`. */
  noTrim?: boolean;
  /** Daemon without `history_around`. */
  noAround?: boolean;
  /** The turns the live window holds, oldest first. Default: the newest page, 5 and 6. */
  live?: number[];
  /** A compaction divider ahead of this turn. */
  dividerBefore?: number;
}

const turnOf = (id: string) => Number(id.slice(1));

async function harness(options: Options = {}): Promise<Harness> {
  const events: ChatStateEvent[] = [];
  const live = options.live ?? [5, 6];
  const capabilities = {
    windowedHistory: true,
    ...(options.noAround ? {} : { historyAround: true }),
    ...(options.noTrim ? {} : { historyTrim: true }),
  };
  const client = makeFakeAcpClient({ capabilities });
  const daemon = { floor: `u${live[0]}` };
  // The daemon's own rule: a page is served only when `before` is the connection's floor, and moves it.
  const historyPage = vi.fn(async (params: { before: string }, apply: (page: object) => void) => {
    if (params.before !== daemon.floor) {
      apply({ hasMore: true, floorItemId: daemon.floor, stale: true });
      return;
    }
    const to = turnOf(params.before);
    const from = Math.max(1, to - 2);
    daemon.floor = from < to ? `u${from}` : daemon.floor;
    const turns = Array.from({ length: to - from }, (_, i) => from + i);
    apply({ hasMore: from > 1, floorItemId: daemon.floor, updates: turns.flatMap(turn) });
  });
  const historyTrim = vi.fn(async (params: { floorItemId: string }) => {
    if (turnOf(params.floorItemId) < turnOf(daemon.floor))
      return { hasMore: true, floorItemId: daemon.floor, stale: true };
    daemon.floor = params.floorItemId;
    return { hasMore: true, floorItemId: params.floorItemId };
  });
  const historyAround = vi.fn();
  client.historyPage = historyPage as unknown as FakeAcpClient['historyPage'];
  client.historyAround = historyAround as unknown as FakeAcpClient['historyAround'];
  if (!options.noTrim) client.historyTrim = historyTrim as unknown as FakeAcpClient['historyTrim'];
  const plane = new AcpSessionPlane({
    getChatId: () => CHAT,
    dispatch: (e) => events.push(e),
    isDisposed: () => false,
  });
  await plane.attach(client);
  for (const n of live) {
    if (n === options.dividerBefore) client.emitUpdate(CHAT, divider());
    for (const update of turn(n)) client.emitUpdate(CHAT, update);
  }
  plane.history.reset({ hasMore: live[0]! > 1, floorItemId: `u${live[0]}` });
  events.length = 0;
  const last = <T extends ChatStateEvent['type']>(type: T) =>
    events.filter((e): e is Extract<ChatStateEvent, { type: T }> => e.type === type).slice(-1)[0];
  return {
    plane,
    client,
    events,
    historyAround,
    historyPage,
    historyTrim,
    daemon,
    liveIds: () => last('transcript.updated')?.messages.map((m) => String(m.id)) ?? [],
    windowIds: () => last('window.updated')?.messages?.map((m) => String(m.id)) ?? null,
    history: () => {
      const state = last('history.window');
      if (!state) throw new Error('no history state yet');
      return state.history;
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
  const grown = { live: [1, 2, 3, 4, 5, 6] };

  it('cuts the window back to the newest page and moves the floor with it', async () => {
    const h = await harness(grown);
    expect(await h.plane.history.trim()).toBe(true);
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(h.history()).toMatchObject({ hasMore: true, floorItemId: 'u5', loading: false });
  });

  it('moves the daemon floor too, so the page above the new floor is served', async () => {
    const h = await harness(grown);
    await h.plane.history.trim();
    expect(h.historyTrim).toHaveBeenCalledWith({ sessionId: CHAT, floorItemId: 'u5' });
    expect(h.daemon.floor).toBe('u5');
    expect(await h.plane.history.load()).toBe(true);
    expect(h.historyPage.mock.calls[0]![0]).toMatchObject({ before: 'u5', turns: 2 });
    expect(h.liveIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(h.history()).toMatchObject({ hasMore: true, floorItemId: 'u3' });
    expect(h.history().error).toBeUndefined();
  });

  it('does not trim on a daemon that cannot raise its floor: a cut window could not page back', async () => {
    const h = await harness({ ...grown, noTrim: true });
    expect(await h.plane.history.trim()).toBe(false);
    expect(h.events).toEqual([]);
    expect(h.historyTrim).not.toHaveBeenCalled();
    h.daemon.floor = 'u1';
  });

  it('keeps the window whole when the daemon refuses to raise the floor', async () => {
    const h = await harness(grown);
    h.historyTrim.mockResolvedValueOnce({ hasMore: true, floorItemId: 'u1', stale: true });
    expect(await h.plane.history.trim()).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('does nothing when the window holds no more than a page', async () => {
    const h = await harness(grown);
    await h.plane.history.trim();
    h.events.length = 0;
    expect(await h.plane.history.trim()).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('is skipped while a page is on its way', async () => {
    const h = await harness(grown);
    h.plane.history.reset({ hasMore: true, floorItemId: 'u1' });
    let release!: () => void;
    h.historyPage.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const paging = h.plane.history.load();
    expect(await h.plane.history.trim()).toBe(false);
    expect(h.historyTrim).not.toHaveBeenCalled();
    release();
    await paging.catch(() => undefined);
  });

  it('does not count a steered message as a turn', async () => {
    const h = await harness(grown);
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'user_message',
      messageId: 'u7',
      content: [{ type: 'text', text: 'steer' }],
      _meta: { '_mainframe.dev': { containerId: 'u7', messageMeta: { steered: true } } },
    });
    await h.plane.history.trim();
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6', 'u7']);
  });

  it('keeps the compaction divider that leads the oldest kept turn', async () => {
    const h = await harness({ ...grown, dividerBefore: 5 });
    await h.plane.history.trim();
    expect(h.liveIds()).toEqual(['divider', 'u5', 'a5', 'u6', 'a6']);
    expect(h.history()).toMatchObject({ floorItemId: 'divider' });
  });

  it('applies a trim the daemon accepted even when a reload came before its reply', async () => {
    const h = await harness(grown);
    let reply!: (value: object) => void;
    h.historyTrim.mockImplementationOnce(() => new Promise((resolve) => (reply = resolve)));
    const trimming = h.plane.history.trim();
    // A send or a resync bumps the generation while the request is out.
    h.plane.history.reset({ hasMore: true, floorItemId: 'u1' });
    h.daemon.floor = 'u5';
    reply({ hasMore: true, floorItemId: 'u5' });
    expect(await trimming).toBe(true);
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(await h.plane.history.load()).toBe(true);
    expect(h.history().error).toBeUndefined();
    expect(h.liveIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
  });

  it('follows the floor a stale page carries when the daemon is ahead of the client', async () => {
    const h = await harness({ live: [3, 4, 5, 6] });
    h.plane.history.reset({ hasMore: true, floorItemId: 'u3' });
    h.daemon.floor = 'u5';
    expect(await h.plane.history.load()).toBe(true);
    expect(h.historyPage.mock.calls.map(([params]) => params.before)).toEqual(['u3', 'u5']);
    expect(h.liveIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(h.history()).toMatchObject({ floorItemId: 'u3' });
  });

  it('ignores a late update to a trimmed item instead of asking for a resync', async () => {
    const h = await harness(grown);
    await h.plane.history.trim();
    h.events.length = 0;
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: ' late' },
    });
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(JSON.stringify(h.events)).not.toContain('late');
    expect(h.client.resumeCalls).toHaveLength(1);
  });

  it('takes a trimmed item back when its page loads again', async () => {
    const h = await harness(grown);
    await h.plane.history.trim();
    await h.plane.history.load();
    await h.plane.history.load();
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a3',
      content: { type: 'text', text: '!' },
    });
    expect(JSON.stringify(h.events.filter((e) => e.type === 'transcript.updated').slice(-1)[0])).toContain('answer 3!');
  });
});

describe('a jump to an unloaded item', () => {
  it('loads a window around it, not everything between, and the item is in the window', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    expect(await h.plane.history.load('a2')).toBe(true);
    expect(h.historyAround).toHaveBeenCalledWith({ sessionId: CHAT, itemId: 'a2', before: 50, after: 50 });
    expect(h.historyPage).not.toHaveBeenCalled();
    expect(h.windowIds()).toEqual(['u2', 'a2', 'u3', 'a3']);
    expect(h.history()).toMatchObject({
      hasMore: true,
      detached: { hasBefore: true, hasAfter: true, loadingAfter: false },
      loading: false,
    });
  });

  it('leaves the live transcript to every other reader', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    expect(h.liveIds()).toEqual([]);
    h.client.emitUpdate(CHAT, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a6',
      content: { type: 'text', text: ' more' },
    });
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6']);
    expect(h.windowIds()).toEqual(['u2', 'a2', 'u3', 'a3']);
  });

  it('cuts the live window to its newest page while the reader is away, and keeps the daemon in step', async () => {
    const h = await harness({ live: [3, 4, 5, 6] });
    h.historyAround.mockResolvedValue(around([1, 2], { hasBefore: false, hasAfter: true }, 'a1'));
    expect(await h.plane.history.load('a1')).toBe(true);
    expect(h.historyTrim).toHaveBeenCalledWith({ sessionId: CHAT, floorItemId: 'u5' });
    h.plane.history.returnToTail();
    expect(h.windowIds()).toBeNull();
    expect(await h.plane.history.load()).toBe(true);
    expect(h.history().error).toBeUndefined();
    expect(h.liveIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
  });

  it('keeps the live window whole on a daemon that cannot raise its floor', async () => {
    const h = await harness({ live: [4, 5, 6], noTrim: true });
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    expect(await h.plane.history.load('a2')).toBe(true);
    h.plane.history.returnToTail();
    expect(h.windowIds()).toBeNull();
    expect(await h.plane.history.load()).toBe(true);
    expect(h.history().error).toBeUndefined();
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
    expect(h.windowIds()).toEqual(['u1', 'a1']);
    expect(await h.plane.history.load('a6')).toBe(true);
    expect(h.plane.history.isDetached).toBe(false);
    expect(h.windowIds()).toBeNull();
  });

  it('keeps paging the whole way on the virtualized list', async () => {
    useUiPrefs.setState({ plainTranscript: false });
    const h = await harness();
    await h.plane.history.load('a3');
    expect(h.historyAround).not.toHaveBeenCalled();
    expect(h.historyPage).toHaveBeenCalledTimes(1);
  });

  it('keeps paging on a daemon without history_around', async () => {
    const h = await harness({ noAround: true });
    await h.plane.history.load('a3');
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
    expect(h.windowIds()).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });

  it('loads the next items above and keeps the window detached', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(around([1, 2], { hasBefore: false, hasAfter: true }));
    await h.plane.history.load();
    expect(h.historyAround).toHaveBeenLastCalledWith({ sessionId: CHAT, itemId: 'u2', before: 100, after: 0 });
    expect(h.windowIds()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(h.history()).toMatchObject({ hasMore: false, detached: { hasBefore: false, hasAfter: true } });
  });

  it('reaches the live tail: the window ends where the chat does, and one more step returns', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(around([3, 4, 5, 6], { hasBefore: true, hasAfter: false }));
    await h.plane.history.loadLater();
    expect(h.history().detached).toMatchObject({ hasAfter: false });
    expect(h.windowIds()).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(await h.plane.history.loadLater()).toBe(true);
    expect(h.plane.history.isDetached).toBe(false);
    expect(h.history().detached).toBeUndefined();
    expect(h.windowIds()).toBeNull();
  });

  it('returns to the tail in one step on request, and when the chat is detached', async () => {
    const h = await harness();
    await away(h);
    expect(h.plane.history.returnToTail()).toBe(true);
    expect(h.windowIds()).toBeNull();
    expect(h.plane.history.returnToTail()).toBe(false);
    await away(h);
    h.plane.detach();
    expect(h.plane.history.isDetached).toBe(false);
  });
});

describe('live updates while away from the tail', () => {
  it('keeps every one: the live transcript has them at once, and the window stays as it was', async () => {
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
    expect(h.liveIds()).toEqual(['u5', 'a5', 'u6', 'a6', 'u7', 'a7']);
    expect(JSON.stringify(h.events.filter((e) => e.type === 'transcript.updated').slice(-1)[0])).toContain(
      'answer 6 more',
    );
    expect(h.events.filter((e) => e.type === 'window.updated')).toEqual([]);
    h.plane.history.returnToTail();
    expect(h.windowIds()).toBeNull();
  });

  it('still reconciles the run state', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.events.length = 0;
    h.client.emitUpdate(CHAT, { sessionUpdate: 'state_update', state: 'running' } as SessionUpdate);
    expect(h.events.some((e) => e.type === 'run.started')).toBe(true);
  });

  it('pages the live window for export while away, and leaves the window as it was', async () => {
    const h = await harness();
    h.historyAround.mockResolvedValue(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await h.plane.history.load('a2');
    h.historyAround.mockClear();
    expect(h.plane.history.liveHistory).toMatchObject({ hasMore: true, floorItemId: 'u5' });
    expect(await h.plane.history.loadLive()).toBe(true);
    expect(h.historyAround).not.toHaveBeenCalled();
    expect(h.plane.history.liveHistory).toMatchObject({ floorItemId: 'u3' });
    expect(h.liveIds()).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(h.windowIds()).toEqual(['u2', 'a2', 'u3', 'a3']);
    expect(h.history().detached).toBeDefined();
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
  const windowText = (h: Harness) => JSON.stringify(h.events.filter((e) => e.type === 'window.updated').slice(-1)[0]);

  it('is fetched again over the span it showed when the turn ends', async () => {
    const h = await harness();
    await away(h);
    h.historyAround.mockResolvedValueOnce(changed);
    h.plane.history.resnapshot();
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(1));
    expect(h.historyAround).toHaveBeenCalledWith({ sessionId: CHAT, itemId: 'a2', before: 1, after: 2 });
    await vi.waitFor(() => expect(windowText(h)).toContain('rewritten'));
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
    expect(h.windowIds()).toBeNull();
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

  it('does not restore an old window over a jump made while it was being fetched', async () => {
    const h = await harness();
    await away(h);
    let release!: (value: HistoryAroundResult) => void;
    h.historyAround.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    h.plane.history.resnapshot();
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(1));
    h.historyAround.mockResolvedValueOnce(around([1], { hasBefore: false, hasAfter: true }, 'a1'));
    expect(await h.plane.history.load('a1')).toBe(true);
    expect(h.windowIds()).toEqual(['u1', 'a1']);
    // The refresh of the window the reader left lands now, and is dropped.
    h.historyAround.mockResolvedValue(around([1], { hasBefore: false, hasAfter: true }, 'a1'));
    release(changed);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(windowText(h)).not.toContain('rewritten');
    expect(h.windowIds()).toEqual(['u1', 'a1']);
  });

  it('measures again when a step landed rows while it was being fetched', async () => {
    const h = await harness();
    await away(h);
    let releaseStep!: (value: HistoryAroundResult) => void;
    h.historyAround.mockImplementationOnce(() => new Promise((resolve) => (releaseStep = resolve)));
    const stepping = h.plane.history.load();
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(1));
    let releaseRefresh!: (value: HistoryAroundResult) => void;
    h.historyAround.mockImplementationOnce(() => new Promise((resolve) => (releaseRefresh = resolve)));
    h.plane.history.resnapshot();
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(2));
    releaseStep(around([1, 2], { hasBefore: false, hasAfter: true }));
    await stepping;
    expect(h.windowIds()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    // The refresh measured before those rows came: its answer is dropped, and it asks again over the new span.
    h.historyAround.mockResolvedValueOnce(around([1, 2, 3], { hasBefore: false, hasAfter: true }, 'a2'));
    releaseRefresh(around([2, 3], { hasBefore: true, hasAfter: true }, 'a2'));
    await vi.waitFor(() => expect(h.historyAround).toHaveBeenCalledTimes(3));
    expect(h.historyAround.mock.calls[2]![0]).toMatchObject({ itemId: 'a2', before: 3, after: 2 });
    expect(h.windowIds()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  });

  it('does not touch a window that is not open', async () => {
    const h = await harness();
    h.plane.history.resnapshot();
    expect(h.historyAround).not.toHaveBeenCalled();
  });
});
