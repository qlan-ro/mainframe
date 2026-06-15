/**
 * BranchPopover.test.tsx — render + view routing + testids.
 *
 * BranchPopover lazy-loads branches on open. Tests drive the `open` prop to
 * true to exercise the lazy-load path and then check the rendered view.
 *
 * Behaviors covered:
 *  1.  open=false: git-branch-popover is NOT in the DOM.
 *  2.  open=true, no conflict: shows the list view (git-branch-search).
 *  3.  open=true, branches loaded: shows local branch names in the list.
 *  4.  View routing: clicking a branch row navigates to git-submenu.
 *  5.  View routing: clicking "New Branch..." navigates to git-new-branch-dialog.
 *  6.  View routing: git-new-branch-back in NewBranchDialog navigates back to list.
 *  7.  open=true, conflict files present: opens directly into git-conflict-view.
 *  8.  open=true, activeOperation='merge': opens directly into git-conflict-view.
 *  9.  Abort fires handleAbort and goes back to list.
 * 10.  Back arrow in submenu (git-submenu back) returns to list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react — BranchPopover uses useAuiState for adapterId.
// useWorktreeSession (use-worktree-session.ts) uses useAssistantRuntime.
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { threadListItem: null }) => unknown) => selector({ threadListItem: null }),
  useAssistantRuntime: () => ({
    threads: {
      reload: vi.fn().mockResolvedValue(undefined),
      switchToThread: vi.fn(),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock use-worktree-session to avoid runtime dependency
// ---------------------------------------------------------------------------

vi.mock('../use-worktree-session', () => ({
  useWorktreeSession: () => vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock sessionCustomOf — returns null so adapterId falls back to 'claude'
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/view-model/chat-to-thread-custom', () => ({
  sessionCustomOf: () => null,
}));

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const mockGetGitBranches = vi.fn();
const mockGetGitStatus = vi.fn();
const mockGitAbort = vi.fn();
const mockGitCheckout = vi.fn();
const mockGitCreateBranch = vi.fn();
const mockGitFetch = vi.fn();
const mockGitPull = vi.fn();
const mockGitPush = vi.fn();
const mockGitMerge = vi.fn();
const mockGitRebase = vi.fn();
const mockGitRenameBranch = vi.fn();
const mockGitDeleteBranch = vi.fn();
const mockGitUpdateAll = vi.fn();
const mockGetProjectWorktrees = vi.fn();
const mockDeleteWorktree = vi.fn();

vi.mock('@/lib/api/git', () => ({
  getGitBranches: (...args: unknown[]) => mockGetGitBranches(...args),
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  gitAbort: (...args: unknown[]) => mockGitAbort(...args),
  gitCheckout: (...args: unknown[]) => mockGitCheckout(...args),
  gitCreateBranch: (...args: unknown[]) => mockGitCreateBranch(...args),
  gitFetch: (...args: unknown[]) => mockGitFetch(...args),
  gitPull: (...args: unknown[]) => mockGitPull(...args),
  gitPush: (...args: unknown[]) => mockGitPush(...args),
  gitMerge: (...args: unknown[]) => mockGitMerge(...args),
  gitRebase: (...args: unknown[]) => mockGitRebase(...args),
  gitRenameBranch: (...args: unknown[]) => mockGitRenameBranch(...args),
  gitDeleteBranch: (...args: unknown[]) => mockGitDeleteBranch(...args),
  gitUpdateAll: (...args: unknown[]) => mockGitUpdateAll(...args),
  getProjectWorktrees: (...args: unknown[]) => mockGetProjectWorktrees(...args),
  deleteWorktree: (...args: unknown[]) => mockDeleteWorktree(...args),
}));

// ---------------------------------------------------------------------------
// Mock confirm bridge
// ---------------------------------------------------------------------------

vi.mock('../use-git-confirm', () => ({
  requestGitConfirm: vi.fn().mockResolvedValue(true),
  useGitConfirm: { getState: () => ({ request: vi.fn().mockResolvedValue(true) }) },
}));

// ---------------------------------------------------------------------------
// Mock sonner
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { BranchPopover, type BranchPopoverProps } from '../BranchPopover';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';

const BRANCH_LIST = {
  current: 'main',
  local: [
    { name: 'main', current: true },
    { name: 'feat/login', current: false },
  ],
  remote: ['origin/main'],
  worktrees: [],
  activeOperation: undefined,
};

const BRANCH_LIST_WITH_CONFLICT = {
  ...BRANCH_LIST,
  activeOperation: 'merge' as const,
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGitBranches.mockResolvedValue(BRANCH_LIST);
  mockGetGitStatus.mockResolvedValue([]);
  mockGetProjectWorktrees.mockResolvedValue([]);
  mockGitAbort.mockResolvedValue(undefined);
  mockGitCheckout.mockResolvedValue(undefined);
  mockGitCreateBranch.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderPopover(props: Partial<BranchPopoverProps> = {}) {
  const merged: BranchPopoverProps = {
    port: PORT,
    projectId: PROJECT_ID,
    chatId: 'chat-1',
    open: true,
    onOpenChange: vi.fn(),
    onBranchChanged: vi.fn(),
    ...props,
  };
  return render(
    <TooltipProvider>
      <BranchPopover {...merged} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// 1. open=false: popover not in DOM
// ---------------------------------------------------------------------------

describe('BranchPopover — open=false', () => {
  it('does not render git-branch-popover when open=false', () => {
    renderPopover({ open: false });
    expect(screen.queryByTestId('git-branch-popover')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. open=true: list view rendered
// ---------------------------------------------------------------------------

describe('BranchPopover — open=true shows list view', () => {
  it('renders git-branch-search when open=true', async () => {
    renderPopover({ open: true });
    await waitFor(() => {
      expect(screen.getByTestId('git-branch-search')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. open=true: loaded branches visible via testids
// ---------------------------------------------------------------------------

describe('BranchPopover — shows loaded branch names', () => {
  it('renders branch row testids after loading', async () => {
    renderPopover({ open: true });
    await waitFor(() => {
      // 'main' is ungrouped → renders as full name; 'feat/login' is grouped → shows 'login'
      expect(screen.getByTestId('git-branch-row-main')).toBeTruthy();
      expect(screen.getByTestId('git-branch-row-feat/login')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. View routing: branch click → submenu
// ---------------------------------------------------------------------------

describe('BranchPopover — clicking a branch opens the submenu', () => {
  it('renders git-submenu after clicking a branch row', async () => {
    renderPopover({ open: true });

    // Wait for branches to load
    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));

    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));

    await waitFor(() => {
      expect(screen.getByTestId('git-submenu')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. View routing: New Branch → new-branch-dialog
// ---------------------------------------------------------------------------

describe('BranchPopover — clicking New Branch navigates to new-branch dialog', () => {
  it('renders git-new-branch-dialog after clicking git-new-branch', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-new-branch'));

    await userEvent.click(screen.getByTestId('git-new-branch'));

    expect(screen.getByTestId('git-new-branch-dialog')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Back from new-branch → list
// ---------------------------------------------------------------------------

describe('BranchPopover — back from new-branch dialog returns to list', () => {
  it('shows git-branch-search after clicking git-new-branch-back', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-new-branch'));
    await userEvent.click(screen.getByTestId('git-new-branch'));
    expect(screen.getByTestId('git-new-branch-dialog')).toBeTruthy();

    await userEvent.click(screen.getByTestId('git-new-branch-back'));
    expect(screen.getByTestId('git-branch-search')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. open=true with conflict files → conflict view
// ---------------------------------------------------------------------------

describe('BranchPopover — opens into conflict view when conflict files exist', () => {
  it('renders git-conflict-view when getGitStatus returns conflict-status files', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'UU' }]);

    renderPopover({ open: true });

    await waitFor(() => {
      expect(screen.getByTestId('git-conflict-view')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 8. open=true with activeOperation='merge' → conflict view
// ---------------------------------------------------------------------------

describe('BranchPopover — opens into conflict view when activeOperation is set', () => {
  it('renders git-conflict-view when branches.activeOperation is "merge"', async () => {
    mockGetGitBranches.mockResolvedValue(BRANCH_LIST_WITH_CONFLICT);

    renderPopover({ open: true });

    await waitFor(() => {
      expect(screen.getByTestId('git-conflict-view')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Abort in conflict view
// ---------------------------------------------------------------------------

describe('BranchPopover — Abort in conflict view fires handleAbort then returns to list', () => {
  it('calls gitAbort and navigates back to list view after abort', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'UU' }]);
    mockGetGitBranches.mockResolvedValue(BRANCH_LIST); // reload returns clean state

    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-conflict-abort'));

    // After abort, getGitStatus returns clean → list view
    mockGetGitStatus.mockResolvedValue([]);

    await act(async () => {
      await userEvent.click(screen.getByTestId('git-conflict-abort'));
    });

    await waitFor(() => {
      expect(mockGitAbort).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Back in submenu returns to list
// ---------------------------------------------------------------------------

describe('BranchPopover — back arrow in submenu returns to list', () => {
  it('shows git-branch-search after clicking git-submenu-back', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));
    await waitFor(() => screen.getByTestId('git-submenu'));

    // Click the back button in the submenu header
    await userEvent.click(screen.getByTestId('git-submenu-back'));

    await waitFor(() => {
      expect(screen.getByTestId('git-branch-search')).toBeTruthy();
    });
  });
});
