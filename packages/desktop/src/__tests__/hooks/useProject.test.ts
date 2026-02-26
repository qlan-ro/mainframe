import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProject } from '../../renderer/hooks/useAppInit.js';
import { useSandboxStore } from '../../renderer/store/sandbox.js';

vi.mock('../../renderer/lib/launch.js', () => ({
  fetchLaunchStatuses: vi.fn(),
}));

vi.mock('../../renderer/lib/api.js', () => ({
  getChats: vi.fn().mockResolvedValue([]),
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
    vi.clearAllMocks();
  });

  it('syncs launch statuses into useSandboxStore on mount', async () => {
    const { fetchLaunchStatuses } = await import('../../renderer/lib/launch.js');
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      'Desktop App': 'running',
      api: 'stopped',
    });

    renderHook(() => useProject('proj-1'));

    await waitFor(() => {
      const statuses = useSandboxStore.getState().processStatuses['proj-1'];
      expect(statuses?.['Desktop App']).toBe('running');
      expect(statuses?.['api']).toBe('stopped');
    });
  });
});
