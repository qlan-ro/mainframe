/**
 * AcpSessionPlane — behavior tests. Replaces `acp-facade-session.test.ts`
 * (the module it targeted, `acp-facade-session.ts`, was an interim stub
 * folded into this plane once the socket was wired to a live ChatManager).
 *
 * Covers what the legacy reconnect mechanisms collapsed into: full replay on
 * attach/reattach, refused when empty against a populated transcript (the
 * four-mechanism collapse the module doc describes), and gap-triggered
 * resume with the last-settled-item cursor. Gate request/resolve and
 * `userMessageContents()` are in the sibling acp-session-plane-gates.test.ts
 * (todo #350, plan task 37, R2.13 — split to keep each file under the
 * 300-line cap).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import { AcpSessionPlane, type AcpSessionPlaneHost } from '../acp-session-plane';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

type DispatchMock = ReturnType<typeof vi.fn<(event: ChatStateEvent) => void>>;

function makeHost(): AcpSessionPlaneHost & { dispatch: DispatchMock } {
  return {
    getChatId: () => CHAT_ID,
    dispatch: vi.fn<(event: ChatStateEvent) => void>(),
    isDisposed: () => false,
  };
}

function lastOf<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

function eventsOf(host: ReturnType<typeof makeHost>): ChatStateEvent[] {
  return host.dispatch.mock.calls.map((c) => c[0]);
}

describe('AcpSessionPlane.attach', () => {
  it('resumes with a start cursor and streams a transcript.updated after the first update', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);

    await plane.attach(client);

    expect(client.resumeCalls).toEqual([{ sessionId: CHAT_ID, cursor: { type: 'start' } }]);

    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'hi' },
    });

    const updated = eventsOf(host).find((e) => e.type === 'transcript.updated');
    expect(updated).toBeDefined();
    expect(updated).toMatchObject({ type: 'transcript.updated', messages: [{ role: 'assistant', id: 'm1' }] });
  });

  it('ignores a session update for a different session id', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    host.dispatch.mockClear();

    client.emitUpdate('other-chat', {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'hi' },
    });

    expect(host.dispatch).not.toHaveBeenCalled();
  });
});

describe('AcpSessionPlane — state_update → run frames', () => {
  it('dispatches run.started on running and run.stopped on idle', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    host.dispatch.mockClear();

    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });

    expect(eventsOf(host)).toEqual([{ type: 'run.started' }, { type: 'run.stopped' }]);
  });
});

describe('AcpSessionPlane — queue state', () => {
  it('dispatches queued.snapshot with the pushed refs for this chat only', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    const ref = { messageId: 'm1', chatId: CHAT_ID, uuid: 'u1', content: 'queued', timestamp: 't' };
    client.emitQueueState(CHAT_ID, [ref]);
    client.emitQueueState('other-chat', []);

    const snapshots = eventsOf(host).filter((e) => e.type === 'queued.snapshot');
    expect(snapshots).toEqual([{ type: 'queued.snapshot', refs: [ref] }]);
  });

  it('an empty snapshot replaces the queued set (stale-turn eviction)', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitQueueState(CHAT_ID, []);

    expect(eventsOf(host)).toContainEqual({ type: 'queued.snapshot', refs: [] });
  });
});

describe('AcpSessionPlane — transcript cleared', () => {
  it('dispatches transcript.cleared and re-resumes from the start', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    const resumesBefore = client.resumeCalls.length;

    client.emitTranscriptCleared(CHAT_ID);
    await Promise.resolve();

    expect(eventsOf(host)).toContainEqual({ type: 'transcript.cleared' });
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);
    expect(client.resumeCalls[client.resumeCalls.length - 1]).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'start' },
    });
  });

  it('ignores a clear for another session', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    host.dispatch.mockClear();

    client.emitTranscriptCleared('other-chat');

    expect(host.dispatch).not.toHaveBeenCalled();
  });
});

describe('AcpSessionPlane — compaction notifications', () => {
  it('maps started/done phases to compact.started/compact.done for this chat only', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitCompaction(CHAT_ID, 'started');
    client.emitCompaction('other-chat', 'done');
    client.emitCompaction(CHAT_ID, 'done');

    const events = eventsOf(host);
    expect(events).toContainEqual({ type: 'compact.started' });
    expect(events.filter((e) => e.type === 'compact.done')).toHaveLength(1);
  });
});

describe('AcpSessionPlane — usage_update → context.usage', () => {
  it('prefers the CLI percentage riding the extension meta', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'usage_update',
      used: 3000,
      size: 200_000,
      _meta: { '_mainframe.dev': { percentage: 1.5 } },
    });

    expect(eventsOf(host)).toContainEqual({
      type: 'context.usage',
      percentage: 1.5,
      totalTokens: 3000,
      maxTokens: 200_000,
    });
  });

  it('falls back to used/size when no meta rides the update', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitUpdate(CHAT_ID, { sessionUpdate: 'usage_update', used: 50_000, size: 200_000 });

    expect(eventsOf(host)).toContainEqual({
      type: 'context.usage',
      percentage: 25,
      totalTokens: 50_000,
      maxTokens: 200_000,
    });
  });
});

describe('AcpSessionPlane — empty full-replay refusal', () => {
  it('a reattach wipes the transcript even when the daemon reports itemCount 0 — a server-initiated wipe bypasses the guard (R2.2, T24)', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'hi' }],
    });
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 0, fullReplay: true };
    await plane.reattach();

    expect(eventsOf(host)).not.toContainEqual({ type: 'history.refresh.refused' });
    // The old item is gone — a fresh chunk starts a brand-new item rather
    // than coalescing into the pre-wipe one (plan-mode clear-context stays wiped).
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'fresh start' },
    });
    const lastUpdate = lastOf(eventsOf(host).filter((e) => e.type === 'transcript.updated'));
    expect(lastUpdate).toMatchObject({ messages: [{ content: [{ type: 'text', text: 'fresh start' }] }] });
  });

  it('does not refuse the first attach even when the daemon reports itemCount 0', async () => {
    const client = makeFakeAcpClient();
    client.nextResumeMeta = { itemCount: 0 };
    const host = makeHost();
    const plane = new AcpSessionPlane(host);

    await plane.attach(client);

    expect(eventsOf(host)).not.toContainEqual({ type: 'history.refresh.refused' });
  });
});

describe('AcpSessionPlane — gap resume cursor', () => {
  it('resumes from start when no item has settled yet', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);

    client.emitGap();
    await Promise.resolve();

    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'start' } });
  });

  it('resumes from the last idle-settled item id after a turn completes', async () => {
    const client = makeFakeAcpClient();
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await plane.attach(client);
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'done' }],
    });
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });

    client.emitGap();
    await Promise.resolve();

    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'item', itemId: 'm1' } });
  });

  it('a gap before attach has completed is a no-op', () => {
    const client = makeFakeAcpClient();
    // No plane ever attaches — emitGap has no listeners registered.
    client.emitGap();
    expect(client.resumeCalls).toEqual([]);
  });
});
