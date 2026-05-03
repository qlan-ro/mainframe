import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

// Mock stores and client before component import
vi.mock('../../renderer/store/index.js', () => ({
  useChatsStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeChatId: null,
      setActiveChat: vi.fn(),
      removeChat: vi.fn(),
      unreadChatIds: new Set(),
      detectedPrs: new Map(),
    }),
}));
vi.mock('../../renderer/store/tabs.js', () => ({
  useTabsStore: { getState: () => ({ openChatTab: vi.fn(), closeTab: vi.fn(), updateTabLabel: vi.fn() }) },
}));
vi.mock('../../renderer/store/adapters.js', () => ({
  useAdaptersStore: (selector: (s: unknown) => unknown) => selector({ adapters: [] }),
}));
vi.mock('../../renderer/lib/client.js', () => ({
  daemonClient: { createChat: vi.fn(), resumeChat: vi.fn() },
}));
vi.mock('../../renderer/lib/adapters.js', () => ({
  getDefaultModelForAdapter: vi.fn(() => 'claude-sonnet-4-6'),
  getAdapterLabel: vi.fn(() => 'Claude CLI'),
}));
vi.mock('../../renderer/lib/api.js', () => ({
  archiveChat: vi.fn(() => Promise.resolve()),
  renameChat: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../renderer/lib/delete-project.js', () => ({
  deleteProjectWithCleanup: vi.fn(),
}));
vi.mock('../../renderer/components/chat/assistant-ui/composer/composer-drafts.js', () => ({
  deleteDraft: vi.fn(),
}));

import { ProjectGroup } from '../../renderer/components/panels/ProjectGroup.js';
import { TooltipProvider } from '../../renderer/components/ui/tooltip.js';
import { daemonClient } from '../../renderer/lib/client.js';
import type { Project, Chat } from '@qlan-ro/mainframe-types';

const mockProject: Project = {
  id: 'proj-1',
  name: 'my-app',
  path: '/home/user/my-app',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockChat: Chat = {
  id: 'chat-1',
  projectId: 'proj-1',
  title: 'Session 1',
  adapterId: 'claude',
  model: 'claude-sonnet-4-6',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  displayStatus: 'idle',
};

function renderGroup(collapsed = false) {
  return render(
    <TooltipProvider>
      <ProjectGroup project={mockProject} chats={[mockChat]} collapsed={collapsed} onToggleCollapse={vi.fn()} />
    </TooltipProvider>,
  );
}

describe('ProjectGroup header layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the project name in the header', () => {
    renderGroup();
    expect(screen.getByText('my-app')).toBeInTheDocument();
  });

  it('renders a count badge with the number of chats', () => {
    renderGroup();
    // There is 1 chat; the badge should contain "1"
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('has a new session button with tooltip label referencing the project name', () => {
    renderGroup();
    const btn = screen.getByRole('button', { name: /new session in my-app/i });
    expect(btn).toBeInTheDocument();
  });

  it('calls daemonClient.createChat when the new-session button is clicked', async () => {
    renderGroup();
    const btn = screen.getByRole('button', { name: /new session in my-app/i });
    await userEvent.click(btn);
    expect(daemonClient.createChat).toHaveBeenCalledWith('proj-1', 'claude', 'claude-sonnet-4-6');
  });

  it('new-session button click does not bubble to toggle-collapse', async () => {
    const onToggleCollapse = vi.fn();
    render(
      <TooltipProvider>
        <ProjectGroup project={mockProject} chats={[mockChat]} collapsed={false} onToggleCollapse={onToggleCollapse} />
      </TooltipProvider>,
    );
    const btn = screen.getByRole('button', { name: /new session in my-app/i });
    await userEvent.click(btn);
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it('header row has a fixed-width right cluster so left content never reflows', () => {
    renderGroup();
    const btn = screen.getByRole('button', { name: /new session in my-app/i });
    // The right cluster (parent of + button and delete button) should be shrink-0
    const rightCluster = btn.parentElement;
    expect(rightCluster?.className).toMatch(/shrink-0/);
  });
});
