/**
 * AcpSessionPlane — revision-versioned resume cursors through the real
 * `AcpSessionPlane`/`AcpSessionAttachment`/`ResumeCursorTracker` wiring
 * (todo #377, G3 step 2). `acp-resume-cursor.test.ts` covers the tracker's
 * own selection/commit/notification rules in isolation; this file covers
 * the integration: which cursor a reconnect actually sends, that an
 * aborted replay never advances it, and that an incremental replay's
 * `created` frame for a known id patches in place rather than duplicating.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ChatStateEvent } from '../chat-thread-state';
import { AcpSessionPlane, type AcpSessionPlaneHost } from '../acp-session-plane';
import { CHAT_ID, makeFakeAcpClient, type FakeAcpClient } from './acp-test-kit';
import { tick } from './acp-attachment-support';

const REVISION = { itemCreationMarkers: true, replayComplete: true, revisionCursors: true };
const STAGED_NO_REVISION = { itemCreationMarkers: true, replayComplete: true };

type DispatchMock = ReturnType<typeof vi.fn<(event: ChatStateEvent) => void>>;
type TranscriptUpdated = Extract<ChatStateEvent, { type: 'transcript.updated' }>;

function makeHost(): AcpSessionPlaneHost & { dispatch: DispatchMock } {
  return { getChatId: () => CHAT_ID, dispatch: vi.fn<(event: ChatStateEvent) => void>(), isDisposed: () => false };
}

function transcripts(host: ReturnType<typeof makeHost>): TranscriptUpdated[] {
  return host.dispatch.mock.calls
    .map((c) => c[0])
    .filter((e): e is TranscriptUpdated => e.type === 'transcript.updated');
}

function idsOf(messages: readonly ThreadMessageLike[]): Array<string | number | undefined> {
  return messages.map((m) => m.id);
}

function lastOf<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

function agentMessage(id: string, text: string) {
  return {
    sessionUpdate: 'agent_message' as const,
    messageId: id,
    content: [{ type: 'text' as const, text }],
    _meta: { '_mainframe.dev': { created: true } },
  };
}

/** A full attach whose reply seeds the durable revision cursor at `{epoch, revision}`. */
async function attachAtRevision(
  plane: AcpSessionPlane,
  client: FakeAcpClient,
  n: number,
  epoch: string,
  revision: number,
): Promise<void> {
  client.nextResumeMeta = { itemCount: n, fullReplay: true, cursor: { epoch, revision } };
  const attached = plane.attach(client);
  await tick();
  for (let i = 0; i < n; i++) client.emitUpdate(CHAT_ID, agentMessage(`base-${i}`, `base ${i}`));
  client.emitReplayComplete(CHAT_ID);
  await attached;
}

describe('AcpSessionPlane — revision cursor selection on reactivate/gap resume (todo #377)', () => {
  it('reactivate() sends the durable revision cursor once the daemon negotiates revisionCursors', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 2, 'e1', 2);

    plane.detach();
    client.nextResumeMeta = undefined;
    const reactivated = plane.reactivate(client);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes reactivate()'s own (cursor) window
    await reactivated;

    expect(lastOf(client.resumeCalls)).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'revision', epoch: 'e1', revision: 2 },
    });
  });

  it('reactivate() falls back to the legacy item cursor against a daemon that does not negotiate revisionCursors', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED_NO_REVISION });
    const plane = new AcpSessionPlane(makeHost());
    // No `cursor` in the reply meta — a real daemon that doesn't advertise
    // revisionCursors never sends one, opted-in client or not.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    const attached = plane.attach(client);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('base-0', 'base 0'));
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    client.emitReplayComplete(CHAT_ID);
    await attached;

    plane.detach();
    client.nextResumeMeta = undefined;
    const reactivated = plane.reactivate(client);
    await tick();
    client.emitReplayComplete(CHAT_ID);
    await reactivated;

    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'item', itemId: 'base-0' } });
  });

  it('a gap resume sends the durable revision cursor too, without needing a detach/reactivate cycle', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();

    expect(lastOf(client.resumeCalls)).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'revision', epoch: 'e1', revision: 1 },
    });
    client.emitReplayComplete(CHAT_ID);
  });
});

describe('AcpSessionPlane — an aborted replay never advances the durable cursor (todo #377)', () => {
  it('an aborted cursor-resume window never commits its reply cursor — the next gap resume still sends the old one', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    // A live gap opens a cursor-kind window whose reply carries a far-ahead
    // cursor, but the daemon aborts delivery — `completeReplay` (and so
    // `commitReplyCursor`) must never run for this window.
    client.nextResumeMeta = { cursor: { epoch: 'e1', revision: 50 } };
    client.emitGap();
    await tick();
    client.emitReplayComplete(CHAT_ID, true);

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();

    expect(lastOf(client.resumeCalls)).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'revision', epoch: 'e1', revision: 1 },
    });
    client.emitReplayComplete(CHAT_ID);
  });

  it('a resync clears the durable cursor eagerly — if its own full replay then aborts, the next resume falls all the way back to start', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    // The resync's own reply would seed a fresh cursor, but it never gets
    // the chance — aborted before `completeReplay` runs. The EAGER clear at
    // request time (not the reply) is what leaves nothing to fall back to.
    client.nextResumeMeta = { itemCount: 2, fullReplay: true, cursor: { epoch: 'e1', revision: 99 } };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitReplayComplete(CHAT_ID, true);

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();

    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'start' } });
    client.emitReplayComplete(CHAT_ID);
  });
});

describe('AcpSessionPlane — needs-replay and transcript_cleared also clear the durable cursor eagerly (todo #377)', () => {
  it('transcript_cleared clears it immediately, before the reattach round-trip', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    client.nextResumeMeta = { itemCount: 0, fullReplay: true }; // no cursor meta on this reply
    client.emitTranscriptCleared(CHAT_ID);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes the wipe's own full window

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'start' } });
    client.emitReplayComplete(CHAT_ID);
  });

  it('needs-replay (an unknown-id frame in strict mode) clears it eagerly too', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    client.nextResumeMeta = { itemCount: 1, fullReplay: true }; // no cursor meta on this reply
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'unknown-1',
      content: { type: 'text', text: 'x' },
    });
    await tick();
    client.emitReplayComplete(CHAT_ID);

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'start' } });
    client.emitReplayComplete(CHAT_ID);
  });
});

describe("AcpSessionPlane — an incremental replay's created frame for a known id replaces it in place (todo #377)", () => {
  it('does not duplicate or reorder the item', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachAtRevision(plane, client, 1, 'e1', 1);
    host.dispatch.mockClear();

    // No `fullReplay` flag — a plain cursor-kind window, applied live.
    client.nextResumeMeta = { cursor: { epoch: 'e1', revision: 2 } };
    client.emitGap();
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('base-0', 'edited text'));
    client.emitReplayComplete(CHAT_ID);

    const updates = transcripts(host);
    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1]!;
    expect(idsOf(last.messages)).toEqual(['base-0']);
    const part = (last.messages[0]!.content as unknown as Array<{ type: string; text?: string }>)[0]!;
    expect(part.text).toBe('edited text');
  });
});

describe('AcpSessionPlane — _mainframe.dev/cursor advances the durable cursor outside a resume round trip (todo #377)', () => {
  it('advances it while idle, and the next gap resume sends the advanced revision', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    client.emitCursor(CHAT_ID, { epoch: 'e1', revision: 4 });

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'revision', epoch: 'e1', revision: 4 },
    });
    client.emitReplayComplete(CHAT_ID);
  });

  it('is ignored while a replay window is open — it never races the reply cursor that window will itself commit', async () => {
    const client = makeFakeAcpClient({ capabilities: REVISION });
    const plane = new AcpSessionPlane(makeHost());
    await attachAtRevision(plane, client, 1, 'e1', 1);

    client.nextResumeMeta = { cursor: { epoch: 'e1', revision: 2 } };
    client.emitGap(); // opens a cursor window — still open, no replay_complete yet
    await tick();

    client.emitCursor(CHAT_ID, { epoch: 'e1', revision: 9 });
    client.emitReplayComplete(CHAT_ID); // commits { e1, revision: 2 } from the reply, not 9

    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({
      sessionId: CHAT_ID,
      cursor: { type: 'revision', epoch: 'e1', revision: 2 },
    });
    client.emitReplayComplete(CHAT_ID);
  });
});
