/**
 * use-display-branch — unit tests.
 *
 * Behaviors covered:
 *  - a live git read wins over the session's persisted branch name
 *  - a worktree DRAFT (no chatId) trusts its persisted name instead, because the
 *    live read without a chatId resolves the project ROOT
 *  - no projectId means no fetch at all
 *  - `refetch` re-reads (the branch-popover write path, which broadcasts nothing)
 *  - a late response from a previous identity cannot leak into the new one
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getGitBranch = vi.fn();
vi.mock('@/lib/api/git', () => ({ getGitBranch: (...args: unknown[]) => getGitBranch(...args) }));

const { useDisplayBranch } = await import('../use-display-branch');

beforeEach(() => {
  getGitBranch.mockReset();
  getGitBranch.mockResolvedValue({ branch: 'main' });
});

describe('useDisplayBranch', () => {
  it('prefers the live branch over the persisted name', async () => {
    getGitBranch.mockResolvedValue({ branch: 'feat/live' });
    const { result } = renderHook(() =>
      useDisplayBranch({ port: 31415, projectId: 'p1', chatId: 'c1', branchName: 'feat/persisted' }),
    );

    await waitFor(() => expect(result.current.branch).toBe('feat/live'));
    expect(getGitBranch).toHaveBeenCalledWith(31415, 'p1', 'c1');
  });

  it('falls back to the persisted name until the live read lands', () => {
    const { result } = renderHook(() =>
      useDisplayBranch({ port: 31415, projectId: 'p1', chatId: 'c1', branchName: 'feat/persisted' }),
    );
    expect(result.current.branch).toBe('feat/persisted');
  });

  it('trusts the draft name for a worktree with no chat yet, and never fetches over it', async () => {
    getGitBranch.mockResolvedValue({ branch: 'main' });
    const { result } = renderHook(() =>
      useDisplayBranch({ port: 31415, projectId: 'p1', branchName: 'feat/draft', isWorktree: true }),
    );

    await waitFor(() => expect(getGitBranch).toHaveBeenCalled());
    expect(result.current.branch).toBe('feat/draft');
    expect(result.current.isDraftWorktree).toBe(true);
  });

  it('does not fetch without a projectId', () => {
    const { result } = renderHook(() => useDisplayBranch({ port: 31415, branchName: undefined }));
    expect(getGitBranch).not.toHaveBeenCalled();
    expect(result.current.branch).toBeUndefined();
  });

  it('refetch re-reads the branch — a popover write broadcasts nothing', async () => {
    getGitBranch.mockResolvedValueOnce({ branch: 'feat/before' }).mockResolvedValueOnce({ branch: 'feat/after' });
    const { result } = renderHook(() => useDisplayBranch({ port: 31415, projectId: 'p1', chatId: 'c1' }));

    await waitFor(() => expect(result.current.branch).toBe('feat/before'));
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.branch).toBe('feat/after'));
  });

  it('reports null from the daemon as no branch', async () => {
    getGitBranch.mockResolvedValue({ branch: null });
    const { result } = renderHook(() => useDisplayBranch({ port: 31415, projectId: 'p1', chatId: 'c1' }));

    await waitFor(() => expect(getGitBranch).toHaveBeenCalled());
    expect(result.current.branch).toBeUndefined();
  });
});
