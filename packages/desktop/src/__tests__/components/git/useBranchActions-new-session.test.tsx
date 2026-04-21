import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBranchActions } from '../../../renderer/components/git/useBranchActions';

vi.mock('../../../renderer/lib/api', () => ({
  getGitBranches: vi.fn().mockResolvedValue({ current: 'main', local: [], remote: [], worktrees: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ files: [] }),
  getProjectWorktrees: vi.fn(),
  deleteWorktree: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitMerge: vi.fn(),
  gitRebase: vi.fn(),
  gitAbort: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitUpdateAll: vi.fn(),
}));

vi.mock('../../../renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../renderer/lib/client', () => ({
  daemonClient: { createChat: vi.fn() },
}));

vi.mock('../../../renderer/lib/adapters', () => ({
  getDefaultModelForAdapter: vi.fn(() => 'claude-sonnet-4-5'),
}));

import { getProjectWorktrees } from '../../../renderer/lib/api';
import { daemonClient } from '../../../renderer/lib/client';
import { toast } from '../../../renderer/lib/toast';

describe('useBranchActions.handleNewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves worktree path and calls daemonClient.createChat with attachWorktree', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [
        { path: '/projects/my-repo', branch: 'refs/heads/main' },
        { path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' },
      ],
    });

    const { result } = renderHook(() => useBranchActions('proj-1', 'chat-a', vi.fn(), vi.fn()));

    let success = false;
    await act(async () => {
      success = await result.current.handleNewSession('feat-x', 'feat-x');
    });

    expect(success).toBe(true);
    expect(daemonClient.createChat).toHaveBeenCalledWith('proj-1', 'claude', 'claude-sonnet-4-5', undefined, {
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
  });

  it('shows an error toast and does not create chat when the worktree cannot be resolved', async () => {
    (getProjectWorktrees as any).mockResolvedValue({ worktrees: [] });

    const { result } = renderHook(() => useBranchActions('proj-1', undefined, vi.fn(), vi.fn()));

    let success = false;
    await act(async () => {
      success = await result.current.handleNewSession('ghost', 'ghost');
    });

    expect(success).toBe(true);
    expect(daemonClient.createChat).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ghost'));
  });

  it('calls onClose after a successful creation', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [{ path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' }],
    });
    const onClose = vi.fn();

    const { result } = renderHook(() => useBranchActions('proj-1', undefined, vi.fn(), onClose));

    await act(async () => {
      await result.current.handleNewSession('feat-x', 'feat-x');
    });

    expect(onClose).toHaveBeenCalled();
  });
});
