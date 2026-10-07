import { describe, it, expect } from 'vitest';
import type { ChatDelegation } from '@qlan-ro/mainframe-types';
import type { SessionCustom, SessionItem, ThreadListEntry } from '../chat-to-thread-custom';
import { isNestedTaskChat, listedThreadItemsToSessionItems, loadedChatIds, withoutTaskChats } from '../task-chats';

const CUSTOM: SessionCustom = {
  projectId: 'proj-a',
  adapterId: 'claude',
  tags: [],
  pinned: false,
  temporary: false,
  noProject: false,
  status: 'active',
  displayStatus: 'idle',
  hasPending: false,
  detectedPrs: [],
  worktreeMissing: false,
  transcriptMissing: false,
  updatedAt: 1,
};

const TASK: ChatDelegation = { taskId: 'task_kid', role: 'review', status: 'running' };

function item(id: string, custom: Partial<SessionCustom> = {}, status: SessionItem['status'] = 'regular'): SessionItem {
  return { id, remoteId: id, title: id, status, custom: { ...CUSTOM, ...custom } };
}

function entry(it: SessionItem): ThreadListEntry {
  return { id: it.id, remoteId: it.remoteId, title: it.title, status: it.status, custom: { ...it.custom } };
}

describe('task chats', () => {
  it('drops a task chat whose parent is loaded, and keeps forks', () => {
    const items = [
      item('parent'),
      item('fork', { parentChatId: 'parent' }),
      item('kid', { parentChatId: 'parent', delegation: TASK }),
    ];
    expect(withoutTaskChats(items).map((it) => it.id)).toEqual(['parent', 'fork']);
  });

  it('keeps an orphaned task chat listed — its parent is gone, so no card can open it', () => {
    const orphan = item('kid', { parentChatId: 'deleted', delegation: TASK });
    expect(withoutTaskChats([orphan])).toEqual([orphan]);
  });

  it('matches the parent by its daemon id when the thread id differs', () => {
    const parent: SessionItem = { ...item('__LOCALID_1'), remoteId: 'chat-p' };
    const ids = loadedChatIds([parent]);
    expect(isNestedTaskChat({ parentChatId: 'chat-p', delegation: TASK }, ids)).toBe(true);
    expect(isNestedTaskChat({ parentChatId: 'chat-p' }, ids)).toBe(false);
  });

  it('lists regular sessions only, finding an archived parent for a task chat', () => {
    const entries = [
      item('parent', {}, 'archived'),
      item('kid', { parentChatId: 'parent', delegation: TASK }),
      item('solo'),
    ].map(entry);
    expect(listedThreadItemsToSessionItems(entries).map((it) => it.id)).toEqual(['solo']);
  });
});
