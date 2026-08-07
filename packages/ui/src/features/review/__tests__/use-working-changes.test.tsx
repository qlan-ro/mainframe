// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { toChangesSummary, useWorkingChanges } from '../use-working-changes';

const getGitStatus = vi.fn();
const getWorkingStat = vi.fn();
const getGitBranch = vi.fn();
const getBranchDiffs = vi.fn();
const getSessionFiles = vi.fn();

let emit: (event: unknown) => void = () => {};

vi.mock('@/lib/api/git', () => ({
  getGitStatus: (...args: unknown[]) => getGitStatus(...args),
  getWorkingStat: (...args: unknown[]) => getWorkingStat(...args),
  getGitBranch: (...args: unknown[]) => getGitBranch(...args),
  getBranchDiffs: (...args: unknown[]) => getBranchDiffs(...args),
}));
vi.mock('@/lib/api/files', () => ({
  getSessionFiles: (...args: unknown[]) => getSessionFiles(...args),
}));
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (handler: (event: unknown) => void) => {
      emit = handler;
      return () => {
        emit = () => {};
      };
    },
  },
}));

const PORT = 31415;
const PROJECT = 'proj-1';
const CHAT = 'chat-1';

const options = (over: Record<string, unknown> = {}) => ({
  port: PORT,
  projectId: PROJECT,
  chatId: CHAT,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  getGitStatus.mockResolvedValue([
    { path: 'src/a.ts', status: 'M' },
    { path: 'src/b.ts', status: 'A' },
  ]);
  getWorkingStat.mockResolvedValue({
    files: [{ path: 'src/a.ts', additions: 10, deletions: 2 }],
    totalAdditions: 10,
    totalDeletions: 2,
  });
  getGitBranch.mockResolvedValue({ branch: 'design/right-sidebar-revamp' });
  getBranchDiffs.mockResolvedValue({
    branch: 'design/right-sidebar-revamp',
    baseBranch: 'main',
    mergeBase: 'abc1234',
    files: [
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/gone.ts', status: 'D' },
    ],
  });
  getSessionFiles.mockResolvedValue(['src/a.ts', 'docs/plan.md']);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useWorkingChanges — uncommitted scope', () => {
  it('merges git status with the working stat', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files).toEqual([
      { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 },
      { path: 'src/b.ts', status: 'added', additions: 0, deletions: 0 },
    ]);
    expect(result.current.totalAdditions).toBe(10);
    expect(result.current.totalDeletions).toBe(2);
    expect(result.current.branch).toBe('design/right-sidebar-revamp');
    expect(result.current.error).toBe(false);
  });

  it('is the default scope and passes the chat id to every call', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitStatus).toHaveBeenCalledWith(PORT, PROJECT, CHAT);
    expect(getWorkingStat).toHaveBeenCalledWith(PORT, PROJECT, CHAT);
    expect(getGitBranch).toHaveBeenCalledWith(PORT, PROJECT, CHAT);
    expect(getBranchDiffs).not.toHaveBeenCalled();
    expect(getSessionFiles).not.toHaveBeenCalled();
  });

  it('survives a missing working stat with undefined totals rather than zeros', async () => {
    getWorkingStat.mockRejectedValue(new Error('not a repo'));
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.current.totalAdditions).toBeUndefined();
    expect(result.current.totalDeletions).toBeUndefined();
    expect(result.current.error).toBe(false);
  });

  it('survives a missing branch', async () => {
    getGitBranch.mockRejectedValue(new Error('detached'));
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.branch).toBeNull();
    expect(result.current.error).toBe(false);
  });

  it('reports an error when the status call fails', async () => {
    getGitStatus.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.files).toEqual([]);
  });
});

describe('useWorkingChanges — session scope', () => {
  it('returns paths with no status and no counts', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ scope: 'session' })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSessionFiles).toHaveBeenCalledWith(PORT, CHAT);
    expect(result.current.files).toEqual([{ path: 'src/a.ts' }, { path: 'docs/plan.md' }]);
    expect(result.current.files[0]?.status).toBeUndefined();
    expect(result.current.files[0]?.additions).toBeUndefined();
    expect(result.current.totalAdditions).toBeUndefined();
    expect(result.current.totalDeletions).toBeUndefined();
  });

  it('fetches nothing without a chat', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ scope: 'session', chatId: undefined })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSessionFiles).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
  });
});

describe('useWorkingChanges — branch scope', () => {
  it('returns per-file statuses plus the comparison metadata', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ scope: 'branch' })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getBranchDiffs).toHaveBeenCalledWith(PORT, PROJECT, CHAT);
    expect(result.current.files).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/gone.ts', status: 'deleted' },
    ]);
    expect(result.current.branch).toBe('design/right-sidebar-revamp');
    expect(result.current.baseBranch).toBe('main');
    expect(result.current.mergeBase).toBe('abc1234');
  });

  it('carries no counts, since the daemon reports none for this scope', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ scope: 'branch' })));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalAdditions).toBeUndefined();
    expect(result.current.files[0]?.deletions).toBeUndefined();
  });
});

describe('useWorkingChanges — enabled gate', () => {
  it('fetches nothing while disabled', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ enabled: false })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual([]);
  });

  it('fetches once it is enabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useWorkingChanges(options({ enabled })), {
      initialProps: { enabled: false },
    });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitStatus).toHaveBeenCalledTimes(1);
  });

  it('fetches nothing without a project', async () => {
    const { result } = renderHook(() => useWorkingChanges(options({ projectId: null })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
  });
});

describe('useWorkingChanges — invalidation', () => {
  it('refetches on a context.updated for the active chat', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getGitStatus).toHaveBeenCalledTimes(1);
    act(() => emit({ type: 'context.updated', chatId: CHAT }));
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });

  it('ignores a context.updated for another chat', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => emit({ type: 'context.updated', chatId: 'chat-2' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitStatus).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated daemon events', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => emit({ type: 'chat.updated', chatId: CHAT }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitStatus).toHaveBeenCalledTimes(1);
  });

  it('refetches when the window regains focus', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });

  it('does not listen while disabled', async () => {
    renderHook(() => useWorkingChanges(options({ enabled: false })));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getGitStatus).not.toHaveBeenCalled();
  });

  it('refetch() reloads on demand', async () => {
    const { result } = renderHook(() => useWorkingChanges(options()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refetch());
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });
});

describe('toChangesSummary', () => {
  it('projects the panel row: file count plus totals', () => {
    expect(
      toChangesSummary({
        files: [
          { path: 'a', status: 'modified', additions: 10, deletions: 2 },
          { path: 'b', status: 'added', additions: 3, deletions: 0 },
        ],
        totalAdditions: 13,
        totalDeletions: 2,
      }),
    ).toEqual({ fileCount: 2, additions: 13, deletions: 2 });
  });

  it('keeps absent totals undefined rather than zero', () => {
    expect(toChangesSummary({ files: [{ path: 'a' }] })).toEqual({
      fileCount: 1,
      additions: undefined,
      deletions: undefined,
    });
  });

  it('reads an empty tree as a real zero', () => {
    expect(toChangesSummary({ files: [], totalAdditions: 0, totalDeletions: 0 })).toEqual({
      fileCount: 0,
      additions: 0,
      deletions: 0,
    });
  });
});
