import { describe, it, expect } from 'vitest';
import { sessionStatus } from '../session-status';
import type { SessionCustom } from '../chat-to-thread-custom';

// `status` is Chat['status']; sessionStatus never reads it, so cast the stub.
const custom = (over: Partial<SessionCustom> = {}): SessionCustom =>
  ({
    projectId: 'p',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'regular',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    updatedAt: 0,
    ...over,
  }) as SessionCustom;

describe('sessionStatus', () => {
  it('is idle with nothing going on', () => {
    expect(sessionStatus(custom())).toBe('idle');
  });

  it('is running during a turn', () => {
    expect(sessionStatus(custom({ displayStatus: 'working', isRunning: true }))).toBe('running');
  });

  it('stays running while sub-agents outlive the turn', () => {
    expect(sessionStatus(custom({ displayStatus: 'working', isRunning: false }))).toBe('running');
  });

  it('needs you on the chat’s own gate — permission, question or plan', () => {
    expect(sessionStatus(custom({ displayStatus: 'waiting', hasPending: true }))).toBe('needs-you');
  });

  it.each(['sideChatWaiting', 'delegatedWaiting'] as const)('%s outranks a running turn', (flag) => {
    expect(sessionStatus(custom({ displayStatus: 'working', [flag]: true }))).toBe('needs-you');
  });

  it('a missing checkout or transcript does not hide what the session is doing', () => {
    expect(sessionStatus(custom({ worktreeMissing: true, displayStatus: 'working' }))).toBe('running');
    expect(sessionStatus(custom({ transcriptMissing: true, hasPending: true }))).toBe('needs-you');
    expect(sessionStatus(custom({ worktreeMissing: true }))).toBe('idle');
  });
});
