import { it, expect } from 'vitest';
import { countByBaseStatus } from '../count-by-base-status';
import type { SessionItem } from '../chat-to-thread-custom';

function item(id: string, displayStatus: 'idle' | 'working', hasPending = false, worktreeMissing = false): SessionItem {
  return {
    id,
    remoteId: id,
    title: id,
    status: 'regular',
    custom: {
      projectId: 'p',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus,
      hasPending,
      detectedPrs: [],
      worktreeMissing,
      updatedAt: 0,
    },
  } as unknown as SessionItem;
}

it('buckets sessions by base status (unread does not bucket)', () => {
  const items = [
    item('a', 'working'),
    item('b', 'idle', true), // waiting
    item('c', 'idle', false), // idle
    item('d', 'idle', false), // idle, unread (unread does not change the bucket)
    item('e', 'idle', false, true), // worktree-missing
  ];
  const unread = new Set<string>(['d']);
  expect(countByBaseStatus(items, unread)).toEqual({
    'worktree-missing': 1,
    'transcript-missing': 0,
    working: 1,
    waiting: 1,
    idle: 2,
  });
});
