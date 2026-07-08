import { describe, expect, it } from 'vitest';
import type { SessionItem } from '../chat-to-thread-custom';
import { isSessionUnread, isSessionUnreadById } from '../session-unread';

function item(id: string, remoteId?: string): SessionItem {
  return {
    id,
    remoteId,
    title: id,
    status: 'regular',
    custom: {
      projectId: 'p',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      updatedAt: 0,
    },
  };
}

describe('session unread id matching', () => {
  it('matches the stable thread id', () => {
    expect(isSessionUnread(item('thread-1', 'chat-1'), new Set(['thread-1']))).toBe(true);
  });

  it('matches the daemon remote id for adopted threads', () => {
    expect(isSessionUnread(item('thread-1', 'chat-1'), new Set(['chat-1']))).toBe(true);
  });

  it('supports callback-based unread checks', () => {
    expect(isSessionUnreadById(item('thread-1', 'chat-1'), (id) => id === 'chat-1')).toBe(true);
  });
});
