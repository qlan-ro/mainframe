import { describe, it, expect } from 'vitest';
import type { ChatDelegation } from '@qlan-ro/mainframe-types';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { forkCount, lineageRelation, nestForks, parentLineageText } from '../fork-lineage';
import {
  countTasks,
  delegatedByValue,
  delegatedTasksOf,
  outboxHeadline,
  startedByTitle,
  taskChipLabel,
} from '../agent-provenance';
import { deriveSessionBadge } from '../session-status';

function item(
  id: string,
  overrides: Partial<SessionCustom> & { title?: string; status?: 'regular' | 'archived'; remoteId?: string } = {},
): SessionItem {
  const { title, status, remoteId, ...custom } = overrides;
  return {
    id,
    remoteId,
    title: title ?? `Session ${id}`,
    status: status ?? 'regular',
    custom: {
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
      updatedAt: 1_780_000_000_000,
      ...custom,
    },
  };
}

function task(taskId: string, status: ChatDelegation['status'] = 'running'): ChatDelegation {
  return { taskId, role: 'review', status };
}

describe('delegated children in the fork lineage', () => {
  const items = [
    item('parent'),
    item('fork', { parentChatId: 'parent' }),
    item('kid', { parentChatId: 'parent', delegation: task('task_kid') }),
  ];

  it('nests a delegated child under its parent like a fork', () => {
    expect(nestForks(items).map((r) => [r.item.id, r.depth])).toEqual([
      ['parent', 0],
      ['fork', 1],
      ['kid', 1],
    ]);
  });

  it('never counts a delegated child as a fork', () => {
    expect(forkCount(items, 'parent')).toBe(1);
  });

  it('reads "Delegated by" for a delegated child and "Forked from" otherwise', () => {
    expect(lineageRelation(items[2]!.custom)).toBe('delegated');
    expect(lineageRelation(items[1]!.custom)).toBe('fork');
    expect(parentLineageText({ kind: 'linked', title: 'Ship it' }, 'delegated')).toBe('Delegated by "Ship it"');
    expect(parentLineageText({ kind: 'linked', title: 'Ship it' })).toBe('Forked from "Ship it"');
  });
});

describe('parent waiting state', () => {
  it('a waiting delegated child shows on the parent badge, ahead of working', () => {
    const parent = item('p', { delegatedWaiting: true, displayStatus: 'working' }).custom;
    expect(deriveSessionBadge(parent, false)).toEqual({ base: 'waiting', unread: false });
  });
});

describe('startedByTitle', () => {
  const items = [item('local', { remoteId: 'boss', title: 'Boss' })];

  it('names a launched chat’s creator by its remote id', () => {
    expect(startedByTitle(items, { createdByChatId: 'boss' })).toBe('"Boss"');
    expect(startedByTitle([], { createdByChatId: 'gone' })).toBe('"Untitled session"');
  });

  it('is absent for the user’s own chats and for delegated children', () => {
    expect(startedByTitle(items, {})).toBeUndefined();
    expect(startedByTitle(items, { createdByChatId: 'boss', delegation: task('t') })).toBeUndefined();
  });
});

describe('delegatedTasksOf + taskChipLabel', () => {
  const items = [
    item('p'),
    item('a', { parentChatId: 'p', delegation: task('task_a'), updatedAt: 3 }),
    item('b', { parentChatId: 'p', delegation: task('task_b'), hasPending: true, updatedAt: 2 }),
    item('c', { parentChatId: 'p', delegation: task('task_c', 'completed'), updatedAt: 1, status: 'archived' }),
    item('fork', { parentChatId: 'p' }),
  ];

  it('lists only delegated children, most recently active first, with live waiting', () => {
    const rows = delegatedTasksOf(items, 'p');
    expect(rows.map((r) => [r.taskId, r.waiting])).toEqual([
      ['task_a', false],
      ['task_b', true],
      ['task_c', false],
    ]);
    expect(countTasks(rows)).toEqual({ running: 1, waiting: 1, done: 1 });
  });

  it('labels the chip by what is still open', () => {
    expect(taskChipLabel({ running: 2, waiting: 1, done: 4 })).toBe('2 tasks running · 1 waiting');
    expect(taskChipLabel({ running: 1, waiting: 0, done: 0 })).toBe('1 task running');
    expect(taskChipLabel({ running: 0, waiting: 2, done: 0 })).toBe('2 tasks waiting');
    expect(taskChipLabel({ running: 0, waiting: 0, done: 1 })).toBe('1 task done');
  });

  it('formats the hover card’s delegated-by value', () => {
    expect(delegatedByValue('"Ship it"', task('t', 'interrupted'))).toBe('"Ship it" · review · interrupted');
  });
});

describe('outboxHeadline', () => {
  const titleOf = (id: string) => `"${id.toUpperCase()}"`;

  it('names a single sender and counts its messages', () => {
    expect(outboxHeadline([{ entryId: 'ob1', fromChatId: 'a', preview: 'x' }], titleOf)).toBe(
      '1 message from "A" after this turn',
    );
    const two = [
      { entryId: 'ob1', fromChatId: 'a', preview: 'x' },
      { entryId: 'ob2', fromChatId: 'a', preview: 'y' },
    ];
    expect(outboxHeadline(two, titleOf)).toBe('2 messages from "A" after this turn');
  });

  it('counts senders when several are waiting', () => {
    const mixed = [
      { entryId: 'ob1', fromChatId: 'a', preview: 'x' },
      { entryId: 'ob2', fromChatId: 'b', preview: 'y' },
    ];
    expect(outboxHeadline(mixed, titleOf)).toBe('2 messages from 2 chats after this turn');
  });
});
