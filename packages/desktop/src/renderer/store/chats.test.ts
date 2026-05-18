import { describe, it, expect, beforeEach } from 'vitest';
import { useChatsStore, mergeDetectedPrs } from './chats';
import type { Chat, DetectedPr } from '@qlan-ro/mainframe-types';

function makeChat(id: string, updatedAt: string, pinned = false, projectId = 'proj-1'): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    pinned,
    processState: null,
  };
}

describe('chat ordering', () => {
  beforeEach(() => {
    useChatsStore.setState({ chats: [], activeChatId: null });
  });

  it('setChats sorts by updatedAt DESC', () => {
    const older = makeChat('a', '2024-01-01T00:00:00.000Z');
    const newer = makeChat('b', '2024-06-01T00:00:00.000Z');
    useChatsStore.getState().setChats([older, newer]);
    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids).toEqual(['b', 'a']);
  });

  it('setChats puts pinned chats first regardless of updatedAt', () => {
    const recentUnpinned = makeChat('recent', '2024-06-01T00:00:00.000Z', false);
    const oldPinned = makeChat('pinned', '2024-01-01T00:00:00.000Z', true);
    useChatsStore.getState().setChats([recentUnpinned, oldPinned]);
    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('pinned');
    expect(ids[1]).toBe('recent');
  });

  it('updateChat re-sorts list when updatedAt changes', () => {
    const chatA = makeChat('a', '2024-06-01T00:00:00.000Z');
    const chatB = makeChat('b', '2024-01-01T00:00:00.000Z');
    useChatsStore.setState({ chats: [chatA, chatB] });

    // Chat B gets new activity — bumped to a later timestamp
    const updatedB = { ...chatB, updatedAt: '2024-12-01T00:00:00.000Z' };
    useChatsStore.getState().updateChat(updatedB);

    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('b');
    expect(ids[1]).toBe('a');
  });

  it('updateChat does not re-sort when updatedAt is unchanged', () => {
    const chatA = makeChat('a', '2024-06-01T00:00:00.000Z');
    const chatB = makeChat('b', '2024-01-01T00:00:00.000Z');
    useChatsStore.setState({ chats: [chatA, chatB] });

    // Only title changed — no re-sort expected
    const updatedB = { ...chatB, title: 'New Title' };
    useChatsStore.getState().updateChat(updatedB);

    const ids = useChatsStore.getState().chats.map((c) => c.id);
    expect(ids[0]).toBe('a');
    expect(ids[1]).toBe('b');
  });
});

describe('loadingChats', () => {
  beforeEach(() => {
    useChatsStore.setState({ loadingChats: new Set() });
  });

  it('setLoadingChat(true) marks chat as loading', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(true);
  });

  it('setLoadingChat(false) removes chat from loading set', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    useChatsStore.getState().setLoadingChat('chat-1', false);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(false);
  });

  it('tracks multiple chats independently', () => {
    useChatsStore.getState().setLoadingChat('chat-1', true);
    useChatsStore.getState().setLoadingChat('chat-2', true);
    useChatsStore.getState().setLoadingChat('chat-1', false);
    expect(useChatsStore.getState().loadingChats.has('chat-1')).toBe(false);
    expect(useChatsStore.getState().loadingChats.has('chat-2')).toBe(true);
  });

  it('setLoadingChat(false) on unknown chat is a no-op', () => {
    useChatsStore.getState().setLoadingChat('chat-x', false);
    expect(useChatsStore.getState().loadingChats.size).toBe(0);
  });
});

describe('unread state', () => {
  beforeEach(() => {
    useChatsStore.setState({
      unreadChatIds: new Set(),
      chats: [],
      activeChatId: null,
    });
  });

  it('markUnread adds chatId to set', () => {
    useChatsStore.getState().markUnread('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(true);
  });

  it('clearUnread removes chatId from set', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().clearUnread('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(false);
  });

  it('setActiveChat clears unread for that chat', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().setActiveChat('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-1')).toBe(false);
  });

  it('setActiveChat does not affect other chats', () => {
    useChatsStore.getState().markUnread('chat-1');
    useChatsStore.getState().markUnread('chat-2');
    useChatsStore.getState().setActiveChat('chat-1');
    expect(useChatsStore.getState().unreadChatIds.has('chat-2')).toBe(true);
  });
});

describe('filterProjectId reconciliation on setActiveChat', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatsStore.setState({
      chats: [
        makeChat('chat-a', '2024-01-01T00:00:00.000Z', false, 'proj-A'),
        makeChat('chat-b', '2024-01-01T00:00:00.000Z', false, 'proj-B'),
      ],
      activeChatId: null,
      filterProjectId: null,
    });
  });

  it("clears filterProjectId when active chat's project differs from the filter", () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-b');
    expect(useChatsStore.getState().filterProjectId).toBeNull();
    expect(localStorage.getItem('mf:filterProjectId')).toBeNull();
  });

  it("leaves filterProjectId unchanged when active chat's project matches the filter", () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-a');
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });

  it('leaves filterProjectId unchanged when no filter is set', () => {
    useChatsStore.getState().setActiveChat('chat-b');
    expect(useChatsStore.getState().filterProjectId).toBeNull();
  });

  it('leaves filterProjectId unchanged when active chat is cleared', () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat(null);
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });

  it('leaves filterProjectId unchanged when target chat is unknown', () => {
    useChatsStore.getState().setFilterProjectId('proj-A');
    useChatsStore.getState().setActiveChat('chat-missing');
    expect(useChatsStore.getState().filterProjectId).toBe('proj-A');
  });
});

const pr = (number: number, source: 'created' | 'mentioned' = 'mentioned', owner = 'o', repo = 'r'): DetectedPr => ({
  number,
  owner,
  repo,
  url: `https://github.com/${owner}/${repo}/pull/${number}`,
  source,
});

describe('mergeDetectedPrs', () => {
  it('returns DB entries when in-memory is empty', () => {
    const result = mergeDetectedPrs([], [pr(1), pr(2)]);
    expect(result.map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it('returns in-memory entries when DB is empty (live event raced ahead of DB write)', () => {
    const result = mergeDetectedPrs([pr(5)], []);
    expect(result.map((p) => p.number)).toEqual([5]);
  });

  it('dedups by URL across both sources', () => {
    const result = mergeDetectedPrs([pr(1)], [pr(1), pr(2)]);
    expect(result.map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it('upgrades source from mentioned → created when DB has the upgrade', () => {
    // Renderer disconnected with PR#7 'mentioned'. While offline, daemon saw
    // the gh pr create succeed and persisted PR#7 as 'created'. On reconnect,
    // setChats merges — DB version wins.
    const result = mergeDetectedPrs([pr(7, 'mentioned')], [pr(7, 'created')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('created');
  });

  it('does NOT downgrade source from created → mentioned', () => {
    // Inverse: renderer saw the live 'created' event but DB only has
    // 'mentioned' (race window between live emit and DB commit). Keep 'created'.
    const result = mergeDetectedPrs([pr(7, 'created')], [pr(7, 'mentioned')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('created');
  });

  it('preserves in-memory entries the DB does not yet know about', () => {
    const result = mergeDetectedPrs([pr(99)], [pr(1)]);
    expect(result.map((p) => p.number).sort()).toEqual([1, 99]);
  });
});

describe('setChats — detectedPrs reconciliation across reconnect', () => {
  beforeEach(() => {
    useChatsStore.setState({ chats: [], detectedPrs: new Map() });
  });

  function makeChatWithPrs(id: string, prs: DetectedPr[]): Chat {
    return {
      id,
      adapterId: 'claude',
      projectId: 'p1',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      lastContextTokensInput: 0,
      detectedPrs: prs,
    };
  }

  it('seeds the Map from DB on first setChats', () => {
    useChatsStore.getState().setChats([makeChatWithPrs('c1', [pr(1)])]);
    expect(
      useChatsStore
        .getState()
        .detectedPrs.get('c1')
        ?.map((p) => p.number),
    ).toEqual([1]);
  });

  it('merges DB into existing Map on reconnect — picks up DB-only PRs added while offline', () => {
    useChatsStore.setState({ detectedPrs: new Map([['c1', [pr(1)]]]) });
    // Daemon, while we were offline, persisted PR#2 too.
    useChatsStore.getState().setChats([makeChatWithPrs('c1', [pr(1), pr(2)])]);
    const result = useChatsStore.getState().detectedPrs.get('c1');
    expect(result?.map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it('upgrades source on reconnect when DB has source upgrade', () => {
    useChatsStore.setState({ detectedPrs: new Map([['c1', [pr(7, 'mentioned')]]]) });
    useChatsStore.getState().setChats([makeChatWithPrs('c1', [pr(7, 'created')])]);
    expect(useChatsStore.getState().detectedPrs.get('c1')?.[0]?.source).toBe('created');
  });
});
