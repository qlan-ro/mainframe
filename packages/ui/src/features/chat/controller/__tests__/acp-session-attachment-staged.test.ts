/**
 * Staged full replay (D4, plan task U2) — behavior tests for
 * `AcpSessionAttachment`/`AcpSessionPlane`/`ReplayWindowCoordinator` once the
 * daemon advertises `replayComplete`. Every suite here builds its client
 * with that capability on; `acp-session-attachment(-replay).test.ts` and
 * `acp-session-plane(-gates).test.ts` cover the legacy (no-capability) path
 * and must stay unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ChatStateEvent } from '../chat-thread-state';
import { AcpSessionPlane, type AcpSessionPlaneHost } from '../acp-session-plane';
import { AcpSessionAttachment, type AcpSessionClientPort } from '../acp-session-attachment';
import { CHAT_ID, makeFakeAcpClient, type FakeAcpClient } from './acp-test-kit';
import { deferred, makeHost as makeAttachmentHost, tick, type ResumeResult } from './acp-attachment-support';

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

function idsOf(messages: readonly ThreadMessageLike[]): Array<string | number | undefined> {
  return messages.map((m) => m.id);
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

/**
 * Attaches and closes the first (full) replay with `n` items, establishing a
 * settled baseline transcript. The `tick()` between `attach()` and emitting
 * frames matters: the window isn't pushed until the mocked `resume()`'s
 * reply resolves (a microtask), and a frame or marker emitted before that
 * would land with no window open at all.
 */
async function attachWithItems(plane: AcpSessionPlane, client: FakeAcpClient, n: number): Promise<void> {
  client.nextResumeMeta = { itemCount: n, fullReplay: true };
  const attached = plane.attach(client);
  await tick();
  for (let i = 0; i < n; i++) client.emitUpdate(CHAT_ID, agentMessage(`base-${i}`, `base ${i}`));
  client.emitReplayComplete(CHAT_ID);
  await attached;
}

describe('AcpSessionPlane — staged full replay publishes atomically (D4)', () => {
  it('a full replay publishes once at replay_complete, with the visible transcript untouched until then', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 3);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 10, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    for (let i = 0; i < 10; i++) client.emitUpdate(CHAT_ID, agentMessage(`new-${i}`, `new ${i}`));

    // Nothing published while staging.
    expect(transcripts(host)).toHaveLength(0);

    client.emitReplayComplete(CHAT_ID);

    const updates = transcripts(host);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.messages).toHaveLength(10);
    expect(idsOf(updates[0]!.messages)).toEqual(Array.from({ length: 10 }, (_, i) => `new-${i}`));
  });

  it('resync keeps the visible transcript until the replay completes — no transcript.cleared, item count stays 3', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 3);
    expect(lastOf(transcripts(host))!.messages).toHaveLength(3);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 2, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('r1', 'r1'));
    client.emitUpdate(CHAT_ID, agentMessage('r2', 'r2'));

    expect(eventsOf(host)).not.toContainEqual({ type: 'transcript.cleared' });
    expect(transcripts(host)).toHaveLength(0);

    client.emitReplayComplete(CHAT_ID);
    expect(lastOf(transcripts(host))!.messages).toHaveLength(2);
  });

  it('resync is busy until replay end — a second resync before replay_complete issues no second resume call', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    const resumesBefore = client.resumeCalls.length;

    client.emitResync(CHAT_ID);
    await tick();
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);

    client.emitResync(CHAT_ID);
    await tick();
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);

    client.emitReplayComplete(CHAT_ID);
  });

  it('an aborted replay_complete keeps the visible transcript and retries after backoff', async () => {
    // `attachWithItems` waits on the REAL-timer `tick()` helper — switch to
    // fake timers only after setup, or that wait never resolves.
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 3);
    host.dispatch.mockClear();
    const resumesBefore = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.nextResumeMeta = { itemCount: 2, fullReplay: true };
      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      client.emitUpdate(CHAT_ID, agentMessage('aborted-1', 'nope'));
      client.emitReplayComplete(CHAT_ID, true);
      await vi.advanceTimersByTimeAsync(0);

      expect(transcripts(host)).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(999);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.resumeCalls.length).toBe(resumesBefore + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consecutive daemon-aborted replies back off exponentially, not flatly at 1s every time (finding 3)', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();
    const resumesBefore = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.nextResumeMeta = { itemCount: 1, fullReplay: true };
      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      client.emitReplayComplete(CHAT_ID, true); // 1st daemon abort
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(999);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.resumeCalls.length).toBe(resumesBefore + 2); // 1st automatic retry, at 1s

      client.emitReplayComplete(CHAT_ID, true); // 2nd daemon abort
      await vi.advanceTimersByTimeAsync(0);

      // Without the fix, `resume()` would have already reset the backoff
      // right after THIS reply arrived — before learning the window would
      // be aborted — so the 2nd retry would also land at 1s. With the fix,
      // the streak's delay has doubled, and nothing fires before 2s.
      await vi.advanceTimersByTimeAsync(1999);
      expect(client.resumeCalls.length).toBe(resumesBefore + 2);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.resumeCalls.length).toBe(resumesBefore + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a count mismatch still publishes and only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = makeFakeAcpClient({ capabilities: STAGED });
      const host = makeHost();
      const plane = new AcpSessionPlane(host);
      await attachWithItems(plane, client, 1);
      host.dispatch.mockClear();
      warn.mockClear();

      client.nextResumeMeta = { itemCount: 5, fullReplay: true };
      client.emitResync(CHAT_ID);
      await tick();
      for (let i = 0; i < 4; i++) client.emitUpdate(CHAT_ID, agentMessage(`m${i}`, `m${i}`));
      client.emitReplayComplete(CHAT_ID);

      const updates = transcripts(host);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.messages).toHaveLength(4);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('itemCount mismatch'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('AcpSessionPlane — staged replay aborts (D4)', () => {
  it('a resync inside an open (non-FullReplayRetry) window aborts it: no publish, one follow-up resume after backoff', async () => {
    vi.useFakeTimers();
    try {
      const client = makeFakeAcpClient({ capabilities: STAGED });
      const host = makeHost();
      const plane = new AcpSessionPlane(host);

      // The plain attach() opens a window directly (not through
      // FullReplayRetry) and never gets its own replay_complete.
      client.nextResumeMeta = { itemCount: 3, fullReplay: true };
      const attachPromise = plane.attach(client);
      // Attached immediately so Node never classifies the eventual
      // ReplayCancelledError rejection (below) as unhandled.
      const attachSettled = attachPromise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      const resumesAfterAttach = client.resumeCalls.length;

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      // Aborted immediately — no second resume call fires yet (backoff).
      expect(client.resumeCalls.length).toBe(resumesAfterAttach);

      await vi.advanceTimersByTimeAsync(999);
      expect(client.resumeCalls.length).toBe(resumesAfterAttach);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.resumeCalls.length).toBe(resumesAfterAttach + 1);

      expect(transcripts(host)).toHaveLength(0);
      // The original attach() rejected quietly (ReplayCancelledError) once superseded.
      expect(await attachSettled).toBeInstanceOf(Error);
      client.emitReplayComplete(CHAT_ID);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detach between request and reply settles resume and leaves FullReplayRetry idle for the next resync', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);

    const gate = deferred<ResumeResult>();
    const realResume = client.resume;
    client.resume = vi.fn((sessionId: string, _cwd: string, cursor) => {
      client.resumeCalls.push({ sessionId, cursor });
      return gate.promise;
    }) as typeof client.resume;

    client.emitResync(CHAT_ID);
    await tick();

    plane.detach();
    gate.resolve({ _meta: { '_mainframe.dev': { itemCount: 5, fullReplay: true } } } as unknown as ResumeResult);
    await tick();

    // No window ever got pushed for the detached-before-arrival reply, so
    // nothing is left waiting on a marker that will never come.
    client.resume = realResume;
    const reactivated = plane.reactivate(client);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes reactivate()'s own (full, since nothing ever settled) window
    await reactivated;
    const resumesAfterReactivate = client.resumeCalls.length;

    client.emitResync(CHAT_ID);
    await tick();
    expect(client.resumeCalls.length).toBe(resumesAfterReactivate + 1);
    client.emitReplayComplete(CHAT_ID);
  });

  it('frames after a gap abort never reach the visible accumulator', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 3);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 5, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('gap-1', 'gap 1'));
    client.emitUpdate(CHAT_ID, agentMessage('gap-2', 'gap 2'));

    client.emitGap();
    await tick();

    // The gap's own cursor resume is now pending; remaining creates for the
    // aborted window arrive before ITS marker does.
    client.emitUpdate(CHAT_ID, agentMessage('gap-3', 'gap 3'));
    client.emitUpdate(CHAT_ID, agentMessage('gap-4', 'gap 4'));
    client.emitUpdate(CHAT_ID, agentMessage('gap-5', 'gap 5'));

    expect(transcripts(host)).toHaveLength(0);

    // The aborted window's own marker finally arrives — still no publish.
    client.emitReplayComplete(CHAT_ID);
    expect(transcripts(host)).toHaveLength(0);
  });

  it('socket death (dispose) clears the window FIFO: a later marker is a no-op, and the listener is gone (finding 4)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = makeFakeAcpClient({ capabilities: STAGED });
      const host = makeHost();
      const plane = new AcpSessionPlane(host);
      await attachWithItems(plane, client, 1);

      client.nextResumeMeta = { itemCount: 2, fullReplay: true };
      client.emitResync(CHAT_ID);
      await tick();

      plane.dispose();

      // `dispose()` both drains the window FIFO AND unsubscribes every
      // listener (including `onReplayComplete`, finding 4 of the
      // independent review) — a marker that arrives anyway (e.g. a race)
      // reaches nothing at all: no crash, and no "no open window" warning
      // either, since the handler is no longer registered to produce one.
      expect(() => client.emitReplayComplete(CHAT_ID)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('AcpSessionPlane — staged windows close oldest first (finding 7 of the independent review)', () => {
  /**
   * The previous version of this test called `plane.reactivate(client)`
   * while still subscribed — `AcpSessionAttachment.reactivate()` returns
   * immediately whenever `this.subscribed` is already true, so no second
   * `resume()` was ever sent, and the test's "oldest first" assertions held
   * vacuously (the second `emitReplayComplete` just hit "no open window").
   * This version drives `AcpSessionAttachment.resumeFromGap()` directly,
   * twice, before either reply arrives — the first call's `resume()` only
   * reaches `client.resume()` (capturing the first deferred reply) and
   * returns control at its own `await`, so the FIFO is still empty when the
   * second call runs its own (no-op) abort-check and sends its own request.
   * Both windows are therefore genuinely open, independent, and unaborted;
   * each is tracked here via its OWN settlement (not transcript content,
   * which — for two concurrently-staging FULL windows specifically — would
   * hit the single-staging-slot limitation `AcpTranscriptStore` still has;
   * see this task's final report).
   */
  it('two overlapping gap-resumes open two independent (cursor) windows; replay_complete closes them oldest-first', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const { host, state } = makeAttachmentHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    const attached = attachment.attach(client as unknown as AcpSessionClientPort);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes attach()'s own (full) window
    await attached;
    // A non-null settled cursor makes a gap resume a CURSOR-kind resume
    // (not a `{type:'start'}` one, which is always 'full' regardless of
    // meta) — cursor windows never touch the shared staging slot.
    state.settledItemId = 'base-0';

    const gateA = deferred<ResumeResult>();
    const gateB = deferred<ResumeResult>();
    const gates = [gateA, gateB];
    let callIndex = 0;
    client.resume = vi.fn((sessionId: string, _cwd: string, cursor) => {
      client.resumeCalls.push({ sessionId, cursor });
      return gates[callIndex++]!.promise;
    }) as typeof client.resume;

    const gapA = attachment.resumeFromGap(); // request #1 — no window pushed yet
    const gapB = attachment.resumeFromGap(); // request #2 — FIFO still empty, nothing to abort

    const cursorMeta = { _meta: { '_mainframe.dev': { itemCount: 1 } } } as unknown as ResumeResult; // no fullReplay flag
    gateA.resolve(cursorMeta);
    await tick();
    gateB.resolve(cursorMeta);
    await tick();

    let aSettled = false;
    let bSettled = false;
    void gapA.then(() => {
      aSettled = true;
    });
    void gapB.then(() => {
      bSettled = true;
    });
    await tick();
    expect(aSettled).toBe(false);
    expect(bSettled).toBe(false);

    client.emitReplayComplete(CHAT_ID); // closes window A (oldest) first
    await tick();
    expect(aSettled).toBe(true);
    expect(bSettled).toBe(false);

    client.emitReplayComplete(CHAT_ID); // closes window B
    await tick();
    expect(bSettled).toBe(true);
  });
});

describe('AcpSessionPlane — settled cursor at publish (D4)', () => {
  it('a mid-turn full replay (state: running) leaves the settled cursor at start, not the newest staged item', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);

    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('running-1', 'still going'));
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    client.emitReplayComplete(CHAT_ID);

    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'start' } });
  });

  it('an idle replay sets the cursor to the last staged item, not a visible one', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);

    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('idle-1', 'done'));
    client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    client.emitReplayComplete(CHAT_ID);

    client.emitGap();
    await tick();
    expect(lastOf(client.resumeCalls)).toEqual({ sessionId: CHAT_ID, cursor: { type: 'item', itemId: 'idle-1' } });
  });
});

describe('AcpSessionPlane — live traffic after a replay (D4)', () => {
  it('a live update after replay_complete lands on the published transcript in order', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 2, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('p1', 'p1'));
    client.emitUpdate(CHAT_ID, agentMessage('p2', 'p2'));
    client.emitReplayComplete(CHAT_ID);

    client.emitUpdate(CHAT_ID, agentMessage('live-after', 'fresh'));

    const last = lastOf(transcripts(host))!;
    expect(idsOf(last.messages)).toEqual(['p1', 'p2', 'live-after']);
  });

  it('an unknown-id chunk with no resume pending requests one bounded resync; the same chunk while a resume is pending requests none', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    const resumesBefore = client.resumeCalls.length;

    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'unknown-1',
      content: { type: 'text', text: 'x' },
    });
    await tick();
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);
    client.emitReplayComplete(CHAT_ID);
    await tick(); // let that resync's FullReplayRetry run fully settle (inFlight: false) before starting a fresh one

    // While THIS bounded resync's own window is pending, the same shape of
    // frame for ANOTHER unknown id requests no second resync.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    const resumesNowPending = client.resumeCalls.length;
    expect(resumesNowPending).toBe(resumesBefore + 2);
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'unknown-2',
      content: { type: 'text', text: 'y' },
    });
    await tick();
    expect(client.resumeCalls.length).toBe(resumesNowPending);
    client.emitReplayComplete(CHAT_ID);
  });

  /**
   * Finding 6's original fix (arming the give-up backoff on a successful
   * needs-replay run too) was itself a bug the re-review caught: seven
   * consecutive unknown-id chunks rearmed that backoff seven times (1, 2, 4,
   * 8, 16, 30, 30s) until `gaveUp` latched PERMANENTLY — needs-replay never
   * resets it the way a resync does — silencing every later, genuinely
   * missing item for the rest of a healthy session. These four tests cover
   * the cooldown that replaces it (re-review finding 2).
   */
  it('one transient unknown id triggers exactly one replay and nothing more over a long, quiet cooldown', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    const resumesBefore = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.emitUpdate(CHAT_ID, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'unknown-1',
        content: { type: 'text', text: 'x' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);
      // Closes successfully — the daemon's own replay just didn't happen to
      // resolve this particular id (its create frame is STILL malformed).
      client.emitReplayComplete(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);

      // Nothing re-requests a replay — the cooldown should expire quietly.
      // Without the fix, the old backoff would still be armed and fire a
      // second replay at 1s regardless.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second, unrelated missing id arriving 60s later still triggers a replay — needs-replay never permanently gives up', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    const resumesBefore = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.emitUpdate(CHAT_ID, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'unknown-1',
        content: { type: 'text', text: 'x' },
      });
      await vi.advanceTimersByTimeAsync(0);
      client.emitReplayComplete(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);

      // Quiet for well past the (2s-30s) cooldown range — nothing re-requests.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);

      // Without the fix, seven chunks like the one above would already have
      // latched `gaveUp` permanently, and THIS unrelated id would be ignored
      // forever too.
      client.emitUpdate(CHAT_ID, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'unknown-2',
        content: { type: 'text', text: 'z' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.resumeCalls.length).toBe(resumesBefore + 2);
      client.emitReplayComplete(CHAT_ID);
    } finally {
      vi.useRealTimers();
    }
  });

  it('needs-replay recurring right after each completed replay grows the cooldown, capped at 30s', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    let expectedCalls = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.emitUpdate(CHAT_ID, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'unknown-1',
        content: { type: 'text', text: 'x' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expectedCalls += 1;
      expect(client.resumeCalls.length).toBe(expectedCalls);
      client.emitReplayComplete(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0); // arms the first cooldown: 2s

      // 2s → 4s → 8s → 16s → 30s → 30s (capped) — each one recurring right
      // on the heels of the PREVIOUS replay's own completion.
      for (const cooldownMs of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
        client.emitUpdate(CHAT_ID, {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'unknown-1',
          content: { type: 'text', text: 'x' },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(client.resumeCalls.length).toBe(expectedCalls); // coalesced, not run yet

        await vi.advanceTimersByTimeAsync(cooldownMs - 1);
        expect(client.resumeCalls.length).toBe(expectedCalls); // still not yet — exactly this cooldown's length

        await vi.advanceTimersByTimeAsync(1);
        expectedCalls += 1;
        expect(client.resumeCalls.length).toBe(expectedCalls); // fires right at expiry

        client.emitReplayComplete(CHAT_ID);
        await vi.advanceTimersByTimeAsync(0); // arms the NEXT (doubled, capped) cooldown
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('a flood of needs-replay requests inside one cooldown window collapses into exactly one follow-up run at expiry', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    const resumesBefore = client.resumeCalls.length;

    vi.useFakeTimers();
    try {
      client.emitUpdate(CHAT_ID, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'unknown-1',
        content: { type: 'text', text: 'x' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);
      client.emitReplayComplete(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0); // 2s cooldown armed

      // Five more patches, all inside the 2s cooldown — none may run early,
      // and at most ONE follow-up may ever run once it expires.
      for (let i = 0; i < 5; i++) {
        client.emitUpdate(CHAT_ID, {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'unknown-1',
          content: { type: 'text', text: `y${i}` },
        });
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);

      // Still quiet at the 1s mark — the OLD (give-up-backoff-based) fix
      // would have already fired its own follow-up here, one full second
      // before this 2s cooldown is actually due.
      await vi.advanceTimersByTimeAsync(1_000 - 500);
      expect(client.resumeCalls.length).toBe(resumesBefore + 1);

      await vi.advanceTimersByTimeAsync(1_000); // out to the 2s mark
      expect(client.resumeCalls.length).toBe(resumesBefore + 2); // exactly one follow-up, not five
      client.emitReplayComplete(CHAT_ID);
    } finally {
      vi.useRealTimers();
    }
  });

  it('transcript_cleared still wipes immediately, before the reattach round-trip', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 2);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitTranscriptCleared(CHAT_ID);
    await tick();

    const events = eventsOf(host);
    expect(events.findIndex((e) => e.type === 'transcript.cleared')).toBe(0);

    client.emitUpdate(CHAT_ID, agentMessage('fresh-1', 'fresh'));
    client.emitReplayComplete(CHAT_ID);
    expect(lastOf(transcripts(host))!.messages).toHaveLength(1);
  });

  it('a cursor resume does not stage — its frames dispatch live, one at a time, not batched at the marker', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    client.nextResumeMeta = undefined;
    await plane.reactivate(client);
    client.emitUpdate(CHAT_ID, agentMessage('cursor-1', 'cursor 1'));

    // Dispatched immediately, before any marker — proves it never staged.
    expect(transcripts(host)).toHaveLength(1);
    expect(idsOf(transcripts(host)[0]!.messages)).toEqual(['base-0', 'cursor-1']);

    client.emitReplayComplete(CHAT_ID);
    // The marker only clears `replaying` — no extra publish.
    expect(transcripts(host)).toHaveLength(1);
  });
});

describe('AcpSessionPlane — without replayComplete, the legacy reset-at-reply path is unchanged', () => {
  it('a plain (no-capability) client never pushes a window: a resync resolves synchronously, not pending on a marker', async () => {
    const client = makeFakeAcpClient(); // no capabilities — legacy
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();

    // No replay_complete needed — the legacy path already reset and is
    // ready for live frames.
    client.emitUpdate(CHAT_ID, agentMessage('legacy-1', 'legacy'));
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['legacy-1']);
  });
});

describe('AcpSessionAttachment — a reconnect mid-replay does not wedge the window queue (finding 1)', () => {
  it("drains the stale window instead of leaving it queued ahead of the reconnect's own resume", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    // A resync opens window A (full) on the ORIGINAL connection; it stages
    // a create that must never reach the visible transcript.
    client.nextResumeMeta = { itemCount: 2, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('A-1', 'a1'));

    // The socket dies and a NEW connection replaces it — not a live gap.
    // A's own `replay_complete` died with the old socket and will never
    // arrive. Without the fix, A stays queued (merely aborted) ahead of
    // whatever this gap's own resume opens next, so the single marker that
    // DOES arrive (meant for the new window) closes A instead — discarding
    // the new window's staging through the shared slot and leaving it
    // settled on nothing. `lastOf(transcripts(host))` would then be
    // `undefined` and the next line would throw.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitReconnect();
    await tick();

    // The gap's own resume (window B, on the NEW connection) is free to
    // close normally — nothing from A is left queued ahead of it.
    client.emitUpdate(CHAT_ID, agentMessage('B-1', 'b1'));
    client.emitReplayComplete(CHAT_ID);

    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['B-1']);

    // A's own marker, if it somehow arrived late, is just logged — not
    // misrouted onto B's (already-closed) slot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => client.emitReplayComplete(CHAT_ID)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no open window'));
    } finally {
      warn.mockRestore();
    }
  });

  it("a live-socket gap (no reconnect) keeps today's behavior — the open window stays queued, absorbing frames until its own marker", async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();
    client.emitUpdate(CHAT_ID, agentMessage('A-1', 'a1'));

    client.emitGap(); // same connection — NOT a reconnect
    await tick();

    // The live gap's own resume opened a second window; A's own marker
    // (now the oldest) still has to arrive and close it before anything
    // from the gap's window can publish.
    expect(transcripts(host)).toHaveLength(0);
    client.emitReplayComplete(CHAT_ID); // closes A — bookkeeping only, A was aborted but queued
    expect(transcripts(host)).toHaveLength(0);
  });
});

describe("AcpSessionAttachment — a reconnect that beats this chat's own gap signal is still caught (finding 1, remaining path)", () => {
  it('openWindow itself drains the stale window when a new resume opens on a reconnect resumeFromGap never saw', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const { host, state, discardReplay, completeReplay } = makeAttachmentHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    const attached = attachment.attach(client as unknown as AcpSessionClientPort);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes attach()'s own window
    await attached;
    state.settledItemId = 'base-0';

    // Window A opens (full) on the ORIGINAL connection — e.g. a resync.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();

    // The socket dies; a DIFFERENT caller's `ensureConnected()` lands a new
    // connection directly — that path never calls `notifyGap()` (only the
    // dead connection's OWN scheduled-reconnect timer does, and it can lag
    // behind by its own backoff). This attachment's `resumeFromGap()` never
    // runs, so `observedConnectionGeneration` is still stale.
    client.bumpConnectionGenerationSilently();

    // This chat's own `FullReplayRetry` timer (armed earlier, independently
    // of the socket) fires and opens window B — standing in for that timer
    // without needing to drive its real backoff delay.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    const reattached = attachment.reattach({ wipe: false, trigger: 'needs-replay' });
    await tick();

    // `openWindow` itself must have drained A the moment B's resume came
    // back — BEFORE any marker arrives at all. Without the fix, A is still
    // queued (merely aborted) ahead of B at this point.
    expect(discardReplay).toHaveBeenCalledWith({ full: true });
    discardReplay.mockClear();

    // The single marker that DOES arrive is now free to close B cleanly —
    // without the fix it would have closed stale A instead, discarding B's
    // own staging through the shared slot and leaving `reattached` hanging.
    client.emitReplayComplete(CHAT_ID);
    await reattached;
    expect(completeReplay).toHaveBeenCalledWith({ full: true }); // B published on its own marker
    expect(discardReplay).not.toHaveBeenCalled(); // B's own marker, not A's — nothing left to discard

    // The late gap finally arrives (the dead connection's own scheduled
    // reconnect catching up) — `resumeFromGap`'s drain must be a no-op here
    // (idempotent): B already closed, nothing stale is left queued.
    client.nextResumeMeta = { itemCount: 1, fullReplay: true };
    const gapResumed = attachment.resumeFromGap();
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes window C
    await gapResumed;
    expect(completeReplay).toHaveBeenCalledWith({ full: true });

    // resumePendingCount is back to 0 — a needs-replay request right now
    // fires a brand-new resume instead of being swallowed as "still pending".
    const resumesBefore = client.resumeCalls.length;
    attachment.routeNeedsReplay();
    await tick();
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);
    client.emitReplayComplete(CHAT_ID);
  });
});

describe('AcpSessionPlane — a send is not hidden behind a stale window after a reconnect that beat the gap (re-review LOW)', () => {
  it('sendPrompt reconciles the connection first — the live turn lands on the visible transcript immediately, and the stale window settles', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    // A stale full window (A) opens on the ORIGINAL connection and is still
    // staging off-screen — e.g. a resync in flight when the socket dies.
    client.nextResumeMeta = { itemCount: 2, fullReplay: true };
    client.emitResync(CHAT_ID);
    await tick();

    // Some OTHER caller's `ensureConnected()` lands a new connection — no
    // gap fires for THIS attachment yet (its own dead-connection gap can lag
    // by up to its backoff).
    client.bumpConnectionGenerationSilently();

    // The user sends from THIS chat — the daemon attaches the new
    // connection on the prompt path with a fresh stream. Without the fix,
    // `sendPrompt` never reconciles the connection, so the creates/turn this
    // starts would route into A's still-open staging (via `target()`) and
    // stay invisible until the late gap eventually drains it.
    await plane.sendPrompt('hello', {});
    client.emitUpdate(CHAT_ID, agentMessage('live-1', 'hi'));

    const last = lastOf(transcripts(host))!;
    expect(idsOf(last.messages)).toEqual(['base-0', 'live-1']);

    // A is settled (drained out of the FIFO), not merely aborted-but-queued
    // — its own late marker finds no open window at all, rather than
    // wrongly publishing A's stale staging over the live turn above.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => client.emitReplayComplete(CHAT_ID)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no open window'));
    } finally {
      warn.mockRestore();
    }
    // The live turn survived that late marker untouched.
    expect(idsOf(lastOf(transcripts(host))!.messages)).toEqual(['base-0', 'live-1']);
  });
});

describe('AcpSessionPlane — a live create after the first full replay carries no status (finding 2)', () => {
  it('does not leave origin: "replay" set on the published accumulator after publishStaging()', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    // The very first attach() is itself a full replay that stages off-screen
    // and publishes via `AcpTranscriptStore.publishStaging()` — exactly the
    // path that used to leave `replaying: true` set on the now-visible
    // accumulator forever.
    await attachWithItems(plane, client, 1);
    host.dispatch.mockClear();

    client.emitUpdate(CHAT_ID, agentMessage('live-after-attach', 'fresh live text'));

    const last = lastOf(transcripts(host))!;
    const liveMsg = last.messages.find((m) => m.id === 'live-after-attach')!;
    const part = (liveMsg.content as unknown as Array<{ type: string; status?: unknown }>)[0]!;
    expect(part.status).toBeUndefined();
  });
});

describe('AcpSessionAttachment — detach() removes the onReplayComplete listener (finding 4)', () => {
  it('a marker that arrives after detach() reaches nothing — no bookkeeping warning, no crash', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const host = makeHost();
    const plane = new AcpSessionPlane(host);
    await attachWithItems(plane, client, 1);

    plane.detach();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => client.emitReplayComplete(CHAT_ID)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('AcpSessionAttachment — overlapping resumes track pending status independently (finding 5)', () => {
  it('a second resume still awaiting its OWN reply keeps blocking needs-replay routing after the first settles', async () => {
    const client = makeFakeAcpClient({ capabilities: STAGED });
    const { host, state } = makeAttachmentHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    const attached = attachment.attach(client as unknown as AcpSessionClientPort);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes attach()'s own window
    await attached;
    state.settledItemId = 'base-0';

    const gateA = deferred<ResumeResult>();
    const gateB = deferred<ResumeResult>();
    const gates = [gateA, gateB];
    let callIndex = 0;
    client.resume = vi.fn((sessionId: string, _cwd: string, cursor) => {
      client.resumeCalls.push({ sessionId, cursor });
      return gates[callIndex++]!.promise;
    }) as typeof client.resume;

    const gapA = attachment.resumeFromGap(); // request #1
    void attachment.resumeFromGap(); // request #2 — stays pending for the rest of this test

    const cursorMeta = { _meta: { '_mainframe.dev': { itemCount: 1 } } } as unknown as ResumeResult;
    gateA.resolve(cursorMeta);
    await tick();
    client.emitReplayComplete(CHAT_ID); // closes window A — its OWN resume() settles
    await gapA;

    const resumesBeforeNeedsReplay = client.resumeCalls.length;
    attachment.routeNeedsReplay();
    await tick();

    // Without the fix (a boolean `resumePending`), A's settlement would
    // have wrongly cleared pending status even though request #2 — sent,
    // but still awaiting its OWN reply — is still outstanding, and this
    // would have fired a brand-new resume call right on top of it.
    expect(client.resumeCalls.length).toBe(resumesBeforeNeedsReplay);

    // Let the still-pending request resolve and close, so nothing leaks.
    gateB.resolve(cursorMeta);
    await tick();
    client.emitReplayComplete(CHAT_ID);
  });
});
