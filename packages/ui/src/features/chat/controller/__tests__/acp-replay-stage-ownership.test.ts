/**
 * Per-window replay storage (todo #385, follow-up to D4/U2 — PR #735). Every
 * case here is a scenario the OLD single shared staging slot (one `staging`
 * field, routed by a `target()` getter) could not express correctly: two
 * full windows overlapping used to share one accumulator, so opening the
 * second silently replaced (and lost) the first's in-progress frames; a
 * cursor window's replay-origin flag was a single boolean a later full
 * publish clobbered; and the old discard/publish calls had no per-window
 * identity to guard against a stale or duplicate call. A new file —
 * `acp-session-attachment-staged.test.ts` is already at the 1045-line split
 * threshold (see its own module doc).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import { AcpSessionPlane, type AcpSessionPlaneHost } from '../acp-session-plane';
import { AcpTranscriptStore } from '../acp-transcript-store';
import { CHAT_ID, makeFakeAcpClient, type FakeAcpClient } from './acp-test-kit';
import { deferred, tick, type ResumeResult } from './acp-attachment-support';

const STAGED = { itemCreationMarkers: true, replayComplete: true };

type DispatchMock = ReturnType<typeof vi.fn<(event: ChatStateEvent) => void>>;
type TranscriptUpdated = Extract<ChatStateEvent, { type: 'transcript.updated' }>;

function makeHost(): AcpSessionPlaneHost & { dispatch: DispatchMock } {
  return {
    getChatId: () => CHAT_ID,
    dispatch: vi.fn<(event: ChatStateEvent) => void>(),
    isDisposed: () => false,
  };
}

function eventsOf(host: ReturnType<typeof makeHost>): ChatStateEvent[] {
  return host.dispatch.mock.calls.map((c) => c[0]);
}

function transcripts(host: ReturnType<typeof makeHost>): TranscriptUpdated[] {
  return eventsOf(host).filter((e): e is TranscriptUpdated => e.type === 'transcript.updated');
}

function lastOf<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

function idsOf(messages: readonly { id?: string | number }[]): Array<string | number | undefined> {
  return messages.map((m) => m.id);
}

/** Replay-origin status, as `convert-acp-item.ts`'s `partStatus` surfaces it: `{type:'complete'}` for a replay-origin item, `undefined` for a live one. */
function firstPartStatus(message: TranscriptUpdated['messages'][number]): unknown {
  return (message.content as unknown as Array<{ status?: unknown }>)[0]?.status;
}

function createdMeta() {
  return { '_mainframe.dev': { created: true } };
}

function agentMessage(id: string, text: string) {
  return {
    sessionUpdate: 'agent_message' as const,
    messageId: id,
    content: [{ type: 'text' as const, text }],
    _meta: createdMeta(),
  };
}

/** Establishes a settled baseline transcript (the FIRST full replay, at attach). */
async function attachWithItems(plane: AcpSessionPlane, client: FakeAcpClient, n: number): Promise<void> {
  client.nextResumeMeta = { itemCount: n, fullReplay: true };
  const attached = plane.attach(client);
  await tick();
  for (let i = 0; i < n; i++) client.emitUpdate(CHAT_ID, agentMessage(`base-${i}`, `base ${i}`));
  client.emitReplayComplete(CHAT_ID);
  await attached;
}

/** Same as `attachWithItems`, but also settles the cursor (an idle `state_update` during the staged replay) so a later gap resume opens a CURSOR window by default, not another full one. */
async function attachAndSettle(plane: AcpSessionPlane, client: FakeAcpClient, n: number): Promise<void> {
  client.nextResumeMeta = { itemCount: n, fullReplay: true };
  const attached = plane.attach(client);
  await tick();
  for (let i = 0; i < n; i++) client.emitUpdate(CHAT_ID, agentMessage(`base-${i}`, `base ${i}`));
  client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
  client.emitReplayComplete(CHAT_ID);
  await attached;
}

/**
 * Opens two overlapping windows via two gap resumes whose replies are held
 * open on deferred gates — mirrors `acp-session-attachment-staged.test.ts`'s
 * "staged windows close oldest first" fixture, generalized to pick each
 * window's kind via its own resume reply's `fullReplay` meta (`undefined` on
 * either lets the cursor established by `attachAndSettle` decide instead).
 */
async function openOverlappingWindows(
  client: FakeAcpClient,
  firstMeta: { fullReplay?: boolean } | undefined,
  secondMeta: { fullReplay?: boolean } | undefined,
): Promise<void> {
  const originalResume = client.resume;
  const gateFirst = deferred<ResumeResult>();
  const gateSecond = deferred<ResumeResult>();
  const gates = [gateFirst, gateSecond];
  let callIndex = 0;
  client.resume = vi.fn((sessionId: string, _cwd: string, cursor) => {
    client.resumeCalls.push({ sessionId, cursor });
    return gates[callIndex++]!.promise;
  }) as typeof client.resume;

  client.emitGap(); // request #1 — no window pushed yet
  client.emitGap(); // request #2 — FIFO still empty, nothing to abort

  gateFirst.resolve((firstMeta ? { _meta: { '_mainframe.dev': firstMeta } } : {}) as ResumeResult);
  await tick(); // first window pushed — its own `beginReplay` already ran
  gateSecond.resolve((secondMeta ? { _meta: { '_mainframe.dev': secondMeta } } : {}) as ResumeResult);
  await tick(); // second window pushed, behind the first — its OWN stage, untouched by the first's

  // Restore the normal meta-driven resume for anything the test does afterward.
  client.resume = originalResume;
}

describe('AcpSessionPlane — two overlapping full windows keep separate staging (case 1)', () => {
  it("each window's own marker publishes only its own frames — opening the second never touches the first's", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 0); // settledItemId stays null — every later `{type:'start'}` gap resume is 'full'
    host.dispatch.mockClear();

    await openOverlappingWindows(client, undefined, undefined); // both full — cursor is null

    // A is still FIFO-front — both its frames land on ITS OWN accumulator.
    // Under the old shared slot, opening B below would have replaced this
    // accumulator outright, losing `a-1` before A ever got to publish it.
    client.emitUpdate(CHAT_ID, agentMessage('a-1', 'a1'));
    client.emitUpdate(CHAT_ID, agentMessage('a-2', 'a2'));

    client.emitReplayComplete(CHAT_ID); // closes A — publishes ONLY A's own frames
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['a-1', 'a-2']);

    // B is now FIFO-front — its own accumulator started empty, independent
    // of whatever A ever held, even though both were open at once.
    client.emitUpdate(CHAT_ID, agentMessage('b-1', 'b1'));

    client.emitReplayComplete(CHAT_ID); // closes B — publishes ONLY B's own frames
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['b-1']);
  });
});

describe('AcpSessionPlane — aborting or closing the older window spares the newer (case 2)', () => {
  it("a daemon-aborted marker for A discards only A's staging; B still publishes cleanly on its own marker", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 0);
    host.dispatch.mockClear();

    await openOverlappingWindows(client, undefined, undefined);

    client.emitUpdate(CHAT_ID, agentMessage('a-1', 'a1')); // staged into A
    const beforeAbort = transcripts(host).length;
    client.emitReplayComplete(CHAT_ID, /* aborted */ true); // closes A — discards A's own stage only
    expect(transcripts(host)).toHaveLength(beforeAbort); // nothing published by the abort

    // B is untouched — never discarded, never pre-filled with A's frames.
    client.emitUpdate(CHAT_ID, agentMessage('b-1', 'b1'));
    client.emitReplayComplete(CHAT_ID);
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['b-1']);
  });
});

describe('AcpSessionPlane — full/cursor overlap preserves frame routing and replay-origin (case 3)', () => {
  it('cursor in front of full: the cursor applies live and replay-origin; the full window stays staged', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachAndSettle(plane, client, 1); // settles the cursor at base-0
    host.dispatch.mockClear();

    // First reply has no `fullReplay` meta → cursor; second does → full.
    // Both resume on the settled (non-null) cursor, so neither is a
    // `{type:'start'}` window regardless of meta.
    await openOverlappingWindows(client, undefined, { fullReplay: true });

    client.emitUpdate(CHAT_ID, agentMessage('cursor-front-1', 'c1')); // routes to the cursor window (FIFO-front)
    const dispatched = lastOf(transcripts(host))!;
    expect(firstPartStatus(dispatched.messages.find((m) => m.id === 'cursor-front-1')!)).toEqual({
      type: 'complete',
    }); // replay-origin, dispatched live — not held back

    client.emitReplayComplete(CHAT_ID); // closes the cursor window — a store-level no-op, nothing (re-)published
    const beforeFullFrame = transcripts(host).length;

    client.emitUpdate(CHAT_ID, agentMessage('full-staged-1', 'f1')); // routes to the full window's OWN off-screen accumulator
    expect(transcripts(host)).toHaveLength(beforeFullFrame); // still staging — nothing dispatched

    client.emitReplayComplete(CHAT_ID); // closes the full window — publishes its own staged frame
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['full-staged-1']);
  });

  it('full in front of cursor: the cursor applies to the just-published accumulator as replay-origin; items after it closes are live', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachAndSettle(plane, client, 1);
    host.dispatch.mockClear();

    // First reply carries `fullReplay` meta → full; second does not → cursor.
    await openOverlappingWindows(client, { fullReplay: true }, undefined);

    client.emitUpdate(CHAT_ID, agentMessage('full-first-1', 'f1')); // routes to the full window (FIFO-front) — staged
    const beforePublish = transcripts(host).length;
    expect(transcripts(host)).toHaveLength(beforePublish);

    client.emitReplayComplete(CHAT_ID); // closes the full window — publishes its one frame as the new visible accumulator
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['full-first-1']);

    // The cursor window is now FIFO-front — its frame lands on the
    // JUST-published accumulator, still marked replay-origin.
    client.emitUpdate(CHAT_ID, agentMessage('cursor-after-publish', 'c1'));
    const afterCursorFrame = lastOf(transcripts(host))!;
    expect(idsOf(afterCursorFrame.messages)).toEqual(['full-first-1', 'cursor-after-publish']);
    expect(firstPartStatus(afterCursorFrame.messages.find((m) => m.id === 'cursor-after-publish')!)).toEqual({
      type: 'complete',
    });

    client.emitReplayComplete(CHAT_ID); // closes the cursor window — store-level no-op

    // With the FIFO empty, a live frame now applies with no replay-origin.
    client.emitUpdate(CHAT_ID, agentMessage('live-after-cursor', 'live'));
    const liveMsg = lastOf(transcripts(host))!.messages.find((m) => m.id === 'live-after-cursor')!;
    expect(firstPartStatus(liveMsg)).toBeUndefined();
  });
});

describe('AcpSessionPlane — stale-connection cleanup discards only its own stage (case 4)', () => {
  it("a reconnect's drain discards the pre-reconnect window's own staging; the new connection's window still publishes", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    // A resync opens a full window on the ORIGINAL connection and stages a
    // create that must never reach the visible transcript.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('stale-1', 'stale'));

    // The socket dies and a new connection replaces it — not a live gap —
    // which drains every window still queued on the dead connection.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitReconnect();
    await tick();

    client.emitUpdate(CHAT_ID, agentMessage('fresh-1', 'fresh')); // the NEW connection's own window
    client.emitReplayComplete(CHAT_ID);

    // Only the new window's own content ever published — the drained one's
    // staging was discarded, never merged or substituted.
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['fresh-1']);

    // The stale window's own (late) marker, if it ever arrived, would just
    // be logged — nothing left of its stage to discard or publish again.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => client.emitReplayComplete(CHAT_ID)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no open window'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('AcpSessionPlane — run state and the settled cursor derive from the window that actually published (case 5)', () => {
  it("A's idle settles the cursor to A's own last item; B's running starts the run afterwards, without a cross-over", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 0);

    await openOverlappingWindows(client, undefined, undefined); // both full — A then B

    client.emitUpdate(CHAT_ID, agentMessage('a-1', 'a1')); // staged into A
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }); // captured on A's own stage
    client.emitReplayComplete(CHAT_ID); // A publishes — settles the cursor to `a-1`, schedules a stop

    // B is still FIFO-front (never aborted, never discarded by A's own
    // close) — its frames land on its OWN accumulator, independent of A's.
    client.emitUpdate(CHAT_ID, agentMessage('b-1', 'b1')); // staged into B
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' }); // captured on B's own stage
    host.dispatch.mockClear();
    client.emitReplayComplete(CHAT_ID); // B publishes — starts the run from B's own captured state

    expect(eventsOf(host)).toContainEqual({ type: 'run.started' });
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['b-1']); // B's own content, not mixed with A's

    // B's `running` never moved the settled cursor off A's own last item.
    client.nextResumeMeta = undefined;
    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'item', itemId: 'a-1' } });
    client.emitReplayComplete(CHAT_ID);
  });
});

describe('AcpSessionPlane — a full window open at transcript_cleared never publishes pre-wipe content (case 6)', () => {
  it("the wipe discards the open window's own staging; its reattach still publishes exactly once", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 2);
    host.dispatch.mockClear();

    // A resync opens a full window that stays open through the wipe below.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('pre-wipe-1', 'stale'));

    // The server wipes the transcript — `resetAccumulator()` discards the
    // resync's open stage immediately. Its own reattach only RUNS once the
    // resync's window settles (`FullReplayRetry` serializes one full replay
    // at a time) — not yet, so no new window exists here.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitTranscriptCleared(CHAT_ID);
    await tick();

    // The resync's own (now-discarded) marker arrives — it can never
    // publish, and settling it is what unblocks the wipe's deferred reattach.
    client.emitReplayComplete(CHAT_ID);
    await tick(); // lets the now-unblocked wipe reattach run and push its own window
    expect(transcripts(host)).toHaveLength(0);

    // The wipe's own window publishes cleanly, exactly once.
    client.emitUpdate(CHAT_ID, agentMessage('post-wipe-1', 'fresh'));
    client.emitReplayComplete(CHAT_ID);
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['post-wipe-1']);
  });
});

describe('AcpTranscriptStore — publish/discard are idempotent, a stale or duplicate call is a no-op (case 7)', () => {
  function makeStore(): AcpTranscriptStore {
    return new AcpTranscriptStore(() => ({ strictCreation: true }));
  }

  it('publishing an already-published stage again returns null and does not re-swap', () => {
    const store = makeStore();
    const stage = store.openStage(true);
    stage.accumulator!.apply(agentMessage('x-1', 'x'));
    expect(store.publish(stage)).toEqual([expect.objectContaining({ id: 'x-1' })]);
    expect(store.publish(stage)).toBeNull();
  });

  it('publishing a discarded stage returns null', () => {
    const store = makeStore();
    const stage = store.openStage(true);
    store.discard(stage);
    expect(store.publish(stage)).toBeNull();
  });

  it('discarding twice is idempotent — no throw, status stays discarded', () => {
    const store = makeStore();
    const stage = store.openStage(true);
    store.discard(stage);
    expect(() => store.discard(stage)).not.toThrow();
    expect(stage.status).toBe('discarded');
  });

  it('discarding an already-published stage is a no-op — it stays published, not reverted', () => {
    const store = makeStore();
    const stage = store.openStage(true);
    store.publish(stage);
    store.discard(stage);
    expect(stage.status).toBe('published');
  });
});
