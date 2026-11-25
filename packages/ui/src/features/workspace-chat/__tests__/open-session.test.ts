/** "Show this session beside the conversation": which sessions can, and what their tab is called. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSideChatRegistryForTests, registerSideChat } from '@/features/side-chat/side-chat-ids';
import { useLayoutStore } from '@/store/layout';
import { canOpenBeside, openSessionBeside, openTaskTab } from '../open-session';

type Threads = Parameters<typeof openTaskTab>[0];
const unarchive = vi.fn().mockResolvedValue(undefined);
const switchToThread = vi.fn();

function threads(mainThreadId: string, threadItems: unknown[]): Threads {
  return {
    getState: () => ({ mainThreadId, threadItems }),
    item: () => ({ unarchive }),
    switchToThread,
  } as unknown as Threads;
}

const tabs = () => useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs) ?? [];

beforeEach(() => {
  unarchive.mockClear();
  switchToThread.mockClear();
  __resetSideChatRegistryForTests();
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'main',
  });
});

describe('canOpenBeside', () => {
  it.each([
    ['another session', 'main', 'other', true],
    ['the conversation itself', 'main', 'main', false],
    ['a draft', 'main', '__LOCALID_1', false],
    ['anything, while the conversation is a draft', '__LOCALID_1', 'other', false],
    ['anything, with no conversation', null, 'other', false],
  ])('%s', (_, active, id, expected) => {
    expect(canOpenBeside(active, id)).toBe(expected);
  });

  it('refuses a side chat, which opens through its parent', () => {
    registerSideChat('side-1', 'main');
    expect(canOpenBeside('main', 'side-1')).toBe(false);
  });
});

describe('openSessionBeside', () => {
  it.each([
    ['a session', {}, 'session'],
    ['a fork', { parentChatId: 'main' }, 'fork'],
    ['a delegated task', { parentChatId: 'main', delegation: { taskId: 't' } }, 'task'],
  ])('opens %s as one, under its own title', (_, custom, role) => {
    openSessionBeside(threads('main', [{ id: 'other', remoteId: 'other', title: 'Race review', custom }]), 'other');
    expect(tabs()).toEqual([{ id: 'chat-other', kind: 'chat', title: 'Race review', chatId: 'other', role }]);
  });

  it('is keyed by the daemon’s id for a session created this run', () => {
    openSessionBeside(threads('main', [{ id: '__LOCALID_5x', remoteId: 'chat-5', title: 'New' }]), 'chat-5');
    expect(tabs().map((t) => t.chatId)).toEqual(['chat-5']);
  });
});

describe('openTaskTab', () => {
  it('restores an archived task first', () => {
    openTaskTab(threads('main', [{ id: 'kid', remoteId: 'kid', status: 'archived', title: 'T' }]), 'kid');
    expect(unarchive).toHaveBeenCalledOnce();
    expect(tabs().map((t) => t.chatId)).toEqual(['kid']);
  });

  it('opens in the chat column when there is nothing to stand beside', () => {
    openTaskTab(threads('__LOCALID_1', [{ id: 'kid', remoteId: 'kid', status: 'regular', title: 'T' }]), 'kid');
    expect(tabs()).toEqual([]);
    expect(switchToThread).toHaveBeenCalledWith('kid');
  });
});
