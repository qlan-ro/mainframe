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
 * 10.  Re-clicking the selected branch row closes the submenu (no back/close control — finding 10.9).
 * 11.  Reopen race: a stale in-flight load from a closed popover must not clobber a
 *      fresher reopen's data (reopen-hang regression — batch56 git-branch report).
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
  useAuiState: (selector: (s: { threadListItem: null; threads: { threadItems: [] } }) => unknown) =>
    selector({ threadListItem: null, threads: { threadItems: [] } }),
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
// Mock activeSessionCustom — returns null so adapterId falls back to 'claude'
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/view-model/chat-to-thread-custom', () => ({
  activeSessionCustom: () => null,
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), custom: vi.fn(), dismiss: vi.fn() },
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
// 10. No back/close control in submenu (finding 10.9) — closes via row re-click
// ---------------------------------------------------------------------------

describe('BranchPopover — submenu has no back/close control', () => {
  it('does not render git-submenu-back', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));
    await waitFor(() => screen.getByTestId('git-submenu'));

    expect(screen.queryByTestId('git-submenu-back')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11–14. Side-by-side submenu behaviour (rework from drill-in to side-by-side)
// ---------------------------------------------------------------------------

describe('BranchPopover — side-by-side submenu', () => {
  it('list stays visible beside the submenu after selecting a branch', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));

    await waitFor(() => {
      expect(screen.getByTestId('git-submenu')).toBeTruthy();
      expect(screen.getByTestId('git-branch-search')).toBeTruthy();
    });
  });

  it('selected branch row has aria-selected="true"; unselected row has aria-selected="false"', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));

    await waitFor(() => screen.getByTestId('git-submenu'));

    expect(screen.getByTestId('git-branch-row-feat/login')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('git-branch-row-main')).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking the already-selected branch row again closes the submenu (toggle)', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));
    await waitFor(() => screen.getByTestId('git-submenu'));

    // Second click on the same row — should toggle the submenu off.
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));

    await waitFor(() => {
      expect(screen.queryByTestId('git-submenu')).toBeNull();
    });
    expect(screen.getByTestId('git-branch-row-feat/login')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('git-branch-search')).toBeTruthy();
  });

  it('re-clicking the selected row closes the submenu and the list remains visible', async () => {
    renderPopover({ open: true });

    await waitFor(() => screen.getByTestId('git-branch-row-feat/login'));
    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));
    await waitFor(() => screen.getByTestId('git-submenu'));

    await userEvent.click(screen.getByTestId('git-branch-row-feat/login'));

    await waitFor(() => {
      expect(screen.queryByTestId('git-submenu')).toBeNull();
    });
    expect(screen.getByTestId('git-branch-search')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Trigger tooltip — BranchPopover owns the Hint wrapping via `triggerLabel`,
// so callers never have to interpose Hint inside `children` themselves.
//
// Radix's PopoverTrigger (asChild) clones its `children` element in place,
// merging in `ref`/`aria-expanded`/`data-state` so Popper can anchor the
// content to a real DOM node. If a caller instead wraps its trigger button in
// `Hint` (a plain function component, no forwardRef) BEFORE handing it to
// BranchPopover as `children`, that clone lands on Hint's props instead of
// the underlying DOM button — the merged props are silently dropped, the
// trigger ref stays null, and Popper can never measure a reference element
// (the content is stuck at its un-positioned placeholder transform). The fix
// is for BranchPopover to accept the bare trigger as `children` and apply the
// tooltip itself via a `triggerLabel` prop, wrapping Hint OUTSIDE
// PopoverTrigger — mirroring the `NewSessionPickerPopover` pattern.
// ---------------------------------------------------------------------------

describe('BranchPopover — trigger tooltip via triggerLabel (Hint wraps PopoverTrigger)', () => {
  it('shows the triggerLabel tooltip on hover of the bare trigger child', async () => {
    const user = userEvent.setup();
    renderPopover({
      open: false,
      triggerLabel: 'Switch branch',
      children: <button data-testid="branch-trigger-btn">main</button>,
    });

    const trigger = screen.getByTestId('branch-trigger-btn');
    await user.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Switch branch');
  });

  it('still forwards Radix Popover state (aria-expanded) onto the real trigger button through the Hint wrapper', async () => {
    // aria-expanded is recomputed from Popover context on every render and set
    // directly on the real DOM node via the trigger ref; it only reaches the
    // button if that ref chain (TooltipTrigger asChild -> PopoverTrigger
    // asChild -> button) stays intact. If BranchPopover wrapped Hint the wrong
    // way around (inside PopoverTrigger, over the child) this would stay
    // 'false' regardless of `open`.
    renderPopover({
      open: true,
      triggerLabel: 'Switch branch',
      children: <button data-testid="branch-trigger-btn">main</button>,
    });

    const trigger = await screen.findByTestId('branch-trigger-btn');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

// ---------------------------------------------------------------------------
// 11. Reopen race: a stale response from the FIRST open must not clobber the
// data from a SECOND, fresher open (reopen-hang regression).
//
// Sequence: open (fetch #1 kicked off, left pending) -> close -> reopen
// (fetch #2 kicked off, resolves immediately with fresh data) -> fetch #1
// finally resolves with stale data. Without a request-generation guard,
// fetch #1's stale `setBranches`/`setConflictFiles` calls land LAST and
// silently overwrite the freshly-reopened popover's correct state — in the
// worst case flipping `hasConflict` back on from stale conflict-status data
// and permanently stranding the reopened popover on the conflict view with
// no way back except Abort, which reads exactly like a "hang" from the
// outside (nothing in the list view responds because the list view is gone).
// ---------------------------------------------------------------------------

describe('BranchPopover — reopen race', () => {
  it('does not let a stale first-open response overwrite a fresher reopen', async () => {
    let resolveFirstLoad: (value: typeof BRANCH_LIST) => void = () => {};
    const firstLoad = new Promise<typeof BRANCH_LIST>((resolve) => {
      resolveFirstLoad = resolve;
    });

    const STALE_BRANCHES = {
      ...BRANCH_LIST,
      local: [
        { name: 'main', current: true },
        { name: 'feat/stale-only', current: false },
      ],
    };
    const FRESH_BRANCHES = {
      ...BRANCH_LIST,
      local: [
        { name: 'main', current: true },
        { name: 'feat/fresh-only', current: false },
      ],
    };

    // First open's getGitBranches call hangs until we resolve it manually below.
    mockGetGitBranches.mockReturnValueOnce(firstLoad);

    const { rerender } = renderPopover({ open: true });

    // First load is in flight — never resolved yet.
    await waitFor(() => expect(mockGetGitBranches).toHaveBeenCalledTimes(1));

    // Close before the first load resolves.
    rerender(
      <TooltipProvider>
        <BranchPopover
          port={PORT}
          projectId={PROJECT_ID}
          chatId="chat-1"
          open={false}
          onOpenChange={vi.fn()}
          onBranchChanged={vi.fn()}
        />
      </TooltipProvider>,
    );

    // Reopen — a second, independent getGitBranches call, resolved immediately
    // with fresh data (distinct from the still-pending first call).
    mockGetGitBranches.mockResolvedValueOnce(FRESH_BRANCHES);
    rerender(
      <TooltipProvider>
        <BranchPopover
          port={PORT}
          projectId={PROJECT_ID}
          chatId="chat-1"
          open
          onOpenChange={vi.fn()}
          onBranchChanged={vi.fn()}
        />
      </TooltipProvider>,
    );

    await waitFor(() => expect(mockGetGitBranches).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('git-branch-row-feat/fresh-only')).toBeTruthy();
    });

    // Now let the stale FIRST load finally resolve — it must be ignored.
    resolveFirstLoad(STALE_BRANCHES);

    // Give the stale promise's .then a tick to (wrongly) apply, if it were going to.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByTestId('git-branch-row-feat/fresh-only')).toBeTruthy();
    expect(screen.queryByTestId('git-branch-row-feat/stale-only')).toBeNull();
  });
});
