import { describe, it, beforeEach, vi, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReviewPanel } from './ReviewPanel';
import { useChatsStore } from '../../store/chats';
import { useUIStore } from '../../store/ui';
import * as gitApiModule from '../../lib/api/git';
import type { Chat } from '@qlan-ro/mainframe-types';

vi.mock('../../lib/api/git');

// DiffView pulls in monaco-editor at module-init time (via ../editor/setup),
// which requires browser APIs unavailable in jsdom (document.queryCommandSupported).
// The integration tests below cover load/error/close — diff rendering is out of scope.
vi.mock('./DiffView', () => ({
  DiffView: () => <div data-testid="diff-view" />,
}));

const mockGitApi = gitApiModule.gitApi as any;

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

    mockGitApi.getDiff = mockGetDiff;

    const chat = makeChat('chat-1');
    useChatsStore.setState({ chats: [chat], activeChatId: 'chat-1' });
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalledWith('proj-1', 'chat-1');
    });

    await waitFor(() => {
      expect(screen.queryByText(/src\/index.ts|src\/utils.ts/)).toBeTruthy();
    });
  });

  it('handles errors gracefully', async () => {
    const mockGetDiff = vi.fn().mockRejectedValueOnce(new Error('Failed to get diff'));
    mockGitApi.getDiff = mockGetDiff;

    const chat = makeChat('chat-4');
    useChatsStore.setState({ chats: [chat], activeChatId: 'chat-4' });
    useUIStore.setState({ reviewPanelOpen: true });

    render(<ReviewPanel />);

    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });
  });

  it('handles closing the panel', async () => {
    const mockGetDiff = vi.fn().mockResolvedValue({
      diffs: { 'src/index.ts': { main: 'old', worktree: 'new' } },
    });
    mockGitApi.getDiff = mockGetDiff;

    const chat = makeChat('chat-5');
    useChatsStore.setState({ chats: [chat], activeChatId: 'chat-5' });
    useUIStore.setState({ reviewPanelOpen: true });

    const { rerender } = render(<ReviewPanel />);

    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalled();
    });

    useUIStore.setState({ reviewPanelOpen: false });
    rerender(<ReviewPanel />);

    expect(screen.queryByText(/No changes to review|Select a file to view diff/)).not.toBeInTheDocument();
  });

  it('handles no active chat', () => {
    useChatsStore.setState({ chats: [], activeChatId: null });
    useUIStore.setState({ reviewPanelOpen: true });

    const { container } = render(<ReviewPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('handles panel closed state', () => {
    const chat = makeChat('chat-6');
    useChatsStore.setState({ chats: [chat], activeChatId: 'chat-6' });
    useUIStore.setState({ reviewPanelOpen: false });

    const { container } = render(<ReviewPanel />);
    expect(container.firstChild).toBeNull();
  });
});
