/**
 * SessionStrip — unit tests.
 *
 * Behaviors covered:
 *  - where the session runs and its branch, as the branch manager's trigger
 *  - the changes open the review, and hide for a clean tree and while unknown —
 *    a fabricated zero would read as "no changes"
 *  - nothing before the first message or without a project
 *
 * Mocked: the identity, branch and working-changes sources, and `BranchPopover`
 * (the real one fires git fetches when open and has its own suite).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';

// ── mocks ────────────────────────────────────────────────────────────────────
let mockIdentity = {
  projectId: 'proj-1' as string | undefined,
  chatId: 'chat-9' as string | undefined,
  noProject: false,
};
let mockIsWorktree = false;
let mockWorktreePath: string | undefined;
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectName: 'repo',
    branchName: 'feat/persisted',
    isWorktree: mockIsWorktree,
    worktreePath: mockWorktreePath,
    projectPath: '/Users/me/repo',
    ...mockIdentity,
  }),
}));

let mockBranch: string | undefined = 'feat/session-panel';
const refetch = vi.fn();
const useDisplayBranchSpy = vi.fn();
vi.mock('@/features/sessions/use-display-branch', () => ({
  useDisplayBranch: (opts: unknown) => {
    useDisplayBranchSpy(opts);
    return { branch: mockBranch, refetch };
  },
}));

// The trigger carries NO onClick of its own (the real DropdownMenuTrigger owns
// the gesture — pinned by e2e), so the mock exposes onOpenChange for the test
// to drive the wiring through.
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    children: ReactNode;
  }) => (
    <div data-testid="branch-popover" data-open={String(open)}>
      <button data-testid="branch-popover-drive" onClick={() => onOpenChange(!open)} />
      {children}
    </div>
  ),
}));

let mockChanges = {
  files: [{ path: 'a.ts' }, { path: 'b.ts' }],
  totalAdditions: 120,
  totalDeletions: 34,
  loading: false,
  error: false,
};
const useWorkingChangesSpy = vi.fn();
vi.mock('@/features/review/use-working-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/review/use-working-changes')>()),
  useWorkingChanges: (opts: unknown) => {
    useWorkingChangesSpy(opts);
    return mockChanges;
  },
}));

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...args: unknown[]) => emitSurfaceIntent(...args) }));

const { SessionStrip } = await import('../SessionStrip');

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DaemonPortProvider port={31415}>
      <TooltipProvider>{children}</TooltipProvider>
    </DaemonPortProvider>
  );
}
const renderStrip = () => rtlRender(<SessionStrip />, { wrapper: Wrapper });

beforeEach(() => {
  mockIdentity = { projectId: 'proj-1', chatId: 'chat-9', noProject: false };
  mockIsWorktree = false;
  mockWorktreePath = undefined;
  mockBranch = 'feat/session-panel';
  mockChanges = {
    files: [{ path: 'a.ts' }, { path: 'b.ts' }],
    totalAdditions: 120,
    totalDeletions: 34,
    loading: false,
    error: false,
  };
  emitSurfaceIntent.mockReset();
  useDisplayBranchSpy.mockReset();
  useWorkingChangesSpy.mockReset();
});

describe('SessionStrip — where it runs', () => {
  it('says Local with the branch outside a worktree', () => {
    renderStrip();
    expect(screen.getByTestId('session-strip-worktree')).toHaveTextContent('Local repo');
    expect(screen.getByTestId('session-strip-branch')).toHaveTextContent('feat/session-panel');
  });

  it('says Worktree, naming its directory to screen readers', () => {
    mockIsWorktree = true;
    mockWorktreePath = '/Users/me/repo/.worktrees/fix-login';
    renderStrip();
    expect(screen.getByTestId('session-strip-worktree')).toHaveTextContent('Worktree fix-login');
  });

  it('opens the branch manager', async () => {
    renderStrip();
    const popover = screen.getByTestId('branch-popover');
    expect(within(popover).getByTestId('session-strip-branch').tagName).toBe('BUTTON');
    expect(popover).toHaveAttribute('data-open', 'false');
    await userEvent.click(screen.getByTestId('branch-popover-drive'));
    expect(screen.getByTestId('branch-popover')).toHaveAttribute('data-open', 'true');
  });

  it('omits the branch while none resolves', () => {
    mockBranch = undefined;
    renderStrip();
    expect(screen.queryByTestId('session-strip-branch')).toBeNull();
  });
});

describe('SessionStrip — changes', () => {
  it('shows the totals and opens the review', () => {
    renderStrip();
    const changes = screen.getByRole('button', { name: '2 files changed, 120 added, 34 removed' });
    expect(changes).toHaveTextContent('+120−34');
    fireEvent.click(changes);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-review' });
  });

  it.each([
    ['a clean tree', { loading: false, error: false }],
    ['a read in progress', { loading: true, error: false }],
    ['a failed read', { loading: false, error: true }],
  ])('hides for %s', (_case, status) => {
    mockChanges = { files: [], totalAdditions: 0, totalDeletions: 0, ...status };
    renderStrip();
    expect(screen.queryByTestId('session-strip-changes')).toBeNull();
  });

  it('reads the branch once, not again with the changes', () => {
    renderStrip();
    expect(useWorkingChangesSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'proj-1', chatId: 'chat-9', withBranch: false }),
    );
  });

  it('counts the files where the scope reports no totals', () => {
    mockChanges = { ...mockChanges, totalAdditions: undefined!, totalDeletions: undefined! };
    renderStrip();
    expect(screen.getByTestId('session-strip-changes')).toHaveTextContent('2 files changed');
  });
});

describe('SessionStrip — nothing to show', () => {
  it('is absent before the first message creates the chat', () => {
    mockIdentity = { projectId: 'proj-1', chatId: undefined, noProject: false };
    renderStrip();
    expect(screen.queryByTestId('session-strip')).toBeNull();
    expect(useWorkingChangesSpy).not.toHaveBeenCalled();
  });

  it('is absent for a session with no project', () => {
    mockIdentity = { projectId: undefined, chatId: 'chat-9', noProject: true };
    renderStrip();
    expect(screen.queryByTestId('session-strip')).toBeNull();
    expect(useDisplayBranchSpy).not.toHaveBeenCalled();
  });
});
