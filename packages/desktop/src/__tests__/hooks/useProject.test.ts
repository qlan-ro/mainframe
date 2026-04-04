import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useProject } from '../../renderer/hooks/useAppInit.js';
import { useSandboxStore } from '../../renderer/store/sandbox.js';
import { useChatsStore } from '../../renderer/store/chats.js';

vi.mock('../../renderer/lib/launch.js', () => ({
  fetchLaunchStatuses: vi.fn(),
}));

vi.mock('../../renderer/lib/api/projects-api.js', () => ({
  getChats: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  removeProject: vi.fn(),
  getAdapters: vi.fn().mockResolvedValue([]),
  archiveChat: vi.fn(),
  getChatMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../renderer/lib/client.js', () => ({
  daemonClient: {
    subscribeConnection: vi.fn().mockReturnValue(() => {}),
    subscribe: vi.fn(),
  },
}));

vi.mock('../../renderer/store/tabs.js', () => ({
  useTabsStore: {
    getState: vi.fn().mockReturnValue({
      switchProject: vi.fn(),
      tabs: [],
      activePrimaryTabId: null,
      openChatTab: vi.fn(),
    }),
  },
}));

vi.mock('../../renderer/store/projects.js', () => ({
  useProjectsStore: {
    getState: vi.fn().mockReturnValue({ projects: [] }),
  },
}));

vi.mock('../../renderer/store/skills.js', () => ({
  useSkillsStore: {
    getState: vi.fn().mockReturnValue({ fetchSkills: vi.fn(), fetchAgents: vi.fn() }),
  },
}));

describe('useProject', () => {
  beforeEach(() => {
    useSandboxStore.setState({ processStatuses: {} });
    useChatsStore.setState({ activeChatId: null, chats: [] });
    vi.clearAllMocks();
  });

  it('syncs launch statuses into useSandboxStore on mount', async () => {
    const { fetchLaunchStatuses } = await import('../../renderer/lib/launch.js');
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { 'Desktop App': 'running', api: 'stopped' },
      tunnelUrls: {},
      effectivePath: '/tmp/proj',
    });

    renderHook(() => useProject('proj-1'));

    await waitFor(() => {
      const statuses = useSandboxStore.getState().processStatuses['proj-1:/tmp/proj'];
      expect(statuses?.['Desktop App']).toBe('running');
      expect(statuses?.['api']).toBe('stopped');
    });
  });

  it('re-syncs launch statuses when activeChatId changes (worktree switch)', async () => {
    const { fetchLaunchStatuses } = await import('../../renderer/lib/launch.js');

    // First chat — main project path
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { dev: 'running' },
      tunnelUrls: {},
      effectivePath: '/tmp/proj',
    });

    useChatsStore.setState({ activeChatId: 'chat-1' });
    const { rerender } = renderHook(() => useProject('proj-1'));

    await waitFor(() => {
      expect(fetchLaunchStatuses).toHaveBeenCalledWith('proj-1', 'chat-1');
    });

    // Switch to a different chat (worktree session) — same project
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { dev: 'stopped' },
      tunnelUrls: {},
      effectivePath: '/tmp/proj-worktree',
    });

    act(() => useChatsStore.setState({ activeChatId: 'chat-2' }));
    rerender();

    await waitFor(() => {
      expect(fetchLaunchStatuses).toHaveBeenCalledWith('proj-1', 'chat-2');
      const wtStatuses = useSandboxStore.getState().processStatuses['proj-1:/tmp/proj-worktree'];
      expect(wtStatuses?.['dev']).toBe('stopped');
    });
  });
});
