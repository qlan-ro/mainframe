/**
 * SummarySection — unit tests.
 *
 * Behaviors covered:
 *  - the branch row shows the live branch, and the `wt` badge only for worktrees
 *  - the context row shows the percentage and carries the token detail as its
 *    accessible description; it disappears when the percentage is unknown
 *  - one row per detected PR, labelled `PR #<n> · <source>`, opening the URL
 *  - the changes row shows the file count and the +/− totals, and clicking it
 *    emits `open-review`
 *  - the changes row is absent while loading and on error — a fabricated zero
 *    would read as "no changes"
 *  - a session with nothing to report shows one muted placeholder, not an
 *    empty card
 *  - the branch row is the branch manager: a button that opens the
 *    BranchPopover, and a static row for a draft worktree
 *
 * Mocked dependencies: the identity, branch, context-percent, chat-extras,
 * working-changes and thread-list data sources. `BranchPopover` is mocked
 * shallowly — the real one fires git fetches when open, and its own behavior
 * belongs to its own suite.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { ContextUsage, DetectedPr } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

// ── mocks ────────────────────────────────────────────────────────────────────
let mockIdentity = { projectId: 'proj-1' as string | undefined, chatId: 'chat-9' as string | undefined };
let mockIsWorktree = false;
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectName: 'repo',
    branchName: 'feat/persisted',
    isWorktree: mockIsWorktree,
    ...mockIdentity,
  }),
}));

let mockBranch: string | undefined = 'feat/session-panel';
let mockIsDraftWorktree = false;
const refetch = vi.fn();
vi.mock('@/features/sessions/use-display-branch', () => ({
  useDisplayBranch: () => ({ branch: mockBranch, isDraftWorktree: mockIsDraftWorktree, refetch }),
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

let mockPercent: number | null = 42;
vi.mock('../use-context-percent', () => ({ useContextPercent: () => mockPercent }));

let mockUsage: ContextUsage | undefined = { percentage: 42, totalTokens: 84_000, maxTokens: 200_000 };
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { contextUsage: mockUsage } }),
}));

let mockChanges = {
  files: [{ path: 'a.ts' }, { path: 'b.ts' }],
  totalAdditions: 120,
  totalDeletions: 34,
  loading: false,
  error: false,
};
vi.mock('@/features/review/use-working-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/review/use-working-changes')>()),
  useWorkingChanges: () => mockChanges,
}));

let mockPrs: DetectedPr[] = [];
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({ threadListItem: { custom: { detectedPrs: mockPrs } }, threads: { threadItems: [] } }),
}));

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...args: unknown[]) => emitSurfaceIntent(...args) }));

const { SummarySection } = await import('../SummarySection');

// ── harness ──────────────────────────────────────────────────────────────────
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <HostProvider host={new FakeHostBridge()}>{children}</HostProvider>
    </TooltipProvider>
  );
}
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: Wrapper });

const pr = (number: number, source: DetectedPr['source']): DetectedPr => ({
  url: `https://github.com/acme/repo/pull/${number}`,
  owner: 'acme',
  repo: 'repo',
  number,
  source,
});

beforeEach(() => {
  mockIdentity = { projectId: 'proj-1', chatId: 'chat-9' };
  mockIsWorktree = false;
  mockBranch = 'feat/session-panel';
  mockIsDraftWorktree = false;
  mockPercent = 42;
  mockUsage = { percentage: 42, totalTokens: 84_000, maxTokens: 200_000 };
  mockChanges = {
    files: [{ path: 'a.ts' }, { path: 'b.ts' }],
    totalAdditions: 120,
    totalDeletions: 34,
    loading: false,
    error: false,
  };
  mockPrs = [];
  emitSurfaceIntent.mockReset();
});

describe('SummarySection — branch', () => {
  it('shows the live branch name', () => {
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-branch')).toHaveTextContent('feat/session-panel');
  });

  it('badges a worktree session, and only a worktree session', () => {
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-branch-wt')).toBeNull();

    mockIsWorktree = true;
    render(<SummarySection port={31415} />);
    expect(screen.getAllByTestId('session-panel-summary-branch-wt')[0]).toBeInTheDocument();
  });

  it('omits the row when no branch resolves', () => {
    mockBranch = undefined;
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-branch')).toBeNull();
  });
});

describe('SummarySection — context', () => {
  it('shows the percentage, with the token counts in its tooltip', async () => {
    const user = userEvent.setup();
    mockPercent = 73;
    mockUsage = { percentage: 73, totalTokens: 146_000, maxTokens: 200_000 };
    render(<SummarySection port={31415} />);
    const row = screen.getByTestId('session-panel-summary-context');
    expect(row).toHaveTextContent('73%');

    await user.hover(row);
    expect((await screen.findAllByRole('tooltip'))[0]).toHaveTextContent('146k / 200k tokens');
  });

  it('omits the row when the usage cannot be derived', () => {
    mockPercent = null;
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-context')).toBeNull();
  });
});

describe('SummarySection — detected PRs', () => {
  it('renders one row per PR with its source word', () => {
    mockPrs = [pr(41, 'created'), pr(42, 'mentioned')];
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-pr-41')).toHaveTextContent('PR #41');
    expect(screen.getByTestId('session-panel-summary-pr-41')).toHaveTextContent('created');
    expect(screen.getByTestId('session-panel-summary-pr-42')).toHaveTextContent('mentioned');
  });

  it('renders no PR row when none was detected', () => {
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-pr-41')).toBeNull();
  });

  it('opens the PR externally on click', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockPrs = [pr(41, 'created')];
    render(<SummarySection port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-summary-pr-41'));
    expect(open).toHaveBeenCalledWith('https://github.com/acme/repo/pull/41', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});

describe('SummarySection — changes', () => {
  it('shows the +/− totals without a file count', () => {
    render(<SummarySection port={31415} />);
    const row = screen.getByTestId('session-panel-summary-changes');
    expect(row).not.toHaveTextContent('files');
    expect(row).toHaveTextContent('+120');
    expect(row).toHaveTextContent('−34');
  });

  it('says "No changes" for a clean tree', () => {
    mockChanges = { files: [], totalAdditions: 0, totalDeletions: 0, loading: false, error: false };
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-changes')).toHaveTextContent('No changes');
  });

  it('opens the review modal on click', () => {
    render(<SummarySection port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-summary-changes'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-review' });
  });

  it('omits the row while the changes are loading', () => {
    mockChanges = { files: [], totalAdditions: undefined!, totalDeletions: undefined!, loading: true, error: false };
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-changes')).toBeNull();
  });

  it('omits the row when the read failed', () => {
    mockChanges = { files: [], totalAdditions: undefined!, totalDeletions: undefined!, loading: false, error: true };
    render(<SummarySection port={31415} />);
    expect(screen.queryByTestId('session-panel-summary-changes')).toBeNull();
  });
});

describe('SummarySection — nothing to report', () => {
  it('shows one muted placeholder instead of an empty card', () => {
    mockIdentity = { projectId: undefined, chatId: undefined };
    mockBranch = undefined;
    mockPercent = null;
    mockChanges = { files: [], totalAdditions: undefined!, totalDeletions: undefined!, loading: false, error: false };
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-summary-changes')).toBeNull();
  });
});

describe('SummarySection — the branch row manages the branch', () => {
  it('renders the row as the popover trigger and wires the open state through', async () => {
    render(<SummarySection port={31415} />);
    const popover = screen.getByTestId('branch-popover');
    const row = within(popover).getByTestId('session-panel-summary-branch');
    expect(row.tagName).toBe('BUTTON');
    expect(popover).toHaveAttribute('data-open', 'false');

    await userEvent.click(screen.getByTestId('branch-popover-drive'));

    expect(screen.getByTestId('branch-popover')).toHaveAttribute('data-open', 'true');
  });

  it('stays a static row for a draft worktree — branch writes would hit the root repo', () => {
    mockIsDraftWorktree = true;
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-branch').tagName).toBe('DIV');
    expect(screen.queryByTestId('branch-popover')).toBeNull();
  });

  it('stays a static row for a session with no project', () => {
    mockIdentity = { projectId: undefined, chatId: 'chat-9' };
    render(<SummarySection port={31415} />);
    expect(screen.getByTestId('session-panel-summary-branch').tagName).toBe('DIV');
    expect(screen.queryByTestId('branch-popover')).toBeNull();
  });
});
