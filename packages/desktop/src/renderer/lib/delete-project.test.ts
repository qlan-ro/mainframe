import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project, Chat } from '@qlan-ro/mainframe-types';

vi.mock('./api', () => ({
  removeProject: vi.fn(),
}));

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../components/chat/assistant-ui/composer/composer-drafts.js', () => ({
  deleteDraft: vi.fn(),
}));

vi.mock('../store', () => ({
  useChatsStore: { getState: vi.fn() },
  useProjectsStore: { getState: vi.fn() },
}));

vi.mock('../store/tabs', () => ({
  useTabsStore: { getState: vi.fn() },
}));

vi.mock('../store/toasts', () => ({
  useToastStore: { getState: vi.fn() },
}));

import { removeProject } from './api';
import { deleteDraft } from '../components/chat/assistant-ui/composer/composer-drafts.js';
import { useChatsStore, useProjectsStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { useToastStore } from '../store/toasts';
import { deleteProjectWithCleanup } from './delete-project';

const project: Project = {
  id: 'p1',
  name: 'My Project',
  path: '/tmp/p1',
  createdAt: '2026-04-21T00:00:00Z',
  lastOpenedAt: '2026-04-21T00:00:00Z',
};

function makeChat(id: string, projectId: string): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId,
    status: 'active',
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
  };
}

describe('deleteProjectWithCleanup', () => {
  const removeChat = vi.fn();
  const setActiveChat = vi.fn();
  const setFilterProjectId = vi.fn();
  const removeProjectFromStore = vi.fn();
  const closeTab = vi.fn();
  const addToast = vi.fn();
  const confirmSpy = vi.spyOn(window, 'confirm');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(removeProject).mockResolvedValue(undefined as never);
    vi.mocked(useToastStore.getState).mockReturnValue({ add: addToast } as never);
    vi.mocked(useProjectsStore.getState).mockReturnValue({ removeProject: removeProjectFromStore } as never);
    vi.mocked(useTabsStore.getState).mockReturnValue({ closeTab } as never);
    vi.mocked(useChatsStore.getState).mockReturnValue({
      filterProjectId: null,
      activeChatId: null,
      chats: [makeChat('c1', 'p1'), makeChat('c2', 'p1'), makeChat('c3', 'other')],
      removeChat,
      setActiveChat,
      setFilterProjectId,
    } as never);
  });

  it('does nothing when user cancels confirm', async () => {
    confirmSpy.mockReturnValue(false);
    await deleteProjectWithCleanup(project);
    expect(removeProject).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('calls API, removes project chats, deletes drafts, closes tabs, shows success toast', async () => {
    confirmSpy.mockReturnValue(true);
    await deleteProjectWithCleanup(project);

    expect(removeProject).toHaveBeenCalledWith('p1');
    expect(removeChat).toHaveBeenCalledWith('c1');
    expect(removeChat).toHaveBeenCalledWith('c2');
    expect(removeChat).not.toHaveBeenCalledWith('c3');
    expect(deleteDraft).toHaveBeenCalledWith('c1');
    expect(deleteDraft).toHaveBeenCalledWith('c2');
    expect(closeTab).toHaveBeenCalledWith('chat:c1');
    expect(closeTab).toHaveBeenCalledWith('chat:c2');
    expect(removeProjectFromStore).toHaveBeenCalledWith('p1');
    expect(addToast).toHaveBeenCalledWith('success', 'Project deleted', 'My Project');
  });

  it('resets filterProjectId when it pointed at deleted project', async () => {
    confirmSpy.mockReturnValue(true);
    vi.mocked(useChatsStore.getState).mockReturnValue({
      filterProjectId: 'p1',
      activeChatId: null,
      chats: [makeChat('c1', 'p1')],
      removeChat,
      setActiveChat,
      setFilterProjectId,
    } as never);

    await deleteProjectWithCleanup(project);
    expect(setFilterProjectId).toHaveBeenCalledWith(null);
  });

  it('leaves filterProjectId alone when it points elsewhere', async () => {
    confirmSpy.mockReturnValue(true);
    vi.mocked(useChatsStore.getState).mockReturnValue({
      filterProjectId: 'other-project',
      activeChatId: null,
      chats: [makeChat('c1', 'p1')],
      removeChat,
      setActiveChat,
      setFilterProjectId,
    } as never);

    await deleteProjectWithCleanup(project);
    expect(setFilterProjectId).not.toHaveBeenCalled();
  });

  it('clears activeChatId when the active chat belonged to the deleted project', async () => {
    confirmSpy.mockReturnValue(true);
    vi.mocked(useChatsStore.getState).mockReturnValue({
      filterProjectId: null,
      activeChatId: 'c1',
      chats: [makeChat('c1', 'p1'), makeChat('c3', 'other')],
      removeChat,
      setActiveChat,
      setFilterProjectId,
    } as never);

    await deleteProjectWithCleanup(project);
    expect(setActiveChat).toHaveBeenCalledWith(null);
  });

  it('leaves activeChatId when the active chat belongs to another project', async () => {
    confirmSpy.mockReturnValue(true);
    vi.mocked(useChatsStore.getState).mockReturnValue({
      filterProjectId: null,
      activeChatId: 'c3',
      chats: [makeChat('c1', 'p1'), makeChat('c3', 'other')],
      removeChat,
      setActiveChat,
      setFilterProjectId,
    } as never);

    await deleteProjectWithCleanup(project);
    expect(setActiveChat).not.toHaveBeenCalled();
  });

  it('shows error toast when API call fails', async () => {
    confirmSpy.mockReturnValue(true);
    vi.mocked(removeProject).mockRejectedValue(new Error('server boom'));

    await deleteProjectWithCleanup(project);

    expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete project', expect.stringContaining('server boom'));
    expect(removeProjectFromStore).not.toHaveBeenCalled();
    expect(removeChat).not.toHaveBeenCalled();
  });
});
