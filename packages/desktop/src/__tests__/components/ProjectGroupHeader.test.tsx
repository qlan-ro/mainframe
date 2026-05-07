import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({
  setActiveChat: vi.fn(),
  openChatTab: vi.fn(),
  closeTab: vi.fn(),
  updateTabLabel: vi.fn(),
  resumeChat: vi.fn(),
}));

let resizeObserverCallbacks: ResizeObserverCallback[] = [];

// Mock stores and client before component import
vi.mock('../../renderer/store/index.js', () => ({
  useChatsStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeChatId: null,
      setActiveChat: mocks.setActiveChat,
      removeChat: vi.fn(),
      addChat: vi.fn(),
      updateChat: vi.fn(),
      chats: [],
      unreadChatIds: new Set(),
      detectedPrs: new Map(),
    }),
}));
vi.mock('../../renderer/store/tabs.js', () => ({
  useTabsStore: {
    getState: () => ({
      openChatTab: mocks.openChatTab,
      closeTab: mocks.closeTab,
      updateTabLabel: mocks.updateTabLabel,
    }),
  },
}));
vi.mock('../../renderer/store/adapters.js', () => ({
  useAdaptersStore: (selector: (s: unknown) => unknown) => selector({ adapters: [] }),
}));
vi.mock('../../renderer/store/tags.js', () => ({
  useTagsStore: (selector: (s: unknown) => unknown) =>
    selector({ registry: [], refreshRegistry: vi.fn(), applyToChat: vi.fn() }),
}));
vi.mock('../../renderer/lib/client.js', () => ({
  daemonClient: { createChat: vi.fn(), resumeChat: mocks.resumeChat },
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
    resizeObserverCallbacks = [];
    vi.restoreAllMocks();
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as typeof ResizeObserver;
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

  it('action buttons cluster is hidden until hover/focus, matching session-row pattern', () => {
    renderGroup();
    const btn = screen.getByRole('button', { name: /new session in my-app/i, hidden: true });
    const cluster = btn.parentElement;
    expect(cluster?.className).toMatch(/\bhidden\b/);
    expect(cluster?.className).toMatch(/group-hover:flex/);
  });

  it('shows the adapter label on the session row metadata line when there are no tags', () => {
    renderGroup();
    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.queryByText('+ tag')).not.toBeInTheDocument();
  });

  it('shows the adapter label before tags on the session row metadata line', () => {
    render(
      <TooltipProvider>
        <ProjectGroup
          project={mockProject}
          chats={[{ ...mockChat, tags: ['frontend'] }]}
          collapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('·')).toBeInTheDocument();
  });

  it('pushes the worktree pill to the right while allowing the title to use available space', () => {
    render(
      <TooltipProvider>
        <ProjectGroup
          project={mockProject}
          chats={[{ ...mockChat, title: 'A very long session title', worktreePath: '/repo/.worktrees/feat-tags' }]}
          collapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </TooltipProvider>,
    );

    const title = screen.getByText('A very long session title');
    const worktree = screen.getByText('feat-tags');
    const pill = worktree.parentElement;

    expect(title.parentElement).toBe(pill?.closest('button'));
    expect(title.className).toContain('flex-1');
    expect(title.className).not.toContain('max-w-[50%]');
    expect(pill?.className).toContain('ml-auto');
    expect(pill?.className).toContain('rounded-full');
    expect(pill?.className).toContain('px-2.5');
    expect(pill?.className).toContain('bg-mf-hover');
    expect(pill?.className).toContain('text-mf-text-secondary');
    expect(title.parentElement?.parentElement?.className).toContain('grid-cols-[12px_minmax(0,1fr)]');
  });

  it('hides the worktree pill when the available title width drops below the threshold', async () => {
    // The row container is narrow enough that, after subtracting the status dot,
    // gaps, and the pill's natural width, the title would have <56px (the hysteresis
    // hide threshold). Specifically: 200 - 28 - 120 = 52 < 56.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement): number {
      return this.dataset.testid === 'session-title-row' ? 200 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement): number {
      return this.dataset.testid === 'worktree-pill' ? 120 : 0;
    });

    render(
      <TooltipProvider>
        <ProjectGroup
          project={mockProject}
          chats={[{ ...mockChat, worktreePath: '/repo/.worktrees/feat-tags' }]}
          collapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </TooltipProvider>,
    );

    for (const callback of resizeObserverCallbacks) {
      callback([], {} as ResizeObserver);
    }

    const pill = screen.getByTestId('worktree-pill');
    expect(pill.className).toContain('opacity-0');
    expect(pill).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the right-side time and hover actions in a centered area outside content rows', () => {
    renderGroup();

    const time = screen.getByText('Jan 1, 2024');
    const slot = time.parentElement;
    const metadataRow = screen.getByTestId('session-row-metadata');
    const actionsArea = screen.getByTestId('session-row-actions');

    expect(slot?.className).toContain('w-[104px]');
    expect(slot?.className).toContain('h-6');
    expect(slot?.className).toContain('shrink-0');
    expect(slot?.className).toContain('justify-end');
    expect(time.className).toContain('whitespace-nowrap');
    expect(actionsArea.className).toContain('self-center');
    expect(actionsArea).toContainElement(slot);
    expect(metadataRow).not.toContainElement(slot);
  });

  it('truncates worktree text inside the pill instead of clipping the whole pill', () => {
    render(
      <TooltipProvider>
        <ProjectGroup
          project={mockProject}
          chats={[
            {
              ...mockChat,
              worktreePath: '/repo/.worktrees/test-worktree-youcantakeitfromhere-super-long',
            },
          ]}
          collapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </TooltipProvider>,
    );

    const worktree = screen.getByText('test-worktree-youcantakeitfromhere-super-long');
    expect(worktree.className).toContain('min-w-0');
    expect(worktree.className).toContain('truncate');
    expect(worktree.parentElement?.className).not.toContain('truncate');
  });

  it('shows the full session title in a tooltip when hovering the truncated title', async () => {
    const longTitle = 'A very long session title that should be visible in full on hover';
    render(
      <TooltipProvider>
        <ProjectGroup
          project={mockProject}
          chats={[{ ...mockChat, title: longTitle, worktreePath: '/repo/.worktrees/feat-tags' }]}
          collapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </TooltipProvider>,
    );

    await userEvent.hover(screen.getByText(longTitle));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(longTitle);
  });

  it('does not open the tag popover when clicking session metadata', async () => {
    renderGroup();

    await userEvent.click(screen.getByText('Claude CLI'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects the session when clicking row background or metadata', async () => {
    renderGroup();

    await userEvent.click(screen.getByText('Claude CLI'));

    expect(mocks.setActiveChat).toHaveBeenCalledWith('chat-1');
    expect(mocks.openChatTab).toHaveBeenCalledWith('chat-1', 'Session 1');
    expect(mocks.resumeChat).toHaveBeenCalledWith('chat-1');
  });
});
