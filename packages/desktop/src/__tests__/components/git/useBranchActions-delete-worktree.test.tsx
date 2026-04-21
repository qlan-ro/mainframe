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

import { getProjectWorktrees, deleteWorktree } from '../../../renderer/lib/api';

describe('useBranchActions.handleDeleteWorktree — busyAction tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('sets busyAction to `deleteWorktree:<name>` during the delete, clears after', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [{ path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' }],
    });

    let resolveDelete: () => void = () => {};
    (deleteWorktree as any).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveDelete = r;
        }),
    );

    const { result } = renderHook(() => useBranchActions('proj-1', undefined, vi.fn(), vi.fn()));

    let deletePromise!: Promise<boolean>;
    await act(async () => {
      deletePromise = result.current.handleDeleteWorktree('feat-x', 'feat-x');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.busyAction).toBe('deleteWorktree:feat-x');

    await act(async () => {
      resolveDelete();
      await deletePromise;
    });

    expect(result.current.busyAction).toBeNull();
  });
});
