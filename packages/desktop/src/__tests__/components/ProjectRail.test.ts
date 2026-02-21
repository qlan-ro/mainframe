import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import type { Chat } from '@mainframe/types';
import { useProjectsStore } from '../../renderer/store/projects.js';
import { useChatsStore } from '../../renderer/store/chats.js';
import { useTabsStore } from '../../renderer/store/tabs.js';
import { ProjectRail } from '../../renderer/components/ProjectRail.js';

vi.mock('../../renderer/lib/api/index.js', () => ({
  createProject: vi.fn(),
  removeProject: vi.fn().mockResolvedValue(undefined),
  getSkills: vi.fn(),
  getAgents: vi.fn(),
}));

// Electron preload bridge is not available in jsdom
Object.defineProperty(globalThis, 'window', {
  value: {
    ...globalThis.window,
    mainframe: { openDirectoryDialog: vi.fn() },
  },
  writable: true,
});

function makeProject(overrides: { id?: string; name?: string } = {}) {
  return {
    id: 'proj-1',
    name: 'Test',
    path: '/tmp/test',
    createdAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function resetStores(): void {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loading: false, error: null });
  useChatsStore.setState({
    chats: [],
    activeChatId: null,
    messages: new Map(),
    pendingPermissions: new Map(),
    processes: new Map(),
  });
  useTabsStore.setState({
    tabs: [],
    activePrimaryTabId: null,
    fileView: null,
    fileViewCollapsed: false,
    sidebarWidth: 300,
  });
}

describe('ProjectRail — project deletion', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  it('closes open tabs and clears chats when the active project is deleted', async () => {
    useProjectsStore.getState().setProjects([makeProject({ id: 'proj-1', name: 'Test' })]);
    useProjectsStore.getState().setActiveProject('proj-1');
    useChatsStore
      .getState()
      .setChats([makeChat({ id: 'chat-a', projectId: 'proj-1' }), makeChat({ id: 'chat-b', projectId: 'proj-1' })]);
    useTabsStore.getState().openChatTab('chat-a', 'Chat A');
    useTabsStore.getState().openChatTab('chat-b', 'Chat B');

    render(React.createElement(ProjectRail));

    // mouseenter on the project container to reveal the ✕ button
    const projectContainer = screen.getByTitle('Test').closest('div.relative')!;
    fireEvent.mouseEnter(projectContainer);

    // Click ✕ to enter confirm mode
    fireEvent.click(screen.getByLabelText('Remove project'));

    // Click ✓ to confirm — wrap in act so async handleConfirmDelete completes
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm remove project'));
    });

    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(useTabsStore.getState().activePrimaryTabId).toBeNull();
    expect(useChatsStore.getState().chats).toHaveLength(0);
    expect(useProjectsStore.getState().activeProjectId).toBeNull();
  });
});
