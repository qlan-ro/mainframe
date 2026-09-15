/**
 * AcpSessionAttachment — direct unit tests for the connect/replay half split
 * out of AcpSessionPlane (todo #350 plan review fixes, group 3 step 0).
 * Behavior tests through the plane stay in `acp-session-plane.test.ts`; this
 * file covers the guard/bypass distinction that only this class's narrower
 * host interface can isolate cleanly (R2.2 / R1.3, T24).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import {
  AcpSessionAttachment,
  type AcpSessionAttachmentHost,
  type AcpSessionClientPort,
} from '../acp-session-attachment';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

function makeHost(overrides: { hasAccumulatedItems?: () => boolean } = {}) {
  const dispatch = vi.fn<(event: ChatStateEvent) => void>();
  const resetAccumulator = vi.fn<() => void>();
  const resetSettledCursor = vi.fn<() => void>();
  const host: AcpSessionAttachmentHost = {
    getChatId: () => CHAT_ID,
    dispatch,
    isDisposed: () => false,
    getLastSettledItemId: () => null,
    resetSettledCursor,
    resetAccumulator,
    hasAccumulatedItems: overrides.hasAccumulatedItems ?? (() => false),
    onSessionUpdate: vi.fn(),
    onPermissionRequest: vi.fn(),
    onGateResolvedForSession: vi.fn(),
  };
  return { host, dispatch, resetAccumulator, resetSettledCursor };
}

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** An attached attachment whose `resume` is a mock the test drives. */
async function attachedWithStubbedResume() {
  const client = makeFakeAcpClient();
  const { host } = makeHost();
  const attachment = new AcpSessionAttachment(host);
  await attachment.attach(client as unknown as AcpSessionClientPort);
  const resume = vi.fn<AcpSessionClientPort['resume']>();
  client.resume = resume;
  return { attachment, client, resume };
}

describe('AcpSessionAttachment — resync retry is bounded (T40)', () => {
  it('ignores a resync while a reattach is already in flight — one resume, not two', async () => {
    const { client, resume } = await attachedWithStubbedResume();
    const gate = deferred<Awaited<ReturnType<AcpSessionClientPort['resume']>>>();
    resume.mockReturnValue(gate.promise);

    client.emitResync(CHAT_ID);
    client.emitResync(CHAT_ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(resume).toHaveBeenCalledTimes(1);
    gate.resolve({} as Awaited<ReturnType<AcpSessionClientPort['resume']>>);
  });

  it('backs off between consecutive failed reattaches — 1s, then 2s', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { client, resume } = await attachedWithStubbedResume();
      resume.mockRejectedValue(new Error('resume failed'));

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(resume).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(resume).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_999);
      expect(resume).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(resume).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('a successful resume resets the delay — the next failure waits 1s again, not 4s', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { client, resume } = await attachedWithStubbedResume();
      resume.mockRejectedValue(new Error('resume failed'));

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resume).toHaveBeenCalledTimes(2);

      resume.mockResolvedValue({} as Awaited<ReturnType<AcpSessionClientPort['resume']>>);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(resume).toHaveBeenCalledTimes(3);

      resume.mockRejectedValue(new Error('resume failed again'));
      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(999);
      expect(resume).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(resume).toHaveBeenCalledTimes(5);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
  it('gives up once the backoff hits its cap, until a gap resumes successfully', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { client, resume } = await attachedWithStubbedResume();
      resume.mockRejectedValue(new Error('resume failed'));

      client.emitResync(CHAT_ID);
      // 1s + 2s + 4s + 8s + 16s + 30s of retries after the first attempt.
      await vi.advanceTimersByTimeAsync(61_000);
      expect(resume).toHaveBeenCalledTimes(7);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(CHAT_ID));

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(resume).toHaveBeenCalledTimes(7);

      // A gap resume that succeeds clears the streak, so resync is live again.
      resume.mockResolvedValue({} as Awaited<ReturnType<AcpSessionClientPort['resume']>>);
      client.emitGap();
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(8);

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(9);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
  it('a gap resume clears the streak but does not swallow the armed retry', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { client, resume } = await attachedWithStubbedResume();
      resume.mockRejectedValue(new Error('resume failed'));

      client.emitResync(CHAT_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(1);

      // A gap resume succeeds mid-backoff. It replays from the settled cursor
      // at the tail, so it cannot stand in for the resync's full re-replay.
      resume.mockResolvedValue({} as Awaited<ReturnType<AcpSessionClientPort['resume']>>);
      await vi.advanceTimersByTimeAsync(500);
      client.emitGap();
      await vi.advanceTimersByTimeAsync(0);
      expect(resume).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(500);
      expect(resume).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
