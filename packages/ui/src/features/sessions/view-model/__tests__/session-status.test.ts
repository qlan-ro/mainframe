import { describe, it, expect } from 'vitest';
import { deriveSessionBadge } from '../session-status';
import type { SessionCustom } from '../chat-to-thread-custom';

// `status` is Chat['status']; deriveSessionBadge never reads it, so cast the stub.
const base = (over: Partial<SessionCustom> = {}): SessionCustom =>
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

describe('deriveSessionBadge', () => {
  it('worktree-missing wins over everything', () => {
    expect(deriveSessionBadge(base({ worktreeMissing: true, displayStatus: 'working' }), true)).toEqual({
      base: 'worktree-missing',
      unread: true,
    });
  });
  it('working maps to base working', () => {
    expect(deriveSessionBadge(base({ displayStatus: 'working' }), false)).toEqual({ base: 'working', unread: false });
  });
  it('hasPending maps to waiting; unread rides alongside', () => {
    expect(deriveSessionBadge(base({ hasPending: true }), true)).toEqual({ base: 'waiting', unread: true });
  });
  it('idle with unread keeps base idle, unread true', () => {
    expect(deriveSessionBadge(base(), true)).toEqual({ base: 'idle', unread: true });
  });
  it('plain idle', () => {
    expect(deriveSessionBadge(base(), false)).toEqual({ base: 'idle', unread: false });
  });
});

describe('deriveSessionBadge — transcript-missing', () => {
  it('transcript-missing outranks working', () => {
    expect(deriveSessionBadge(base({ transcriptMissing: true, displayStatus: 'working' }), false)).toEqual({
      base: 'transcript-missing',
      unread: false,
    });
  });
  it('worktree-missing stays highest precedence when both flags are set', () => {
    expect(deriveSessionBadge(base({ worktreeMissing: true, transcriptMissing: true }), false)).toEqual({
      base: 'worktree-missing',
      unread: false,
    });
  });
  it('transcript-missing outranks waiting; unread rides alongside', () => {
    expect(deriveSessionBadge(base({ transcriptMissing: true, hasPending: true }), true)).toEqual({
      base: 'transcript-missing',
      unread: true,
    });
  });
});
