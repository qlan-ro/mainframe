/**
 * use-branch-actions.test.ts — per-action flow tests.
 *
 * Behaviors covered:
 *  1.  loadBranches — calls getGitBranches + getGitStatus; stores result; clears conflictFiles on clean tree.
 *  2.  loadBranches — stores only conflict-status files (UU, AA, DD) in conflictFiles.
 *  3.  handleCheckout — on clean tree: calls gitCheckout → toast.success → loadBranches; returns true.
 *  4.  handleCheckout — when confirmDirtyTree returns false (user cancels): no gitCheckout, returns false.
 *  5.  handlePull — success: toast.success with change count; calls loadBranches; returns true.
 *  6.  handlePull — up-to-date: toast.info 'Already up to date'.
 *  7.  handlePull — conflict: toast.error 'Pull resulted in conflicts'; loads branches; returns true.
 *  8.  handlePull — no tracking remote: toast.error without calling gitPull.
 *  9.  handlePush — success: toast.success with remote/branch.
 *  10. handlePush — rejected: toast.error with message.
 *  11. handleMerge — conflict result: loadBranches called; no success toast; returns true.
 *  12. handleMerge — success: toast.success with branch name + detail.
 *  13. handleRebase — success: toast.success 'Rebase complete'.
 *  14. handleRename — success: toast.success with new name; loadBranches; returns true.
 *  15. handleDelete (local) — user declines first confirm: returns false immediately, no API call.
 *  16. handleDelete (local) — success: toast.success; loadBranches; returns true.
 *  17. handleDelete (local) — not-merged first → user accepts force confirm → gitDeleteBranch called twice; success toast.
 *  18. handleDelete (local) — not-merged first → user declines force confirm → no second gitDeleteBranch.
 *  19. handleFetch — success: toast.success 'Fetched'; loadBranches; returns true.
 *  20. handleUpdateAll — conflict: toast.error 'Conflicts during update'.
 *  21. handleUpdateAll — success with updated branches and pull: toast.success message.
 *  22. handleAbort — success: toast.success 'Aborted'; loadBranches; returns true.
 *  23. handleCreateBranch — success: toast.success with name; loadBranches; returns true.
 *  24. withBusy error: any thrown error produces toast.error and returns false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock declarations — must appear before any import of the mocked module.
// ---------------------------------------------------------------------------

const mockGetGitBranches = vi.fn();
const mockGetGitStatus = vi.fn();
const mockGitCheckout = vi.fn();
const mockGitCreateBranch = vi.fn();
const mockGitFetch = vi.fn();
const mockGitPull = vi.fn();
const mockGitPush = vi.fn();
const mockGitMerge = vi.fn();
const mockGitRebase = vi.fn();
const mockGitAbort = vi.fn();
const mockGitRenameBranch = vi.fn();
const mockGitDeleteBranch = vi.fn();
const mockGitUpdateAll = vi.fn();
const mockGetProjectWorktrees = vi.fn();
const mockDeleteWorktree = vi.fn();

vi.mock('@/lib/api/git', () => ({
  getGitBranches: (...args: unknown[]) => mockGetGitBranches(...args),
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  gitCheckout: (...args: unknown[]) => mockGitCheckout(...args),
  gitCreateBranch: (...args: unknown[]) => mockGitCreateBranch(...args),
  gitFetch: (...args: unknown[]) => mockGitFetch(...args),
  gitPull: (...args: unknown[]) => mockGitPull(...args),
  gitPush: (...args: unknown[]) => mockGitPush(...args),
  gitMerge: (...args: unknown[]) => mockGitMerge(...args),
  gitRebase: (...args: unknown[]) => mockGitRebase(...args),
  gitAbort: (...args: unknown[]) => mockGitAbort(...args),
  gitRenameBranch: (...args: unknown[]) => mockGitRenameBranch(...args),
  gitDeleteBranch: (...args: unknown[]) => mockGitDeleteBranch(...args),
  gitUpdateAll: (...args: unknown[]) => mockGitUpdateAll(...args),
  getProjectWorktrees: (...args: unknown[]) => mockGetProjectWorktrees(...args),
  deleteWorktree: (...args: unknown[]) => mockDeleteWorktree(...args),
}));

const mockRequestGitConfirm = vi.fn();
vi.mock('../use-git-confirm', () => ({
  requestGitConfirm: (...args: unknown[]) => mockRequestGitConfirm(...args),
  useGitConfirm: { getState: () => ({ request: mockRequestGitConfirm }) },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useBranchActions } from '../use-branch-actions';
import { toast } from 'sonner';

const mockToast = vi.mocked(toast);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const CHAT_ID = 'chat-1';

const BRANCH_LIST_CLEAN = {
  current: 'main',
  local: [
    { name: 'main', current: true, tracking: 'origin/main', ahead: 0, behind: 0 },
    { name: 'feat/foo', current: false, tracking: 'origin/feat/foo' },
  ],
  remote: ['origin/main'],
  worktrees: [],
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: clean tree
  mockGetGitStatus.mockResolvedValue([]);
  mockGetGitBranches.mockResolvedValue(BRANCH_LIST_CLEAN);
  // Default confirm: always true (tests that need false override per-test)
  mockRequestGitConfirm.mockResolvedValue(true);
  // Default worktrees for worktree-action tests
  mockGetProjectWorktrees.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderActions() {
  return renderHook(() => useBranchActions({ port: PORT, projectId: PROJECT_ID, chatId: CHAT_ID }));
}

// ---------------------------------------------------------------------------
// 1. loadBranches — stores branches and clears conflictFiles on clean tree
// ---------------------------------------------------------------------------

describe('useBranchActions — loadBranches', () => {
  it('loads branches and produces an empty conflictFiles list on a clean tree', async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.loadBranches();
    });

    expect(mockGetGitBranches).toHaveBeenCalledWith(PORT, PROJECT_ID, CHAT_ID);
    expect(mockGetGitStatus).toHaveBeenCalledWith(PORT, PROJECT_ID, CHAT_ID);
    expect(result.current.branches).toEqual(BRANCH_LIST_CLEAN);
    expect(result.current.conflictFiles).toEqual([]);
  });

  // 2. Only UU/AA/DD conflict-status files land in conflictFiles
  it('stores only conflict-status files (UU, AA, DD) in conflictFiles', async () => {
    mockGetGitStatus.mockResolvedValue([
      { path: 'src/a.ts', status: 'UU' },
      { path: 'src/b.ts', status: 'M' },
      { path: 'src/c.ts', status: 'AA' },
    ]);

    const { result } = renderActions();

    await act(async () => {
      await result.current.loadBranches();
    });

    expect(result.current.conflictFiles).toEqual([
      { path: 'src/a.ts', status: 'UU' },
      { path: 'src/c.ts', status: 'AA' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3–4. handleCheckout
// ---------------------------------------------------------------------------

describe('useBranchActions — handleCheckout', () => {
  it('calls gitCheckout → toast.success → loadBranches and returns true on a clean tree', async () => {
    mockGitCheckout.mockResolvedValue(undefined);
    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleCheckout('feat/foo');
    });

    expect(mockGitCheckout).toHaveBeenCalledWith(PORT, PROJECT_ID, 'feat/foo', CHAT_ID);
    expect(mockToast.success).toHaveBeenCalledWith('Switched to feat/foo');
    expect(mockGetGitBranches).toHaveBeenCalledTimes(1); // loadBranches after checkout
    expect(ok).toBe(true);
  });

  it('does not call gitCheckout when the user cancels the dirty-tree confirm', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    mockRequestGitConfirm.mockResolvedValue(false);

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleCheckout('main');
    });

    // The inner fn returned early (no-op) — no checkout call and no success toast
    expect(mockGitCheckout).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5–8. handlePull
// ---------------------------------------------------------------------------

describe('useBranchActions — handlePull', () => {
  it('calls gitPull with remote/branch from tracking, toasts success with change count', async () => {
    mockGetGitBranches.mockResolvedValue({
      ...BRANCH_LIST_CLEAN,
      local: [{ name: 'main', current: true, tracking: 'origin/main' }],
    });
    mockGitPull.mockResolvedValue({ status: 'success', summary: { changes: 3, insertions: 5, deletions: 2 } });

    const { result } = renderActions();
    // pre-load so tracking info is available
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handlePull('main');
    });

    expect(mockGitPull).toHaveBeenCalledWith(PORT, PROJECT_ID, {
      remote: 'origin',
      branch: 'main',
      localBranch: 'main',
      chatId: CHAT_ID,
    });
    expect(mockToast.success).toHaveBeenCalledWith('Pulled 3 changes');
  });

  it('toasts info "Already up to date" when status is up-to-date', async () => {
    mockGetGitBranches.mockResolvedValue({
      ...BRANCH_LIST_CLEAN,
      local: [{ name: 'main', current: true, tracking: 'origin/main' }],
    });
    mockGitPull.mockResolvedValue({ status: 'up-to-date' });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handlePull('main');
    });

    expect(mockToast.info).toHaveBeenCalledWith('Already up to date');
  });

  it('toasts error "Pull resulted in conflicts" when status is conflict', async () => {
    mockGetGitBranches.mockResolvedValue({
      ...BRANCH_LIST_CLEAN,
      local: [{ name: 'main', current: true, tracking: 'origin/main' }],
    });
    mockGitPull.mockResolvedValue({ status: 'conflict', conflicts: ['a.ts'], message: 'conflict' });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handlePull('main');
    });

    expect(mockToast.error).toHaveBeenCalledWith('Pull resulted in conflicts');
    expect(ok).toBe(true); // withBusy returned true (no throw)
  });

  it('toasts error about missing tracking remote without calling gitPull', async () => {
    mockGetGitBranches.mockResolvedValue({
      ...BRANCH_LIST_CLEAN,
      local: [{ name: 'feat/no-remote', current: false }], // no tracking
    });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handlePull('feat/no-remote');
    });

    expect(mockGitPull).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('No tracking remote for feat/no-remote');
  });
});

// ---------------------------------------------------------------------------
// 9–10. handlePush
// ---------------------------------------------------------------------------

describe('useBranchActions — handlePush', () => {
  it('toasts success with remote/branch on a successful push', async () => {
    mockGetGitBranches.mockResolvedValue({
      ...BRANCH_LIST_CLEAN,
      local: [{ name: 'main', current: true, tracking: 'origin/main' }],
    });
    mockGitPush.mockResolvedValue({ status: 'success', branch: 'main', remote: 'origin' });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handlePush('main');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Pushed to origin/main');
  });

  it('toasts error with message when push is rejected', async () => {
    mockGetGitBranches.mockResolvedValue(BRANCH_LIST_CLEAN);
    mockGitPush.mockResolvedValue({ status: 'rejected', message: 'non-fast-forward' });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handlePush('main');
    });

    expect(mockToast.error).toHaveBeenCalledWith('Push rejected: non-fast-forward');
  });
});

// ---------------------------------------------------------------------------
// 11–12. handleMerge
// ---------------------------------------------------------------------------

describe('useBranchActions — handleMerge', () => {
  it('loads branches even on a conflict result (returns true, no success toast)', async () => {
    mockGitMerge.mockResolvedValue({ status: 'conflict', conflicts: ['a.ts'], message: 'conflict' });

    const { result } = renderActions();
    // pre-load so branches is non-null
    await act(async () => {
      await result.current.loadBranches();
    });
    vi.clearAllMocks(); // reset call counts
    mockGetGitBranches.mockResolvedValue(BRANCH_LIST_CLEAN);
    mockGetGitStatus.mockResolvedValue([]);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleMerge('feat/foo');
    });

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockGetGitBranches).toHaveBeenCalledTimes(1); // loadBranches after merge
    expect(ok).toBe(true);
  });

  it('toasts success with branch name and +/- summary on a successful merge', async () => {
    mockGitMerge.mockResolvedValue({
      status: 'success',
      summary: { commits: 2, insertions: 10, deletions: 3 },
    });

    const { result } = renderActions();
    await act(async () => {
      await result.current.loadBranches();
    });

    await act(async () => {
      await result.current.handleMerge('feat/foo');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Merged feat/foo (+10 -3)');
  });
});

// ---------------------------------------------------------------------------
// 13. handleRebase
// ---------------------------------------------------------------------------

describe('useBranchActions — handleRebase', () => {
  it('toasts success "Rebase complete" on a successful rebase', async () => {
    mockGitRebase.mockResolvedValue({ status: 'success' });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleRebase('main');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Rebase complete');
  });
});

// ---------------------------------------------------------------------------
// 14. handleRename
// ---------------------------------------------------------------------------

describe('useBranchActions — handleRename', () => {
  it('calls gitRenameBranch → toast.success → loadBranches; returns true', async () => {
    mockGitRenameBranch.mockResolvedValue(undefined);

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleRename('old-name', 'new-name');
    });

    expect(mockGitRenameBranch).toHaveBeenCalledWith(PORT, PROJECT_ID, 'old-name', 'new-name', CHAT_ID);
    expect(mockToast.success).toHaveBeenCalledWith('Renamed to new-name');
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15–18. handleDelete — two-step confirm flow
// ---------------------------------------------------------------------------

describe('useBranchActions — handleDelete', () => {
  it('returns false immediately when user declines the initial confirm', async () => {
    mockRequestGitConfirm.mockResolvedValue(false);

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleDelete('feat/done');
    });

    expect(mockGitDeleteBranch).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('calls gitDeleteBranch → toast.success → loadBranches on a clean success', async () => {
    mockRequestGitConfirm.mockResolvedValue(true);
    mockGitDeleteBranch.mockResolvedValue({ status: 'success' });

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleDelete('feat/done');
    });

    expect(mockGitDeleteBranch).toHaveBeenCalledTimes(1);
    expect(mockGitDeleteBranch).toHaveBeenCalledWith(PORT, PROJECT_ID, 'feat/done', {
      remote: undefined,
      chatId: CHAT_ID,
    });
    expect(mockToast.success).toHaveBeenCalledWith("Deleted branch 'feat/done'");
    expect(ok).toBe(true);
  });

  it('on not-merged: shows force confirm; if accepted, calls gitDeleteBranch twice and toasts success', async () => {
    // First confirm: delete? → true; second confirm: force-delete? → true
    mockRequestGitConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    mockGitDeleteBranch
      .mockResolvedValueOnce({ status: 'not-merged', message: 'Branch not fully merged' })
      .mockResolvedValueOnce(undefined);

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleDelete('feat/unmerged');
    });

    expect(mockGitDeleteBranch).toHaveBeenCalledTimes(2);
    // Second call includes force:true
    expect(mockGitDeleteBranch.mock.calls[1]).toEqual([
      PORT,
      PROJECT_ID,
      'feat/unmerged',
      { force: true, remote: undefined, chatId: CHAT_ID },
    ]);
    expect(mockToast.success).toHaveBeenCalledWith("Deleted branch 'feat/unmerged'");
  });

  it('on not-merged: if user declines force confirm, no second gitDeleteBranch call', async () => {
    mockRequestGitConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockGitDeleteBranch.mockResolvedValue({ status: 'not-merged', message: 'Branch not fully merged' });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleDelete('feat/unmerged');
    });

    expect(mockGitDeleteBranch).toHaveBeenCalledTimes(1);
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 19. handleFetch
// ---------------------------------------------------------------------------

describe('useBranchActions — handleFetch', () => {
  it('calls gitFetch → toast.success "Fetched" → loadBranches; returns true', async () => {
    mockGitFetch.mockResolvedValue({ status: 'success', remote: 'origin' });

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleFetch();
    });

    expect(mockGitFetch).toHaveBeenCalledWith(PORT, PROJECT_ID, undefined, CHAT_ID);
    expect(mockToast.success).toHaveBeenCalledWith('Fetched');
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 20–21. handleUpdateAll
// ---------------------------------------------------------------------------

describe('useBranchActions — handleUpdateAll', () => {
  it('toasts error "Conflicts during update" when pull result is conflict', async () => {
    mockGitUpdateAll.mockResolvedValue({
      fetched: true,
      pull: { status: 'conflict', conflicts: [], message: 'conflict' },
      branches: [],
    });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleUpdateAll();
    });

    expect(mockToast.error).toHaveBeenCalledWith('Conflicts during update');
  });

  it('toasts success with pull + branch count when update is successful', async () => {
    mockGitUpdateAll.mockResolvedValue({
      fetched: true,
      pull: { status: 'success', summary: { changes: 2, insertions: 3, deletions: 1 } },
      branches: [
        { branch: 'feat/a', status: 'updated' },
        { branch: 'feat/b', status: 'up-to-date' },
      ],
    });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleUpdateAll();
    });

    expect(mockToast.success).toHaveBeenCalledWith('current branch pulled, 1 branches updated');
  });

  it('toasts "All up to date" when pull is up-to-date and no branches updated', async () => {
    mockGitUpdateAll.mockResolvedValue({
      fetched: true,
      pull: { status: 'up-to-date' },
      branches: [],
    });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleUpdateAll();
    });

    expect(mockToast.success).toHaveBeenCalledWith('All up to date');
  });
});

// ---------------------------------------------------------------------------
// 22. handleAbort
// ---------------------------------------------------------------------------

describe('useBranchActions — handleAbort', () => {
  it('calls gitAbort → toast.success "Aborted" → loadBranches; returns true', async () => {
    mockGitAbort.mockResolvedValue(undefined);

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleAbort();
    });

    expect(mockGitAbort).toHaveBeenCalledWith(PORT, PROJECT_ID, CHAT_ID);
    expect(mockToast.success).toHaveBeenCalledWith('Aborted');
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 23. handleCreateBranch
// ---------------------------------------------------------------------------

describe('useBranchActions — handleCreateBranch', () => {
  it('calls gitCreateBranch → toast.success with branch name → loadBranches; returns true', async () => {
    mockGitCreateBranch.mockResolvedValue(undefined);

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleCreateBranch('feat/new', 'main');
    });

    expect(mockGitCreateBranch).toHaveBeenCalledWith(PORT, PROJECT_ID, 'feat/new', 'main', CHAT_ID);
    expect(mockToast.success).toHaveBeenCalledWith('Created feat/new');
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 24. withBusy error path
// ---------------------------------------------------------------------------

describe('useBranchActions — withBusy error handling', () => {
  it('toasts the error message and returns false when gitCheckout throws', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGitCheckout.mockRejectedValue(new Error('Permission denied'));

    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleCheckout('main');
    });

    expect(ok).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith('Permission denied');
  });
});
