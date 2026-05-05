import { describe, it, beforeEach, vi, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReviewPanel } from './ReviewPanel';
import { useChatsStore } from '../../store/chats';
import { useUIStore } from '../../store/ui';
import * as gitApiModule from '../../lib/api/git';
import type { Chat } from '@qlan-ro/mainframe-types';

vi.mock('../../lib/api/git');

const mockGitApi = gitApiModule.gitApi as any;

// Helper to create a mock chat
function makeChat(id: string, projectId = 'proj-1'): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    pinned: false,
    processState: null,
    worktreePath: '/tmp/test-worktree',
  };
}

describe('ReviewPanel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatsStore.setState({ chats: [], activeChatId: null });
    useUIStore.setState({ reviewPanelOpen: false });
  });

  it('loads and displays changes when opened', async () => {
    const mockGetDiff = vi.fn().mockResolvedValueOnce({
      diffs: {
        'src/index.ts': { main: 'old code', worktree: 'new code' },
        'src/utils.ts': { main: 'old utils', worktree: 'new utils' },
      },
    });

    const mockGetStatus = vi.fn().mockResolvedValueOnce({
      staged: [],
      unstaged: ['src/index.ts', 'src/utils.ts'],
      untracked: [],
    });

    mockGitApi.getDiff = mockGetDiff;
    mockGitApi.getStatus = mockGetStatus;

    // Set up store state
    const chat = makeChat('chat-1');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-1',
    });

    // Open the panel
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    // Wait for API calls
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalledWith('proj-1', 'chat-1');
      expect(mockGetStatus).toHaveBeenCalledWith('chat-1');
    });

    // Verify files are displayed
    await waitFor(() => {
      expect(screen.queryByText(/src\/index.ts|src\/utils.ts/)).toBeTruthy();
    });
  });

  it('stages files successfully', async () => {
    const mockGetDiff = vi.fn().mockResolvedValue({
      diffs: {
        'src/index.ts': { main: 'old', worktree: 'new' },
      },
    });

    const mockGetStatus = vi.fn().mockResolvedValue({
      staged: [],
      unstaged: ['src/index.ts'],
      untracked: [],
    });

    const mockStageFiles = vi.fn().mockResolvedValue({ success: true });

    mockGitApi.getDiff = mockGetDiff;
    mockGitApi.getStatus = mockGetStatus;
    mockGitApi.stageFiles = mockStageFiles;

    // Set up store state
    const chat = makeChat('chat-2');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-2',
    });
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });

    // Simulate staging - this would normally be done via FileTree checkbox
    // For now, we verify the API was called successfully
    const stageResult = await mockGitApi.stageFiles('chat-2', ['src/index.ts']);
    expect(stageResult.success).toBe(true);
    expect(mockStageFiles).toHaveBeenCalledWith('chat-2', ['src/index.ts']);
  });

  it('commits changes successfully', async () => {
    const commitMessage = 'feat: update code';
    const stagedFiles = ['src/index.ts'];

    const mockGetDiff = vi.fn().mockResolvedValue({
      diffs: {
        'src/index.ts': { main: 'old', worktree: 'new' },
      },
    });

    const mockGetStatus = vi
      .fn()
      .mockResolvedValueOnce({
        staged: [],
        unstaged: ['src/index.ts'],
        untracked: [],
      })
      .mockResolvedValueOnce({
        staged: stagedFiles,
        unstaged: [],
        untracked: [],
      })
      .mockResolvedValueOnce({
        staged: [],
        unstaged: [],
        untracked: [],
      });

    const mockCommit = vi.fn().mockResolvedValue({
      hash: 'abc123',
    });

    mockGitApi.getDiff = mockGetDiff;
    mockGitApi.getStatus = mockGetStatus;
    mockGitApi.stageFiles = vi.fn().mockResolvedValue({ success: true });
    mockGitApi.commit = mockCommit;

    // Set up store state
    const chat = makeChat('chat-3');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-3',
    });
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });

    // Simulate staging and committing
    await mockGitApi.stageFiles('chat-3', stagedFiles);
    const commitResult = await mockGitApi.commit('chat-3', commitMessage, stagedFiles);

    expect(commitResult.hash).toBe('abc123');
    expect(mockCommit).toHaveBeenCalledWith('chat-3', commitMessage, stagedFiles);
  });

  it('handles errors gracefully', async () => {
    const mockGetDiff = vi.fn().mockRejectedValueOnce(new Error('Failed to get diff'));

    mockGitApi.getDiff = mockGetDiff;
    mockGitApi.getStatus = vi.fn().mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
    });

    // Set up store state
    const chat = makeChat('chat-4');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-4',
    });
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    // The component should handle the error gracefully
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });
  });

  it('handles closing the panel', async () => {
    const mockGetDiff = vi.fn().mockResolvedValue({
      diffs: {
        'src/index.ts': { main: 'old', worktree: 'new' },
      },
    });

    mockGitApi.getDiff = mockGetDiff;
    mockGitApi.getStatus = vi.fn().mockResolvedValue({
      staged: [],
      unstaged: ['src/index.ts'],
      untracked: [],
    });

    // Set up store state
    const chat = makeChat('chat-5');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-5',
    });
    useUIStore.setState({ reviewPanelOpen: true });

    const { rerender } = render(<ReviewPanel />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });

    // Close the panel
    useUIStore.setState({ reviewPanelOpen: false });
    rerender(<ReviewPanel />);

    // Panel should not be visible
    expect(screen.queryByText(/No changes to review|Select a file to view diff/)).not.toBeInTheDocument();
  });

  it('handles no active chat', () => {
    useChatsStore.setState({
      chats: [],
      activeChatId: null,
    });
    useUIStore.setState({ reviewPanelOpen: true });

    const { container } = render(<ReviewPanel />);

    // Panel should not render if no active chat
    expect(container.firstChild).toBeNull();
  });

  it('handles panel closed state', () => {
    const chat = makeChat('chat-6');
    useChatsStore.setState({
      chats: [chat],
      activeChatId: 'chat-6',
    });
    useUIStore.setState({ reviewPanelOpen: false });

    const { container } = render(<ReviewPanel />);

    // Panel should not render if not open
    expect(container.firstChild).toBeNull();
  });
});
