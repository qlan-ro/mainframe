/**
 * AcpSessionAttachment — full-replay coordination (todo #350, T40): the
 * shared in-flight guard over `_mainframe.dev/resync` and
 * `_mainframe.dev/transcript_cleared`, plus the resync backoff. Split out of
 * acp-session-attachment.test.ts to keep both files under the 300-line cap.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHAT_ID } from './acp-test-kit';
import { attachedWithStubbedResume, deferred, type ResumeResult } from './acp-attachment-support';

/** Real-timer macrotask hop — flushes every microtask the reattach chain queues. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AcpSessionAttachment — resync retry is bounded (T40)', () => {
  it('ignores a resync while a reattach is already in flight — one resume, not two', async () => {
    const { client, resume } = await attachedWithStubbedResume();
    const gate = deferred<ResumeResult>();
    resume.mockReturnValue(gate.promise);

    client.emitResync(CHAT_ID);
    client.emitResync(CHAT_ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(resume).toHaveBeenCalledTimes(1);
    gate.resolve({} as ResumeResult);
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

      resume.mockResolvedValue({} as ResumeResult);
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
      resume.mockResolvedValue({} as ResumeResult);
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
      resume.mockResolvedValue({} as ResumeResult);
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

describe('AcpSessionAttachment — one full replay at a time (T40)', () => {
  it('a resync arriving during a transcript_cleared reattach is ignored — one resume, not two', async () => {
    const { client, resume } = await attachedWithStubbedResume();
    const wipe = deferred<ResumeResult>();
    resume.mockReturnValue(wipe.promise);

    client.emitTranscriptCleared(CHAT_ID);
    await tick();
    client.emitResync(CHAT_ID);
    await tick();

    // The in-flight replay already re-seeds from scratch — the resync has
    // nothing to add.
    expect(resume).toHaveBeenCalledTimes(1);
    wipe.resolve({} as ResumeResult);
  });

  it('a transcript_cleared arriving during a resync reattach runs after it settles — a wipe is never dropped', async () => {
    const { client, resume } = await attachedWithStubbedResume();
    const first = deferred<ResumeResult>();
    const second = deferred<ResumeResult>();
    resume.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    client.emitResync(CHAT_ID);
    await tick();
    expect(resume).toHaveBeenCalledTimes(1);

    // Two wipes during the same in-flight replay coalesce into one follow-up.
    client.emitTranscriptCleared(CHAT_ID);
    client.emitTranscriptCleared(CHAT_ID);
    await tick();
    expect(resume).toHaveBeenCalledTimes(1);

    first.resolve({} as ResumeResult);
    await tick();
    expect(resume).toHaveBeenCalledTimes(2);

    second.resolve({} as ResumeResult);
    await tick();
    expect(resume).toHaveBeenCalledTimes(2);
  });
});
