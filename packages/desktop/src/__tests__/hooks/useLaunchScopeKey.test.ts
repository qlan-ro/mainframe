import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../renderer/store/chats.js', () => ({
  useChatsStore: vi.fn(),
}));

vi.mock('../../renderer/store/projects.js', () => ({
  useProjectsStore: vi.fn(),
}));

import { useChatsStore } from '../../renderer/store/chats.js';
import { useProjectsStore } from '../../renderer/store/projects.js';

describe('useLaunchScopeKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no active chat', async () => {
    vi.mocked(useChatsStore).mockImplementation((selector: any) => {
      const state = { activeChatId: null, chats: [] };
      return selector(state);
    });
    vi.mocked(useProjectsStore).mockImplementation((selector: any) => {
      const state = { projects: [] };
      return selector(state);
    });

    const { useLaunchScopeKey } = await import('../../renderer/hooks/useLaunchScopeKey.js');
    const { result } = renderHook(() => useLaunchScopeKey());
    expect(result.current).toBeNull();
  });

  it('returns projectId:worktreePath when chat has worktree', async () => {
    vi.mocked(useChatsStore).mockImplementation((selector: any) => {
      const state = {
        activeChatId: 'chat-1',
        chats: [{ id: 'chat-1', projectId: 'proj-1', worktreePath: '/tmp/wt-1' }],
      };
      return selector(state);
    });
    vi.mocked(useProjectsStore).mockImplementation((selector: any) => {
      const state = { projects: [{ id: 'proj-1', path: '/tmp/proj' }] };
      return selector(state);
    });

    const { useLaunchScopeKey } = await import('../../renderer/hooks/useLaunchScopeKey.js');
    const { result } = renderHook(() => useLaunchScopeKey());
    expect(result.current).toBe('proj-1:/tmp/wt-1');
  });

  it('falls back to project.path when chat has no worktree', async () => {
    vi.mocked(useChatsStore).mockImplementation((selector: any) => {
      const state = {
        activeChatId: 'chat-2',
        chats: [{ id: 'chat-2', projectId: 'proj-1' }],
      };
      return selector(state);
    });
    vi.mocked(useProjectsStore).mockImplementation((selector: any) => {
      const state = { projects: [{ id: 'proj-1', path: '/tmp/proj' }] };
      return selector(state);
    });

    const { useLaunchScopeKey } = await import('../../renderer/hooks/useLaunchScopeKey.js');
    const { result } = renderHook(() => useLaunchScopeKey());
    expect(result.current).toBe('proj-1:/tmp/proj');
  });
});
