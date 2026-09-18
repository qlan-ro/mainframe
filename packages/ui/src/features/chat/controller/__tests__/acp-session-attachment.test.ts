/**
 * AcpSessionAttachment — direct unit tests for the connect/replay half split
 * out of AcpSessionPlane (todo #350 plan review fixes, group 3 step 0).
 * Behavior tests through the plane stay in `acp-session-plane.test.ts`; this
 * file covers the guard/bypass distinction that only this class's narrower
 * host interface can isolate cleanly (R2.2 / R1.3, T24); full-replay
 * coordination (resync/wipe) is in the sibling
 * acp-session-attachment-replay.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { AcpSessionAttachment, type AcpSessionClientPort } from '../acp-session-attachment';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';
import { makeHost, tick, type ResumeResult } from './acp-attachment-support';

describe('AcpSessionAttachment — empty full-replay guard', () => {
  it('refuses an empty full replay on a plain attach when the transcript already holds items', async () => {
    const client = makeFakeAcpClient() as unknown as AcpSessionClientPort;
    const { host, dispatch, resetAccumulator } = makeHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client);
    dispatch.mockClear();
    resetAccumulator.mockClear();

    (client as ReturnType<typeof makeFakeAcpClient>).nextResumeMeta = { itemCount: 0, fullReplay: true };
    await attachment.attach(client);

    expect(dispatch).toHaveBeenCalledWith({ type: 'history.refresh.refused' });
    expect(resetAccumulator).not.toHaveBeenCalled();
  });

  it('reattach() bypasses the guard — a server-initiated wipe wins even when items raced back in during the round-trip', async () => {
    const client = makeFakeAcpClient() as unknown as AcpSessionClientPort;
    // Simulates a live update repopulating the accumulator while the wipe's
    // resume() call is in flight (R2.2's race): the guard's inputs say
    // "refuse", but a reattach must never honor that.
    const { host, dispatch, resetAccumulator, resetSettledCursor } = makeHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client);
    dispatch.mockClear();
    resetAccumulator.mockClear();

    (client as ReturnType<typeof makeFakeAcpClient>).nextResumeMeta = { itemCount: 0, fullReplay: true };
    await attachment.reattach();

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'history.refresh.refused' });
    // Pre-reset (before the round-trip) plus the post-bypass reset in
    // resume() — both fire by design; reset is idempotent either way.
    expect(resetAccumulator).toHaveBeenCalled();
    expect(resetSettledCursor).toHaveBeenCalled();
  });
});

describe('AcpSessionAttachment — resync (T34)', () => {
  it('a resync re-replays WITHOUT dispatching transcript.cleared — cache eviction, not a wipe', async () => {
    const client = makeFakeAcpClient();
    const { host, dispatch } = makeHost();
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client as unknown as AcpSessionClientPort);
    const resumesBefore = client.resumeCalls.length;
    dispatch.mockClear();

    client.emitResync(CHAT_ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'transcript.cleared' });
    expect(client.resumeCalls.length).toBe(resumesBefore + 1);
  });

  it('ignores a resync for another session', async () => {
    const client = makeFakeAcpClient();
    const { host } = makeHost();
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client as unknown as AcpSessionClientPort);
    const resumesBefore = client.resumeCalls.length;

    client.emitResync('other-chat');
    await Promise.resolve();

    expect(client.resumeCalls.length).toBe(resumesBefore);
  });
});

describe('AcpSessionAttachment — a first attach that fails (T40)', () => {
  it('a reattach after it marks the session attached, so a later gap resumes and the empty-refresh guard is armed', async () => {
    const client = makeFakeAcpClient();
    const { host, state, dispatch } = makeHost();
    const attachment = new AcpSessionAttachment(host);
    const resume = vi.fn<AcpSessionClientPort['resume']>().mockRejectedValueOnce(new Error('resume failed'));
    client.resume = resume;

    await expect(attachment.attach(client as unknown as AcpSessionClientPort)).rejects.toThrow('resume failed');

    resume.mockResolvedValue({} as ResumeResult);
    client.emitResync(CHAT_ID);
    await tick();
    expect(resume).toHaveBeenCalledTimes(2);

    // A live update repopulates the thread; the daemon then answers the gap
    // resume with an empty full replay, which the guard must refuse.
    state.hasItems = true;
    resume.mockResolvedValue({ _meta: { '_mainframe.dev': { itemCount: 0 } } } as unknown as ResumeResult);
    client.emitGap();
    await tick();

    expect(resume).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledWith({ type: 'history.refresh.refused' });
  });
});
